# 📦 LoadedApkHookers · ClassLoader 生命周期 hook

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/hookers/LoadedApkHookers.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/hookers/LoadedApkHookers.kt)
> 🟦 xposed 模块 · `LoadedApk` 构造与 ClassLoader 创建拦截

## 类职责

本文件定义四个 `XposedInterface.Hooker`，分别挂在 `LoadedApk` 的构造、`createAppFactory`（API 28+）、`createOrUpdateClassLoaderLocked` 上，把 Android 的 ClassLoader 生命周期事件翻译成 Vector 的现代 `onPackageLoaded`/`onPackageReady` 与 legacy `handleLoadPackage`。配套的 `PackageContextHelper` 解析当前包/进程名与"首个包"判定，`LoadedApkTracker` 用弱引用集合跟踪处于初始引导期的 apk 实例。

## 类清单

| 类/对象 | 说明 |
| :--- | :--- |
| [`PackageContextHelper`](#packagecontexthelper) | 反射 `ActivityThread` 解析包名/进程名/首包标志 |
| [`LoadedApkTracker`](#loadedapktracker) | 弱引用集合，标记初始引导期的 apk |
| [`LoadedApkCtorHooker`](#loadedapkctorhooker) | 拦截构造：设资源包名、登记 apk |
| [`LoadedApkCreateAppFactoryHooker`](#loadedapkcreateappfactoryhooker) | API 28+：派发 `onPackageLoaded` |
| [`LoadedApkCreateCLHooker`](#loadedapkcreateclhooker) | 派发 `onPackageReady` 与 legacy `onPackageLoaded` |

---

## PackageContextHelper（私有 object）

`resolve(loadedApk, apkPackageName): ContextInfo(packageName, processName, isFirstPackage)` 反射 `ActivityThread.currentPackageName()`/`currentProcessName()`。当 `packageName == processName` 视为首包；`android` 包名归一为 `system`。

## LoadedApkTracker（私有 object）

- `activeApks: MutableSet<Any>` —— `Collections.synchronizedSet(newSetFromMap(WeakHashMap()))`，弱引用跟踪初始引导期的 apk，避免阻止 GC。

## LoadedApkCtorHooker

`object LoadedApkCtorHooker : XposedInterface.Hooker` —— 先 `chain.proceed()`，再取 `mPackageName`、`mResDir`，经 `VectorBootstrap.withLegacy` 调 `delegate.setPackageNameForResDir`（资源 hook 未禁用时）。OnePlus 专属规避：调用栈含 `ActivityThread$ApplicationThread.schedulePreload` 时不登记。最后把 apk 加入 `activeApks`。

```kotlin
val trackedApks = ConcurrentHashMap.newKeySet<Any>()
override fun intercept(chain: XposedInterface.Chain): Any?
```

## LoadedApkCreateAppFactoryHooker

`@RequiresApi(P) object` —— 仅对 `activeApks` 中的实例派发。取 `args[0]` 为 `ApplicationInfo`、`args[1]` 为默认 ClassLoader，API 29+ 时调 `VectorLifecycleManager.dispatchPackageLoaded`。

```kotlin
override fun intercept(chain: XposedInterface.Chain): Any?
```

## LoadedApkCreateCLHooker

`object` —— 拦截 `createOrUpdateClassLoaderLocked(addedPaths)`。初始加载判定：`args.firstOrNull() == null && activeApks.contains(loadedApk)`。`proceed` 后取 `mApplicationInfo`/`mClassLoader`/`mDefaultClassLoader`/`mAppComponentFactory`：

- API 28+：`dispatchPackageReady`（带 AppComponentFactory）；
- 初始加载且（首包或 `mIncludeCode`）：`delegate.onPackageLoaded(LegacyPackageInfo)`；
- `finally` 从 `activeApks` 移除，使后续 split APK 视为非初始。

## 事件流转

```mermaid
flowchart TD
    A["new LoadedApk()"] --> B["LoadedApkCtorHooker"]
    B --> C["setPackageNameForResDir"]
    B --> D["activeApks.add"]
    E["createAppFactory"] --> F["LoadedApkCreateAppFactoryHooker"]
    D -.追踪.-> F
    F --> G["dispatchPackageLoaded"]
    H["createOrUpdateClassLoaderLocked"] --> I["LoadedApkCreateCLHooker"]
    D -.追踪.-> I
    I --> J["dispatchPackageReady"]
    I --> K["legacy onPackageLoaded"]
    I --> L["activeApks.remove"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,F,G,I,J,K class vec
    class D,L class hot
    class A,E,H class plain
```

## 设计要点

- **`WeakHashMap` + 同步包装**：`activeApks` 用弱引用跟踪 apk，进程内 `LoadedApk` 实例本应短命，弱引用避免阻止 GC；同步集合保证多线程 `add`/`contains`/`remove` 安全；
- **构造 hook 先于 CL hook**：`LoadedApkCtorHooker` 在 `new LoadedApk()` 后登记，`LoadedApkCreateCLHooker` 据此判定"初始加载"，使 split APK 增量加载不被误派 `onPackageLoaded`；
- **OnePlus 规避**：`schedulePreload` 路径下不登记 apk，因其自定义 opt 流程会在后续 `createOrUpdateClassLoaderLocked` 前崩溃；
- **`finally` 清理**：`LoadedApkCreateCLHooker` 即使派发抛异常也保证从 `activeApks` 移除，避免状态泄漏到下一次 split 加载。

## 相关

- [VectorLifecycleManager · 生命周期分发](./vector-lifecycle-manager)
- [BaseInvoker · 调用系统基类](./base-invoker)
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
