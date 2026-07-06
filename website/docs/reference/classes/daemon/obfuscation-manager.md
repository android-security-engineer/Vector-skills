# 🔀 ObfuscationManager

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/utils/ObfuscationManager.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/utils/ObfuscationManager.kt)
> 📂 [`daemon/src/main/jni/obfuscation.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/jni/obfuscation.cpp)
> 📂 [`daemon/src/main/jni/obfuscation.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/jni/obfuscation.h)
> 🟦 daemon 模块 · DEX 类名/签名随机化

## 类职责

`object ObfuscationManager` 是 daemon 的**DEX 混淆门面**，由两个 native 方法支撑：`obfuscateDex` 在共享内存里就地改写 DEX 字符串，`getSignatures` 返回原始→混淆的签名映射。其产出经 `ApplicationService.OBFUSCATION_MAP_TRANSACTION_CODE` 传给 zygisk 端的 `ConfigBridge`，供 `SetupEntryClass` 解析真实类名、`HookBridge` 定位 `BridgeService`。

## Kotlin 门面

```kotlin
object ObfuscationManager {
    @JvmStatic external fun obfuscateDex(memory: SharedMemory): SharedMemory
    @JvmStatic external fun getSignatures(): Map<String, String>
}
```

调用点：`FileSystem.getPreloadDex(isDexObfuscateEnabled)` 在混淆开启时调 `obfuscateDex` 改写预加载 DEX；`ApplicationService` 在 `OBFUSCATION_MAP_TRANSACTION_CODE` 事务里调 `getSignatures()`，关闭混淆时回写原始 key（`if (obfuscation) value else key`），保证映射始终为恒等映射。

## 签名表

```cpp
std::map<std::string, std::string> signatures = {
    {"Lde/robv/android/xposed/", ""},         {"Landroid/app/AndroidApp", ""},
    {"Landroid/content/res/XRes", ""},        {"Landroid/content/res/XModule", ""},
    {"Lio/github/libxposed/api/Xposed", ""},  {"Lorg/matrix/vector/core/", ""},
    {"Lorg/matrix/vector/nativebridge/", ""}, {"Lorg/matrix/vector/service/", ""},
};
```

`ensureInitialized` 用 `std::call_once` 一次性初始化：解析 `FileDescriptor.(I)V`、`SharedMemory.(FileDescriptor)V` 构造方法，并对每条签名调 `regen` 生成等长混淆串填入 value。

## regen · 等长随机化

```cpp
auto regen = [](std::string_view original_signature) {
    static constexpr auto chrs = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    // thread_local mt19937 + uniform_int_distribution
    // 20% 概率插 '/'，禁止连续 '/'、'L' 后立即 '/'、末尾前 '/'
    // 末字符类型与原签名一致：原末尾 '/' 则保留 '/'，否则随机字母
};
```

关键是**等长**：DEX 字符串表条目长度固定，就地 `memcpy` 必须等长，否则破坏偏移。`to_java` 把 Dex 签名（`Lpkg/cls;`）转 Java（`pkg.cls`），供 Java 端字符串匹配。

## getSignatures (JNI)

```cpp
JNIEXPORT jobject Java_org_matrix_vector_daemon_utils_ObfuscationManager_getSignatures(JNIEnv*, jclass)
```

`std::call_once` 一次性把所有 `(to_java(first), to_java(second))` 装入 `HashMap` 并 `NewGlobalRef`，后续直接返回全局引用，零分配。

## obfuscateDex (JNI)

```cpp
JNIEXPORT jobject Java_org_matrix_vector_daemon_utils_ObfuscationManager_obfuscateDex(JNIEnv*, jclass, jobject memory)
```

1. `ASharedMemory_dupFromJava` 拿 fd，`ASharedMemory_getSize`；
2. **`mmap(MAP_SHARED)`**——注释强调必须用 `MAP_SHARED` 而非 `MAP_PRIVATE`：COW 层在部分内核上拿不到 Java 端填充的初始内容，会读到零页导致 slicer 失败；同时实现零拷贝就地改写；
3. `memmem` 扫描是否含任一目标签名，**不含则跳过 slicer**，直接把原 fd 包装成 `SharedMemory` 返回；
4. 含则 `obfuscateDexBuffer`：`dex::Reader.CreateFullIr` → 遍历 `ir->strings` 对每条字符串 `strstr` 命中签名就 `memcpy` 等长替换 → `dex::Writer.CreateImage(&allocator, &new_size)` → `allocator.GetFd()`；
5. `munmap`+`close` 输入，用新 fd 构造 `SharedMemory` 返回。

## DexAllocator

`obfuscation.h` 定义的 `dex::Writer::Allocator`：

```cpp
class DexAllocator : public dex::Writer::Allocator {
    void* Allocate(size_t size) override {  // ASharedMemory_create + mmap(MAP_SHARED)
    void Free(void* ptr) override;          // munmap + close
    int GetFd() const;                      // 不在析构关 fd，交给 Java SharedMemory
};
```

`MAP_SHARED` 保证 slicer 写入立刻反映到 fd；析构只 munmap 不 close，FD 所有权移交 Java。

## 混淆与传递链

```mermaid
flowchart TD
    FS["FileSystem.getPreloadDex"] -->|混淆开启| OB["obfuscateDex(SharedMemory)"]
    OB --> Map["memmem 扫描签名"]
    Map -->|未命中| Skip["原 fd 包装返回"]
    Map -->|命中| Slice["slicer 就地改写 strings"]
    Slice --> Out["新 SharedMemory(fd)"]
    Out --> AS["ApplicationService DEX_TRANSACTION_CODE"]
    AS --> Zygisk["zygisk InMemoryDexClassLoader"]
    GS["getSignatures()"] --> AS2["OBFUSCATION_MAP_TRANSACTION_CODE"]
    AS2 --> CB["ConfigBridge.obfuscation_map"]
    CB --> Entry["SetupEntryClass 解析类名"]
    CB --> Hook["HookBridge 定位 BridgeService"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class OB,Map,Slice,Out,GS,CB,Entry,Hook class vec
    class AS,AS2,Zygisk class plain
    class Skip class plain
```

## 相关

- [ApplicationService · DEX/OBF 事务码](./application-service)
- [ConfigCache · isDexObfuscateEnabled](./daemon-state)
- zygisk 端消费见 [module-cpp](../zygisk/module-cpp) 与 [ipc-bridge](../zygisk/ipc-bridge)
