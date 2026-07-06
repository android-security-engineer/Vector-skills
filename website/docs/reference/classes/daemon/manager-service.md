# 🧰 ManagerService

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/ManagerService.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/ManagerService.kt)
> 🟦 daemon 模块 · `ILSPManagerService` 实现

## 类职责

`object ManagerService : ILSPManagerService.Stub()` 是 daemon 暴露给**管理器 UI** 的服务。覆盖模块启用/禁用、作用域管理、verbose 日志、包查询、卸载安装、SELinux/dex2oat 状态、隐藏图标、寄生管理器引导、自动包含等全部管理操作。同时维护寄生管理器进程的注册与生命周期守卫 `ManagerGuard`。

## ManagerGuard · 进程守卫

```kotlin
class ManagerGuard(private val binder: IBinder, val pid: Int, val uid: Int) :
    IBinder.DeathRecipient
```

构造时 `ManagerService.guard = this`，`binder.linkToDeath`，并 `applyXspaceWorkaround(connection)`（持有一个空 `IServiceConnection` 防 Xspace 优化回收）。`binderDied` 解链、`unbindService`、置 `guard = null`。`guard` 为 `var ... internal set`，供 `VectorDaemon` 在 system_server 崩溃时清空。

## 寄生管理器注册

```kotlin
@Synchronized fun preStartManager(): Boolean
@Synchronized fun tryRegisterManagerProcess(pid: Int, uid: Int, processName: String): Boolean
fun postStartManager(pid: Int): Boolean
fun isRunningManager(pid: Int, uid: Int): Boolean
fun obtainManagerBinder(heartbeat: IBinder, pid: Int, uid: Int): IBinder
fun openManager(withData: Uri?)
```

`preStartManager` 置 `pendingManager = true`、`managerPid = -1`。`tryRegisterManagerProcess` 仅在 `isManager(uid) && processName == DEFAULT_MANAGER_PACKAGE_NAME` 时记录 `managerPid` 并区分寄生/用户安装。`obtainManagerBinder` 构造 `ManagerGuard`，对 `isManager(uid)` 的进程额外 `ensureWebViewPermission()`（修复 WebView 缓存目录的 SELinux 与 chown）。`openManager` 构造 LAUNCH_MANAGER Intent 后 `startActivityAsUserWithFeature`。

## 模块与作用域

```kotlin
override fun enabledModules() = ConfigCache.state.modules.keys.toTypedArray()
override fun enableModule(packageName: String) = ModuleDatabase.enableModule(packageName)
override fun disableModule(packageName: String) = ModuleDatabase.disableModule(packageName)
override fun setModuleScope(packageName: String, scope: MutableList<Application>) = ModuleDatabase.setModuleScope(packageName, scope)
override fun getModuleScope(packageName: String) = ConfigCache.getModuleScope(packageName)
override fun setAutoInclude(packageName: String, enabled: Boolean) = ModuleDatabase.setAutoInclude(packageName, enabled)
override fun getAutoInclude(packageName: String) = ConfigCache.getAutoInclude(packageName)
```

全部委托到 `ModuleDatabase`/`ConfigCache`，自身只做 AIDL 适配。

## 日志与状态

```kotlin
override fun isVerboseLog() = PreferenceStore.isVerboseLogEnabled() || BuildConfig.DEBUG
override fun setVerboseLog(enabled: Boolean)
override fun getVerboseLog(): ParcelFileDescriptor?
override fun getModulesLog(): ParcelFileDescriptor?
override fun clearLogs(verbose: Boolean): Boolean
```

`setVerboseLog` 写偏好后按需 `LogcatMonitor.startVerbose()`/`stopVerbose()`。`getVerboseLog`/`getModulesLog` 返回只读 PFD；`clearLogs` 调 `LogcatMonitor.refresh`。

## 包与系统操作

```kotlin
override fun getInstalledPackagesFromAllUsers(flags: Int, filterNoProcess: Boolean): ParcelableListSlice<PackageInfo>
override fun getPackageInfo(packageName: String, flags: Int, uid: Int)
override fun forceStopPackage(packageName: String, userId: Int)
override fun uninstallPackage(packageName: String, userId: Int): Boolean
override fun installExistingPackageAsUser(packageName: String, userId: Int): Int
override fun reboot()
override fun startActivityAsUserWithFeature(intent: Intent, userId: Int): Int
override fun queryIntentActivitiesAsUser(intent: Intent, flags: Int, userId: Int): ParcelableListSlice<ResolveInfo>
override fun clearApplicationProfileData(packageName: String)
override fun setHiddenIcon(hide: Boolean)
override fun getLogs(zipFd: ParcelFileDescriptor)
override fun performDexOptMode(packageName: String)
```

`uninstallPackage` 用反射构造 `IntentSender` 包装 `IIntentSender.Stub`，`CountDownLatch` 同步等待 `PackageInstaller.EXTRA_STATUS`；`userId == -1` 用 `DELETE_ALL_USERS` 标志。`startActivityAsUserWithFeature` 处理跨用户切换：必要时 `switchUser(parent)` + `IWindowManager.lockNow`。`setHiddenIcon` 通过 `getContentProviderExternal("settings")` 调 `PUT_global`。

## 状态查询

```kotlin
override fun getXposedApiVersion() = IXposedService.LIB_API
override fun getXposedVersionCode() = BuildConfig.VERSION_CODE
override fun getXposedVersionName() = BuildConfig.VERSION_NAME
override fun isSepolicyLoaded()  // SELinux dex2oat execute_no_trans 检查
override fun systemServerRequested() = SystemServerService.systemServerRequested
override fun dex2oatFlagsLoaded()  // dalvik.vm.dex2oat-flags 含 --inline-max-code-units=0
override fun getDex2OatWrapperCompatibility()  // Q 以上返回 Dex2OatServer.compatibility
override fun enableStatusNotification() = PreferenceStore.isStatusNotificationEnabled()
override fun setEnableStatusNotification(enable: Boolean)
override fun getUsers(): List<UserInfo>
```

## 管理器交互拓扑

```mermaid
flowchart TD
    M["Manager UI"] --> MS["ManagerService"]
    MS --> MD["ModuleDatabase"]
    MS --> CC["ConfigCache"]
    MS --> PS["PreferenceStore"]
    MS --> LM["LogcatMonitor"]
    MS --> DX["Dex2OatServer"]
    MS --> SSS["SystemServerService"]
    MS --> MG["ManagerGuard<br/>death recipient"]
    MS --> NV["NotificationManager"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class MS,MD,CC,PS,LM,DX,SSS,MG,NV class vec
    class M class plain
```

## 相关

- [ModuleService · libxposed 模块推模式](./module-service)
- [ConfigCache · 模块快照](./config-cache)
- [LogcatMonitor · 日志](./logcat-monitor)
- [Dex2OatServer · 兼容状态](./dex2oat-server)
- 寄生管理器见 [parasitic-manager-hooker](../zygisk/parasitic-manager-hooker)
