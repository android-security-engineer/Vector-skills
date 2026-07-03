# 🧰 ILSPManagerService · daemon 端实现

`ManagerService` 实现 `ILSPManagerService`，是管理器 App 调用的全套管理 API：模块启停、作用域读写、日志、安装卸载、系统查询。

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/ManagerService.kt`
> 📡 services AIDL · `ILSPManagerService`

## 职责

`object ManagerService : ILSPManagerService.Stub()` 是管理器面板背后的服务端。它代理 `ModuleDatabase`、`PreferenceStore`、`ConfigCache`、`LogcatMonitor` 等数据层，并持有寄生管理器的生命周期守卫。

## 模块管理 API

| 方法 | 委托 | 作用 |
| :--- | :--- | :--- |
| `enableModule(pkg)` | `ModuleDatabase.enableModule` | 启用模块 |
| `disableModule(pkg)` | `ModuleDatabase.disableModule` | 禁用模块 |
| `enabledModules()` | `ConfigCache.state.modules.keys` | 列出已启用模块 |
| `setModuleScope(pkg, scope)` | `ModuleDatabase.setModuleScope` | 写入作用域 |
| `getModuleScope(pkg)` | `ConfigCache.getModuleScope` | 读取作用域 |
| `setAutoInclude(pkg, on)` | `ModuleDatabase.setAutoInclude` | 自动包含开关 |
| `getAutoInclude(pkg)` | `ConfigCache.getAutoInclude` | 查询自动包含 |

## 作用域读写流程

```mermaid
graph LR
    MGR["管理器 App"]:::ui
    MGR -->|"setModuleScope"| MS["ManagerService"]:::vec
    MS --> DB["ModuleDatabase"]:::ok
    DB --> CC["ConfigCache 失效"]:::vec
    MGR -->|"getModuleScope"| MS
    MS -->|"缓存命中?"| CC2["ConfigCache"]:::vec
    CC2 -->|否| DB
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bfe6f5
    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

写操作直写数据库并使缓存失效，读操作优先走 `ConfigCache`。

## 寄生管理器守卫

`ManagerGuard` 实现死亡监听，绑定管理器进程 binder：

```kotlin
class ManagerGuard(binder: IBinder, pid: Int, uid: Int) : IBinder.DeathRecipient
```

- `obtainManagerBinder` 创建守卫、修复 WebView 权限、返回 `this`；
- `binderDied` 解绑并清空 `guard`；
- `tryRegisterManagerProcess` 配合 `preStartManager` 识别寄生 vs 用户安装的管理器进程。

WebView 权限修复：为寄生管理器的 `cache` 目录设 `xposed_file` 上下文并 chown 到目标 UID，解决 WebView 在被注入进程内读写缓存问题。

## 状态查询

| 方法 | 返回 |
| :--- | :--- |
| `getXposedApiVersion()` | `IXposedService.LIB_API` |
| `getXposedVersionCode()` / `getXposedVersionName()` | `BuildConfig` |
| `isSepolicyLoaded()` | `SELinux.checkSELinuxAccess(dex2oat, dex2oat_exec, execute_no_trans)` |
| `dex2oatFlagsLoaded()` | 检查 `--inline-max-code-units=0` 属性 |
| `systemServerRequested()` | `SystemServerService.systemServerRequested` |
| `getUsers()` | 真实用户列表 |

## 日志与安装

- `isVerboseLog` / `setVerboseLog`：控制 logcat 详细日志开关，启停 `LogcatMonitor`；
- `getVerboseLog` / `getModulesLog`：返回日志文件 PFD；
- `clearLogs`：刷新日志；
- `uninstallPackage`：通过反射构造 `IntentSender`，调 `PackageInstaller.uninstall`，`CountDownLatch` 同步结果；
- `installExistingPackageAsUser`：安装已存在包到指定用户；
- `forceStopPackage` / `reboot` / `clearApplicationProfileData`：系统操作代理。

## startActivityAsUserWithFeature

支持跨用户启动 Activity，必要时切换用户并锁屏。`queryIntentActivitiesAsUser` 返回 `ParcelableListSlice<ResolveInfo>`，跨进程传递大量 ResolveInfo。

## 相关

- 应用侧服务见 [application-service-impl](./application-service-impl)
- 数据层见 [reference/classes/daemon/config-cache](../daemon/config-cache)
- 日志监控见 [reference/classes/daemon/logcat-monitor](../daemon/logcat-monitor)
- AIDL 契约见 [reference/aidl/ilspmanagerservice](../../aidl/ilspmanagerservice)
