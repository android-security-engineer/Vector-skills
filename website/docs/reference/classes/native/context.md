# 🧩 Context（C++）

> 📂 [`native/include/core/context.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/core/context.h)
> 📂 [`native/src/core/context.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/core/context.cpp)
> 🟦 native 模块 · 运行时上下文抽象基类

## 类职责

`class Context`（`namespace vector::native`）是 native 库的**运行时上下文单例与核心枢纽**。它持有注入的 classloader 全局引用、入口类引用，提供类查找、DEX 加载、入口类设置等核心能力，并定义一组 `virtual` 钩子供平台特定子类实现 ART hook 初始化、JNI 注册、DEX 加载、入口类装配。

`Context` 是抽象基类（`LoadDex`/`SetupEntryClass` 为纯虚），实际实例由平台特定子类（如 Zygisk/daemon 路径）创建并经 `GetInstance()` 暴露。

## 单例管理

```cpp
class Context {
public:
    Context(const Context &) = delete;
    Context &operator=(const Context &) = delete;

    static Context *GetInstance();
    static std::unique_ptr<Context> ReleaseInstance();
protected:
    static std::unique_ptr<Context> instance_;
};
```

| 方法 | 语义 |
| :--- | :--- |
| `GetInstance()` | 返回 `instance_.get()`，未创建时返回 `nullptr` |
| `ReleaseInstance()` | `std::move` 转移所有权，之后 `GetInstance()` 返回 null 直到重建 |

拷贝/赋值被 delete，防止误复制单例。`instance_` 是 `protected` 静态 `unique_ptr`，由子类在构造时写入。

## 关键成员

```cpp
[[nodiscard]] jobject GetCurrentClassLoader() const { return inject_class_loader_; }

[[nodiscard]] lsplant::ScopedLocalRef<jclass> FindClassFromCurrentLoader(
    JNIEnv *env, std::string_view class_name) const {
    return FindClassFromLoader(env, GetCurrentClassLoader(), class_name);
}
protected:
    jobject inject_class_loader_ = nullptr;   // 全局 ref，框架类加载器
    jclass  entry_class_        = nullptr;    // 全局 ref，native→Java 入口类
```

`inject_class_loader_` 是注入到目标进程的框架 classloader，所有框架 Java 类都经它查找。`entry_class_` 是 native 调 Java 的入口（如 `VectorContext` 的入口类）。

## FindClassFromLoader

```cpp
static lsplant::ScopedLocalRef<jclass> FindClassFromLoader(
    JNIEnv *env, jobject class_loader, std::string_view class_name);
```

实现：缓存 `DexClassLoader` 全局 ref 与 `loadClass`/`findClass` 的 `jmethodID`，调 `loadClass(class_name)`；失败则清异常并 log。返回 `ScopedLocalRef<jclass>` 自动管理局部引用生命周期。

## FindAndCall 模板

```cpp
template <typename... Args>
void FindAndCall(JNIEnv *env, std::string_view method_name, std::string_view method_sig,
                 Args &&...args) const {
    if (!entry_class_) { LOGE(...); return; }
    jmethodID mid = lsplant::JNI_GetStaticMethodID(env, entry_class_, method_name, method_sig);
    if (mid) {
        env->CallStaticVoidMethod(entry_class_, mid,
                                  lsplant::UnwrapScope(std::forward<Args>(args))...);
    } else { LOGE(...); }
}
```

通用 native→Java 静态 void 方法调用器：按 name+sig 查 `jmethodID`，`UnwrapScope` 解包 `ScopedLocalRef` 参数后调用。用于内部通知 Java 侧事件（如初始化完成）。

## 虚方法钩子

```cpp
virtual void InitArtHooker(JNIEnv *env, const lsplant::InitInfo &initInfo);  // 默认实现：lsplant::Init
virtual void InitHooks(JNIEnv *env);                                           // 默认实现：DEX 提权 + JNI 注册
virtual void LoadDex(JNIEnv *env, PreloadedDex &&dex) = 0;                    // 纯虚：加载 DEX
virtual void SetupEntryClass(JNIEnv *env) = 0;                                // 纯虚：设置入口类
```

| 钩子 | 职责 |
| :--- | :--- |
| `InitArtHooker` | 初始化 LSPlant（默认实现调 `lsplant::Init`，失败 log） |
| `InitHooks` | DEX 提权 + JNI 桥注册（默认实现） |
| `LoadDex` | 把框架 DEX 加载进目标进程（子类实现，决定用哪种 DexClassLoader） |
| `SetupEntryClass` | 定位并全局 ref 入口类（子类实现，类名可能被混淆） |

`LoadDex`/`SetupEntryClass` 是纯虚——因为 Zygisk 注入与 daemon 注入的 DEX 加载机制、入口类命名都不同，必须子类特化。

## InitHooks 默认实现（DEX 提权）

```cpp
void Context::InitHooks(JNIEnv *env) {
    // 1. 取 inject_class_loader_ 的 pathList
    auto path_list = JNI_GetObjectFieldOf(env, inject_class_loader_, "pathList", "Ldalvik/system/DexPathList;");
    // 2. 取 dexElements 数组
    auto elements = JNI_Cast<jobjectArray>(JNI_GetObjectFieldOf(env, path_list, "dexElements", "[Ldalvik/system/DexPathList$Element;"));
    // 3. 逐元素取 dexFile.mCookie
    for (auto &element : elements) {
        auto java_dex_file = JNI_GetObjectFieldOf(env, element, "dexFile", "Ldalvik/system/DexFile;");
        auto cookie = JNI_GetObjectFieldOf(env, java_dex_file, "mCookie", "Ljava/lang/Object;");
        // 4. MakeDexFileTrusted 把 DEX 标为 BootClassPath 同等可信
        lsplant::MakeDexFileTrusted(env, cookie.get());
    }
    // 5. 注册 JNI 桥
    jni::RegisterResourcesHook(env);
    jni::RegisterHookBridge(env);
    jni::RegisterNativeApiBridge(env);
}
```

DEX 提权是隐藏 API 绕过的核心：遍历注入 classloader 的 `DexPathList.dexElements`，取每个 `DexFile.mCookie`（指向 ART native `DexFile` 对象），调 `lsplant::MakeDexFileTrusted` 修改其内部标志，让框架 DEX 被当作 BootClassPath 成员，从而绕过隐藏 API 限制。

## PreloadedDex 内部类

```cpp
class PreloadedDex {
public:
    PreloadedDex(int fd, size_t size);   // mmap PROT_READ MAP_SHARED
    ~PreloadedDex();                      // munmap
    explicit operator bool() const;       // addr_!=nullptr && size_>0
    auto size() const;
    auto data() const;
private:
    void *addr_;
    size_t size_;
};
```

RAII 管理 `mmap` 的 DEX：构造时只读共享映射 fd，析构 `munmap`。`operator bool` 判有效性。禁止拷贝、允许移动（移动后原对象 `addr_=nullptr` 防止 double-munmap）。`LoadDex` 接收 `PreloadedDex&&` 按值移动。

## Context 生命周期

```mermaid
flowchart TD
    A["native 库加载"] --> B["子类构造<br/>instance_ 赋值"]
    B --> C["LoadDex(PreloadedDex&&)"]
    C --> D["SetupEntryClass"]
    D --> E["InitArtHooker<br/>lsplant::Init"]
    E --> F["InitHooks<br/>DEX 提权 + JNI 注册"]
    F --> G["FindAndCall 通知 Java"]
    G --> H["运行中<br/>GetInstance 提供访问"]
    H --> I["ReleaseInstance<br/>std::move 释放"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,D,E,F class vec
    class B,I class hot
    class A,G,H class plain
```

## 相关

- [hook_bridge.cpp · ART hook 引擎](./hook-bridge-cpp) — `InitHooks` 注册的 JNI 桥之一
- [resources_hook.cpp · 资源 hook](./resources-hook-cpp) — `InitHooks` 注册的另一 JNI 桥
- [elf_image.cpp · ELF 解析](./elf-image) — Context 子类解析符号时使用
- [native-core · native 总览](../native-core)
