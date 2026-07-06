# 🧩 JNI Bridge（C++）

> 📂 [`native/include/jni/jni_bridge.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/jni/jni_bridge.h)
> 📂 [`native/include/jni/jni_hooks.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/jni/jni_hooks.h)
> 🟦 native 模块 · native↔Java 桥接的宏与混淆签名工具

## 类职责

`namespace vector::native::jni`（头文件 `jni_bridge.h`）是所有 JNI 桥的**公共脚手架**。它不定义具体 native 方法，而是提供：混淆感知的 Java 类签名解析、`RegisterNatives` 封装、以及一组让 native 方法声明/注册**零样板**的宏。`jni_hooks.h` 则声明三个 JNI 桥模块的注册入口函数。

Vector 的 native bridge Java 类位于混淆包 `org.matrix.vector.nativebridge`（混淆后包名从 `ConfigBridge::obfuscation_map()` 取），所有 native 方法都按 `Java_org_matrix_vector_nativebridge_<Class>_<method>` 的 JNI name-mangling 约定导出。

## 混淆签名 GetNativeBridgeSignature

```cpp
inline std::string GetNativeBridgeSignature() {
    auto *bridge = ConfigBridge::GetInstance();
    if (bridge) {
        const auto &obfs_map = bridge->obfuscation_map();
        auto it = obfs_map.find("org.matrix.vector.nativebridge.");
        if (it != obfs_map.end()) {
            return it->second;   // 已是 "org/xxx/.../" 斜杠形式
        }
    }
    return "org/matrix/vector/nativebridge/";   // 回退默认
}
```

读 `ConfigBridge` 混淆表，把原始包名 `org.matrix.vector.nativebridge.` 映射到构建期生成的混淆包名（斜杠分隔的 JNI 内部形式）。`ResourcesHook`、`HookBridge`、`NativeApiBridge` 等类都拼接到此签名后注册。`ConfigBridge` 为空时回退未混淆默认值，保证可调试性。

## RegisterNatives 封装

```cpp
[[gnu::always_inline]]
inline bool RegisterNativeMethodsInternal(JNIEnv *env, std::string_view class_name,
                                          const JNINativeMethod *methods, jint method_count) {
    auto *context = Context::GetInstance();
    if (!context) { LOGF("Cannot register natives for '{}', Context is null.", class_name.data()); return false; }
    auto clazz = context->FindClassFromCurrentLoader(env, class_name);
    if (clazz.get() == nullptr) { LOGF("JNI class not found: {}", class_name.data()); return false; }
    return env->RegisterNatives(clazz.get(), methods, method_count) == JNI_OK;
}
```

经注入的 classloader（`Context::FindClassFromCurrentLoader`）查找目标类——这一点关键：框架类不在默认 classloader，必须用注入的 `DexClassLoader` 才能找到。`always_inline` 消除调用开销。

## 宏工具集

```cpp
template <typename T, size_t N>
[[nodiscard]] constexpr inline size_t ArraySize(T (&)[N]);   // 静态数组元素数

#define VECTOR_JNI_CAST(to) reinterpret_cast<to>

#define VECTOR_NATIVE_METHOD(className, functionName, signature)                                   \
    {#functionName, signature,                                                                     \
     VECTOR_JNI_CAST(void *)(Java_org_matrix_vector_nativebridge_##className##_##functionName)}

#define JNI_START [[maybe_unused]] JNIEnv *env, [[maybe_unused]] jclass clazz

#define VECTOR_DEF_NATIVE_METHOD(ret, className, functionName, ...)                                \
    extern "C" JNIEXPORT ret JNICALL                                                               \
        Java_org_matrix_vector_nativebridge_##className##_##functionName(JNI_START, ##__VA_ARGS__)

#define REGISTER_VECTOR_NATIVE_METHODS(class_name)                                                 \
    RegisterNativeMethodsInternal(env, GetNativeBridgeSignature() + #class_name, gMethods,         \
                                  ArraySize(gMethods))
```

| 宏 | 用途 |
| :--- | :--- |
| `ArraySize` | `constexpr` 算 `gMethods[]` 长度，指针误用编译报错 |
| `VECTOR_NATIVE_METHOD` | 构造 `JNINativeMethod` 条目，自动 mangle 函数名 |
| `JNI_START` | 标准 `JNIEnv*, jclass` 前两参，`[[maybe_unused]]` 防警告 |
| `VECTOR_DEF_NATIVE_METHOD` | 定义 native 方法实现，自动 `extern "C"` + JNI 名 mangling |
| `REGISTER_VECTOR_NATIVE_METHODS` | 注册当前 `gMethods[]`，类名拼接到混淆签名后 |

典型用法：每个 JNI 桥 `.cpp` 声明 `static JNINativeMethod gMethods[] = { VECTOR_NATIVE_METHOD(...) };`，再 `REGISTER_VECTOR_NATIVE_METHODS(ClassName)` 一行完成注册。

## 注册入口 jni_hooks.h

```cpp
namespace vector::native::jni {
void RegisterHookBridge(JNIEnv *env);
void RegisterNativeApiBridge(JNIEnv *env);
void RegisterResourcesHook(JNIEnv *env);
}
```

三个入口由 `Context::InitHooks` 在 DEX 提权后调用，分别注册 `HookBridge`/`NativeApiBridge`/`ResourcesHook` 三个 native bridge Java 类的全部 native 方法。

## 注册数据流

```mermaid
flowchart TD
    A["Context::InitHooks"] --> B["DEX 提权<br/>MakeDexFileTrusted"]
    B --> C["RegisterHookBridge"]
    B --> D["RegisterNativeApiBridge"]
    B --> E["RegisterResourcesHook"]
    C --> F["REGISTER_VECTOR_NATIVE_METHODS(HookBridge)"]
    D --> G["REGISTER_VECTOR_NATIVE_METHODS(NativeApiBridge)"]
    E --> H["REGISTER_VECTOR_NATIVE_METHODS(ResourcesHook)"]
    F --> I["GetNativeBridgeSignature<br/>查混淆表"]
    G --> I
    H --> I
    I --> J["RegisterNativeMethodsInternal<br/>FindClassFromCurrentLoader"]
    J --> K["env->RegisterNatives"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class F,G,H,I,J,K class vec
    class B class hot
    class A,C,D,E class plain
```

## 相关

- [config-bridge.md · ConfigBridge 配置缓存](./config-bridge) — `GetNativeBridgeSignature` 的混淆表来源
- [context.md · 运行时上下文](./context) — `InitHooks` 调用三个注册入口
- [hook-bridge-cpp.md · HookBridge JNI 桥](./hook-bridge-cpp) — `RegisterHookBridge` 的实现
- [resources-hook-cpp.md · 资源 hook JNI 桥](./resources-hook-cpp) — `RegisterResourcesHook` 的实现
- [native-core · native 总览](../native-core)
