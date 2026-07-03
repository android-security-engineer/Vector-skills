# ⚙️ hook_bridge.cpp

> 📂 `native/src/jni/hook_bridge.cpp`
> 🟦 native 模块 · ART 方法 hook 引擎与并发 registry

## 文件职责

本文件实现 `HookBridge` Kotlin object 声明的全部 `external` native 方法，是 Vector 的 **ART 方法 hook 核心引擎**。它维护一个并发安全的全局 registry（`hooked_methods`），每个被 hook 的方法对应一个 `HookItem`，存储 modern/legacy 两套回调 multimap 与一个三态原子 backup 句柄。底层 ART 方法替换委托 LSPlant。

## HookItem：单方法状态

```cpp
struct HookItem {
    std::multimap<jint, jobject, std::greater<>> legacy_callbacks;   // 优先级→回调，降序
    std::multimap<jobject, std::greater<>> modern_callbacks;
private:
    std::atomic<jobject> backup{nullptr};     // 三态原子 backup
    static_assert(decltype(backup)::is_always_lock_free);
    inline static jobject FAILED = reinterpret_cast<jobject>(std::numeric_limits<uintptr_t>::max());
public:
    jobject GetBackup();     // 等待非 null，返回 backup 或 null(FAILED)
    void   SetBackup(jobject newBackup);  // CAS 一次性设置 + notify_all
};
```

`std::greater<>` 让 multimap 按 priority **降序**排列，与 legacy `XCallback` 的"高优先级先 before、后 after"契约一致。

### 三态 backup

`backup` 原子量有三种状态：

| 状态 | 值 | 含义 |
| :--- | :--- | :--- |
| 未初始化 | `nullptr` | hook 尚未完成，`GetBackup` 会阻塞等待 |
| 失败 | `FAILED`（`uintptr_t::max`） | `lsplant::Hook` 失败，`GetBackup` 返回 null |
| 有效 | 真 `jobject` | 原始方法的句柄，供 `invokeOriginalMethod` 使用 |

`GetBackup` 用 `backup.wait(nullptr, acquire)` 阻塞直到非 null（C++20 等待原语），`SetBackup` 用 `compare_exchange_strong(null→newBackup|FAILED, acq_rel)` 保证只设置一次，再 `notify_all` 唤醒等待者。`is_always_lock_free` 静态断言保证无锁。

## 全局 registry

```cpp
template <class K, class V, ...> using SharedHashMap = phmap::parallel_flat_hash_map<K, V, ..., std::shared_mutex, N=4>;
SharedHashMap<jmethodID, std::unique_ptr<HookItem>> hooked_methods;
```

`phmap::parallel_flat_hash_map` 内部分片 + `std::shared_mutex`：读操作（`lazy_emplace_l`/`if_contains`）并发无锁，写操作（首次插入）分片锁。`jmethodID` 为键，`jmethodID` 在方法生命周期内稳定，适合作键。

## hookMethod：安装 hook

```cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, HookBridge, hookMethod,
    jboolean useModernApi, jobject hookMethod, jclass hooker, jint priority, jobject callback)
```

流程：

1. `env->FromReflectedMethod(hookMethod)` 得 `jmethodID target`
2. `hooked_methods.lazy_emplace_l`：已存在则取指针，新建则构造 `HookItem` 并标记 `newHook=true`
3. 若 `newHook`：
   - 取 `hooker` 的 `<init>(Executable)V` 与 `callback([Ljava/lang/Object;)Ljava/lang/Object;`
   - `env->NewObject(hooker, init, hookMethod)` 构造 trampoline
   - `lsplant::Hook(env, hookMethod, hooker_object, callback_method)` 替换 ART 方法，返回 backup
   - `hook_item->SetBackup(backup)`（失败则传 null→FAILED）
4. `hook_item->GetBackup()` 等待 backup，null 则返回 `JNI_FALSE`
5. `lsplant::JNIMonitor(env, backup)` 锁 backup 对象
6. 按 `useModernApi` 把 `env->NewGlobalRef(callback)` 插入 `modern_callbacks` 或 `legacy_callbacks`

debug 构建有 RAII `finally` 计时新 hook 耗时。

## unhookMethod：卸载回调

```cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, HookBridge, unhookMethod,
    jboolean useModernApi, jobject hookMethod, jobject callback)
```

取 `HookItem` → `GetBackup` → `JNIMonitor` 锁 → 在对应 multimap 中用 `IsSameObject` 找到 callback → `DeleteGlobalRef` + `erase`。注意只删单个回调，不卸载整个方法 hook。

## invokeOriginalMethod：调原方法

```cpp
VECTOR_DEF_NATIVE_METHOD(jobject, HookBridge, invokeOriginalMethod,
    jobject hookMethod, jobject thiz, jobjectArray args)
```

`if_contains` 找 `HookItem`：有则 `GetBackup()`（backup 句柄），无则用 `hookMethod` 本身。再 `env->CallObjectMethod(method_to_invoke, invoke, thiz, args)`——`invoke` 是启动时缓存的 `Method.invoke` 的 `jmethodID`。

## invokeSpecialMethod：非虚调用

```cpp
VECTOR_DEF_NATIVE_METHOD(jobject, HookBridge, invokeSpecialMethod,
    jobject method, jcharArray shorty, jclass cls, jobject thiz, jobjectArray args)
```

最复杂的方法，用 `CallNonvirtual*MethodA` 实现非虚分派：

1. **全局缓存** 包装类（`Number`/`Boolean`/`Character`/`Integer`/...）与 `valueOf`/`xValue` 方法 ID
2. **参数校验**：`args.length` 必须等于 `shorty.length-1`，`thiz` 非 null
3. **栈分配** `jvalue[]`（`alloca`，避免堆分配）
4. **安全拆箱**：按 `shorty[i+1]` 选类型，null 基本类型抛 `IllegalArgumentException`，`Number`/`Character` 用对应 `xValue` 提取，`Character` 可隐式扩宽到数值
5. **非虚调用**：按 `shorty[0]`（返回类型）选 `CallNonvirtualXxxMethodA`
6. **异常包装**：捕获目标方法异常，包成 `InvocationTargetException` 抛出
7. **装箱返回**：按 `shorty[0]` 用对应 `valueOf` 装箱

## callbackSnapshot：回调快照

```cpp
VECTOR_DEF_NATIVE_METHOD(jobjectArray, HookBridge, callbackSnapshot,
    jclass callback_class, jobject method)
```

返回 `Object[2][]`：[0]=modern 回调数组（用 `callback_class` 即 `VectorHookRecord` 严格类型），[1]=legacy 回调数组（`Object` 类型）。在 `JNIMonitor` 锁内遍历两个 multimap 填充，保证快照一致性。`VectorNativeHooker.callback` 据此驱动 `VectorChain` 与 `LegacyApiSupport`。

## 其余方法

| 方法 | 实现 |
| :--- | :--- |
| `deoptimizeMethod` | `lsplant::Deoptimize(env, hookMethod)` |
| `allocateObject` | `env->AllocObject(cls)` |
| `instanceOf` | `env->IsInstanceOf(object, expected_class)`（`@FastNative`） |
| `setTrusted` | `lsplant::MakeDexFileTrusted(env, cookie)` |
| `getStaticInitializer` | `GetStaticMethodID(clazz,"<clinit>","()V")`，失败清异常返回 null，成功 `ToReflectedMethod(...,JNI_TRUE)` |

## 注册表

```cpp
static JNINativeMethod gMethods[] = {
    VECTOR_NATIVE_METHOD(HookBridge, hookMethod, "(ZLjava/lang/reflect/Executable;Ljava/lang/Class;ILjava/lang/Object;)Z"),
    VECTOR_NATIVE_METHOD(HookBridge, unhookMethod, "(ZLjava/lang/reflect/Executable;Ljava/lang/Object;)Z"),
    VECTOR_NATIVE_METHOD(HookBridge, deoptimizeMethod, "(Ljava/lang/reflect/Executable;)Z"),
    VECTOR_NATIVE_METHOD(HookBridge, invokeOriginalMethod, "(Ljava/lang/reflect/Executable;Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;"),
    VECTOR_NATIVE_METHOD(HookBridge, invokeSpecialMethod, "(Ljava/lang/reflect/Executable;[CLjava/lang/Class;Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;"),
    VECTOR_NATIVE_METHOD(HookBridge, allocateObject, "(Ljava/lang/Class;)Ljava/lang/Object;"),
    VECTOR_NATIVE_METHOD(HookBridge, instanceOf, "(Ljava/lang/Object;Ljava/lang/Class;)Z"),
    VECTOR_NATIVE_METHOD(HookBridge, setTrusted, "(Ljava/lang/Object;)Z"),
    VECTOR_NATIVE_METHOD(HookBridge, callbackSnapshot, "(Ljava/lang/Class;Ljava/lang/reflect/Executable;)[[Ljava/lang/Object;"),
    VECTOR_NATIVE_METHOD(HookBridge, getStaticInitializer, "(Ljava/lang/Class;)Ljava/lang/reflect/Method;"),
};

void RegisterHookBridge(JNIEnv *env) {
    jclass method = env->FindClass("java/lang/reflect/Method");
    invoke = env->GetMethodID(method, "invoke", "(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;");
    REGISTER_VECTOR_NATIVE_METHODS(HookBridge);
}
```

`RegisterHookBridge` 还缓存 `Method.invoke` 的 `jmethodID`（全局 `invoke`），供 `invokeOriginalMethod` 使用。

## hook 安装并发模型

```mermaid
sequenceDiagram
    participant T1 as 线程A
    participant T2 as 线程B
    participant HM as hooked_methods
    participant HI as HookItem
    participant LSP as LSPlant

    T1->>HM: lazy_emplace_l(target)
    HM->>HM: 新建→newHook=true
    T1->>LSP: Hook(method, trampoline)
    LSP-->>T1: backup
    T1->>HI: SetBackup(backup) CAS + notify_all

    T2->>HM: lazy_emplace_l(target)
    HM->>HM: 已存在→取 HI 指针
    T2->>HI: GetBackup() wait(nullptr)
    Note over T2: 阻塞直到 T1 SetBackup
    HI-->>T2: backup (被唤醒)
    T2->>HI: JNIMonitor(backup) 锁
    T2->>HI: emplace(priority, callback globalref)
    T1->>HI: emplace(priority, callback globalref)

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
```

## 相关

- [HookBridge · Kotlin JNI 门面](../xposed/hook-bridge) — 声明侧
- [VectorNativeHooker · JNI trampoline](../xposed/vector-native-hooker) — trampoline 类与 `callback` 方法
- [context.cpp · Context 抽象基类](./context) — `InitHooks` 注册本桥
- [VectorChain · 递归链](../xposed/vector-chain) — 消费 `callbackSnapshot` 快照
