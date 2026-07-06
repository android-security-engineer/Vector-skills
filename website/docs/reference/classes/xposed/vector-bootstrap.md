# ⚙️ VectorBootstrap

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/di/VectorBootstrap.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/di/VectorBootstrap.kt)
> 🟩 xposed 模块 · DI 引导与 legacy 委托注册表

## 类职责

`object VectorBootstrap` 是现代框架的**中央 DI 注册表**。它在启动期接收 legacy 模块注入的 `LegacyFrameworkDelegate` 实现（即 `LegacyDelegateImpl`），并把它发布给所有需要调用 legacy 能力的现代组件（`VectorNativeHooker`、资源 hook 等）。

文件还定义了三件配套契约/数据：`LegacyFrameworkDelegate` 接口、`LegacyPackageInfo` 数据类、`OriginalInvoker` 函数接口。它们一起构成现代↔legacy 的显式依赖边界。

## LegacyFrameworkDelegate 契约

```kotlin
interface LegacyFrameworkDelegate {
    fun loadModules(activityThread: Any)
    fun onPackageLoaded(info: LegacyPackageInfo)
    fun onSystemServerLoaded(classLoader: ClassLoader)
    fun processLegacyHook(
        executable: Executable,
        thisObject: Any?,
        args: Array<Any?>,
        legacyHooks: Array<Any?>,
        invokeOriginal: OriginalInvoker,
    ): Any?
    val isResourceHookingDisabled: Boolean
    fun setPackageNameForResDir(packageName: String, resDir: String?)
    fun hasLegacyModule(packageName: String): Boolean
}
```

| 方法 | 现代侧何时调用 | legacy 侧实现 |
| :--- | :--- | :--- |
| `loadModules` | 应用/system_server 启动 | `XposedInit.loadModules` |
| `onPackageLoaded` | 包加载完成 | 构造 `LoadPackageParam` + `callAll` |
| `onSystemServerLoaded` | system_server 加载 | 兼容 `packageName="android"` |
| `processLegacyHook` | `VectorChain` terminal 节点 | `LegacyApiSupport` before→原方法→after |
| `isResourceHookingDisabled` | 资源 hook 决策 | `XposedInit.disableResources` |
| `setPackageNameForResDir` | 资源初始化 | `ResourceProxy.set` → `XResources.setPackageNameForResDir` |
| `hasLegacyModule` | `XSharedPreferences` 路径决策 | `loadedModules.containsKey` |

现代侧用 `Any`/`ClassLoader` 而非 `ActivityThread` 等具体类型，避免在 `xposed` 模块引入对 legacy Android 类的硬依赖。

## 配套类型

```kotlin
data class LegacyPackageInfo(
    val packageName: String,
    val processName: String,
    val classLoader: ClassLoader,
    val appInfo: ApplicationInfo,
    val isFirstApplication: Boolean,
)

fun interface OriginalInvoker {
    fun invoke(): Any?
}
```

`LegacyPackageInfo` 是现代侧传给 `onPackageLoaded` 的 DTO，`OriginalInvoker` 是 `processLegacyHook` 收到的"调原方法"闭包——由 `VectorNativeHooker` 注入，封装 `HookBridge.invokeOriginalMethod`。`fun interface` 让调用方可用 lambda 传入。

## VectorBootstrap 单例

```kotlin
object VectorBootstrap {
    @Volatile
    var delegate: LegacyFrameworkDelegate? = null
        private set

    fun init(frameworkDelegate: LegacyFrameworkDelegate) {
        check(delegate == null) { "VectorBootstrap is already initialized!" }
        delegate = frameworkDelegate
    }

    inline fun withLegacy(block: (LegacyFrameworkDelegate) -> Unit) {
        delegate?.let(block)
    }
}
```

| 成员 | 语义 |
| :--- | :--- |
| `delegate` | `@Volatile` 可见性 + `private set`，发布后对所有线程立即可见且外部不可改 |
| `init` | 一次性注入，重复调用抛 `IllegalStateException` |
| `withLegacy` | 安全执行块：delegate 非空才执行 block，避免空指针 |

`@Volatile` 而非 `synchronized` 读取：delegate 发布后只读不写，volatile 的 happens-before 足够保证可见性，省去锁开销（`VectorNativeHooker.callback` 每次方法调用都会读它）。

## 初始化时序

```mermaid
sequenceDiagram
    participant Loader as native 加载器
    participant LDI as LegacyDelegateImpl
    participant VB as VectorBootstrap
    participant VNH as VectorNativeHooker

    Note over Loader: native 库加载、DEX 注入
    Loader->>LDI: new LegacyDelegateImpl()
    Loader->>VB: init(LegacyDelegateImpl)
    VB->>VB: check(delegate==null)
    VB->>VB: delegate = impl (volatile 发布)

    Note over VNH: 后续每次方法调用
    VNH->>VB: delegate?.let {...}
    VB-->>VNH: delegate (非空)
    VNH->>LDI: processLegacyHook(...) (如有 legacy hook)

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
```

## 相关

- [LegacyDelegateImpl · 翻译边界](../legacy/legacy-delegate) — `delegate` 的实现
- [VectorNativeHooker · JNI trampoline](./vector-native-hooker) — 读取 `delegate` 调 `processLegacyHook`
- [VectorChain · 递归链状态机](./vector-chain) — terminal 节点经 delegate 走 legacy
- [xposed-di · DI 总览](../xposed-di) — 在现代 DI 体系中的位置
