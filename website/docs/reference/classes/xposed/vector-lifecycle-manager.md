# 🔁 VectorLifecycleManager · 生命周期分发

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/VectorLifecycleManager.kt`
> 🟦 xposed 模块 · 现代 Xposed 模块事件派发器

## 类职责

`object VectorLifecycleManager` 持有所有已装载的 `XposedModule` 实例（`activeModules`），把来自 hooker 的 Android 生命周期事件（`onPackageLoaded`/`onPackageReady`/`onSystemServerStarting`）封装成 libxposed 的 `Param` 对象，逐一分发给每个模块。每次分发用 `runCatching` 包裹并记日志，单个模块异常不影响其他模块。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `activeModules` | `MutableSet<XposedModule>` | `ConcurrentHashMap.newKeySet()`，所有已装载模块 |

## 方法签名

```kotlin
// 包加载完成（ClassLoader 已就绪）
fun dispatchPackageLoaded(
    packageName: String,
    appInfo: ApplicationInfo,
    isFirst: Boolean,
    defaultClassLoader: ClassLoader,
)

// 包就绪（含 AppComponentFactory）
fun dispatchPackageReady(
    packageName: String,
    appInfo: ApplicationInfo,
    isFirst: Boolean,
    defaultClassLoader: ClassLoader,
    classLoader: ClassLoader,
    appComponentFactory: Any?,
)

// system_server 启动中
fun dispatchSystemServerStarting(classLoader: ClassLoader)
```

`dispatchPackageReady` 在 API 28+ 且 `appComponentFactory != null` 时用 `PackageReadyParamImplP`（能返回真实 `AppComponentFactory`），否则退化为匿名 `PackageReadyParam`（`getAppComponentFactory` 抛 `UnsupportedOperationException`）。这样把 `AppComponentFactory` 的引用隔离在 `@RequiresApi(P)` 的独立类里，避免 Android 8.1 及以下 Verifier 崩溃。

## PackageReadyParamImplP（私有）

`@RequiresApi(P) private class PackageReadyParamImplP(...) : PackageReadyParam` —— 把 `appComponentFactory: Any` 强转为 `android.app.AppComponentFactory` 返回。

## 事件派发

```mermaid
flowchart TD
    A["LoadedApkCreateAppFactoryHooker"] --> B["dispatchPackageLoaded"]
    C["LoadedApkCreateCLHooker"] --> D["dispatchPackageReady"]
    E["StartBootstrapServicesHooker"] --> F["dispatchSystemServerStarting"]
    B --> G["构造 PackageLoadedParam"]
    D --> H{"API≥28 且 factory≠null?"}
    H -->|是| I["PackageReadyParamImplP"]
    H -->|否| J["匿名 PackageReadyParam"]
    F --> K["构造 SystemServerStartingParam"]
    G --> L["遍历 activeModules"]
    I --> L
    J --> L
    K --> L
    L --> M["module.onPackageLoaded/Ready/SystemServerStarting"]
    M --> N["runCatching + 日志"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,F,G,I,J,K,L,M class vec
    class H class hot
    class A,C,E,N class plain
```

## 分发语义

- **并发集合**：`activeModules` 用 `ConcurrentHashMap.newKeySet()`，模块装载与事件派发可能跨线程，迭代不需外部同步；
- **逐个 `runCatching`**：单个模块的 `onPackageLoaded` 等回调抛异常只记日志，不中断其他模块、不影响被 hook 方法的原流程；
- **不补发**：模块在 `dispatchPackageLoaded` 之后才装载的，收不到该包事件；`VectorModuleManager` 在装载末尾主动调一次 `onModuleLoaded` 作为补偿起点；
- **`PackageReadyParamImplP` 隔离**：把 `AppComponentFactory` 引用放进 `@RequiresApi(P)` 的私有类，使本文件在 Android 8.1 及以下能被 Verifier 加载而不崩。
- 所有 dispatch 入口都先构造 `Param` 再 `forEach`，模块回调内对 `param` 的读取是线程安全的（参数对象不可变，仅 `activeModules` 集合可变）。

## 相关

- [VectorModuleManager · 模块管理](./vector-module-manager)（填充 `activeModules`）
- [LoadedApkHookers · ClassLoader 生命周期](./loaded-apk-hookers)（事件来源）
- [SystemServerHookers · 系统服务 hook](./system-server-hookers)（事件来源）
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
