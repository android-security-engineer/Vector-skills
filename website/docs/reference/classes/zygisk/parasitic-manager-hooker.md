# 🦠 ParasiticManagerHooker

> 📂 [`zygisk/src/main/kotlin/org/matrix/vector/ParasiticManagerHooker.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/kotlin/org/matrix/vector/ParasiticManagerHooker.kt)
> 🟦 zygisk 模块 · 寄生管理器身份移植

## 类职责

`object ParasiticManagerHooker` 实现 Vector 的**寄生管理器**机制：把独立的 LSPosed Manager APK 注入到一个宿主进程（shell，`HostPackageUid`）里运行，使其获得"系统级"身份与网络权限，而无需作为独立应用安装。它通过 7 个 `XposedBridge`/`XposedHelpers` 钩子，在 `ActivityThread`、`LoadedApk`、`WebViewFactory` 等关键路径上做**身份移植**——保留宿主的路径/UID/SELinux 上下文，仅替换代码来源为管理器 APK。

## start · 入口

```kotlin
@JvmStatic
fun start(): Boolean
```

`VectorServiceClient.requestInjectedManagerBinder(binderList)` 拿到管理器 APK 的 `ParcelFileDescriptor`，`detachFd()` 存 `managerFd`；`binderList[0]` 包装成 `ILSPManagerService`。成功则调 `hookForManager(managerService)` 装钩并返回 `true`，异常返回 `false`。由 `Main.forkCommon` 在检测到 `niceName == ManagerPackageName` 时调用。

## getManagerPkgInfo · 混合包信息

```kotlin
@Synchronized
private fun getManagerPkgInfo(appInfo: ApplicationInfo?): PackageInfo?
```

构造**混合 PackageInfo**：从 `/proc/self/fd/$managerFd` 用 `PackageManager.getPackageArchiveInfo` 解析管理器 APK（SDK ≤ 28 因 FD 路径解析不可靠，先复制到 `${appInfo.dataDir}/cache/lsposed.apk`），再把宿主的 `nativeLibraryDir`/`packageName`/`dataDir`/`deviceProtectedDataDir`/`processName`/`uid`/`overlayPaths`/`resourceDirs` 移植进去，仅 `sourceDir`/`publicSourceDir` 指向管理器 APK。`FLAG_HAS_CODE` 置位（A14 QPR3 修复）。结果缓存于 `managerPkgInfo`。

## hookForManager · 七处钩子

### Hook 1: handleBindApplication

```kotlin
XposedHelpers.findAndHookMethod(ActivityThread::class.java, "handleBindApplication",
    "android.app.ActivityThread\$AppBindData", ...)
```

`beforeHookedMethod` 把 `bindData.appInfo` 替换为寄生 `ApplicationInfo`，让系统按管理器代码绑定应用。

### Hook 2: LoadedApk.getClassLoader

```kotlin
XposedHelpers.findAndHookMethod(LoadedApk::class.java, "getClassLoader", ...)
```

`afterHookedMethod` 检测 `mApplicationInfo == managerAppInfo` 时，若 `pathList.getDexPaths` 不含管理器 `sourceDir` 则 `addDexPath`，再 `sendBinderToManager` 把 manager service binder 经反射调 `Constants.setBinder` 传给管理器，随后 `unhook`（只需注入一次）。

### Hook 3: Activity 生命周期与 Intent 重定向

钩 `ActivityThread$ActivityClientRecord` 全构造器（O_MR1 以下额外钩 `ApplicationThread.scheduleLaunchActivity`）：把 `ActivityInfo` 替换为管理器 `MainActivity`、把 `Intent.component` 重定向到管理器 MainActivity；`scheduleLaunchActivity` 时按 `ActivityInfo.name` 从 `states`/`persistentStates` 注入之前捕获的状态。

### Hook 4: handleReceiver

```kotlin
XposedBridge.hookAllMethods(ActivityThread::class.java, "handleReceiver",
    object : XC_MethodReplacement() { replaceHookedMethod -> PendingResult.finish(); null })
```

管理器不需处理宿主的广播接收器，直接 `finish()` 所有 `PendingResult` 并返回 null。

### Hook 5: installProvider · Provider 上下文伪造

钩 `installProvider`：检测 `ProviderInfo.applicationInfo.packageName == managerPackage` 时，构造一个 `"$managerPackage.origin"` 的假 `ContextImpl.createAppContext`，把 `originalContext` 替换进参数，绕过内部包名校验。

### Hook 6: WebViewFactory.getProvider

```kotlin
XposedHelpers.findAndHookMethod(WebViewFactory::class.java, "getProvider",
    object : XC_MethodReplacement() { ... })
```

寄生进程里 WebView 未正常初始化：反射 `getProviderClass`，用 `WebViewDelegate` 反射调用 Chromium 的 `create(WebViewDelegate)` 静态工厂，存 `sProviderInstance`。失败抛 `AndroidRuntimeException`。

### Hook 7: performStopActivityInner · 状态捕获

钩 `performStopActivityInner`（O_MR1 以下钩 `performDestroyActivity`）：`callActivityOnSaveInstanceState` 后把 `state`/`persistentState` 按 `activityInfo.name` 存入 `states`/`persistentStates`，供 Hook 3 的 `scheduleLaunchActivity` 注入，保证 Activity 重建时状态不丢。

## 寄生流程

```mermaid
flowchart TD
    Start["start()"] --> FD["detachFd 管理 APK + manager binder"]
    FD --> GPI["getManagerPkgInfo<br/>宿主身份 + 管理器代码"]
    GPI --> H1["Hook1 handleBindApplication<br/>替换 appInfo"]
    H1 --> H2["Hook2 getClassLoader<br/>addDexPath + setBinder"]
    H2 --> H3["Hook3 ActivityClientRecord<br/>MainActivity 重定向 + 状态注入"]
    H3 --> H4["Hook4 handleReceiver<br/>吞掉宿主广播"]
    H4 --> H5["Hook5 installProvider<br/>origin 上下文伪造"]
    H5 --> H6["Hook6 WebView getProvider"]
    H6 --> H7["Hook7 状态捕获"]
    H7 --> Done["寄生管理器就绪"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class FD,GPI,H1,H2,H3,H4,H5,H6,H7 class vec
    class Start class plain
    class Done class plain
```

## 相关

- [main-fork-common · 调用入口](./main-fork-common)
- [manager-service · obtainManagerBinder/APK](../daemon/manager-service)
- [application-service · requestInjectedManagerBinder](../daemon/application-service)
- legacy 钩子机制见 [legacy · callbacks](../legacy-callbacks)
