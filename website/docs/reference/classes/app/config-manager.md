# 🎛️ ConfigManager

> 📂 [`app/src/main/java/org/lsposed/manager/ConfigManager.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ConfigManager.java)
> 🟦 app 模块 · Daemon IPC 门面（全静态方法）

## 类职责

`public class ConfigManager` 是管理器 UI 与 Daemon（`ILSPManagerService`）之间的**唯一同步门面**。它本身无状态、无字段、不可实例化，所有方法都是 `static`：每个方法取 `LSPManagerServiceHolder.getService()` 拿到 Binder 代理，发起一次跨进程调用，并把 `RemoteException` 统一吞掉——记录日志后返回安全默认值（`-1` / `false` / `null` / 空列表）。

UI 层永远只碰 `ConfigManager`，绝不直接持有 `ILSPManagerService`，由此隔离 Binder 生命周期与异常处理。

## Binder 存活检测

```java
public static boolean isBinderAlive()
```

判断 Daemon 是否在线：`LSPManagerServiceHolder.getService() != null`。这是首页状态卡、导航项显隐、菜单启用的总开关。

## 版本信息

```java
public static int getXposedApiVersion()        // -1 失败
public static String getXposedVersionName()     // "" 失败
public static long getXposedVersionCode()       // -1 失败
```

## 模块与作用域

```java
public static String[] getEnabledModules()
public static boolean setModuleEnabled(String packageName, boolean enable)
public static List<ScopeAdapter.ApplicationWithEquals> getModuleScope(String packageName)
public static boolean setModuleScope(String packageName, boolean legacy, Set<ScopeAdapter.ApplicationWithEquals> applications)
public static boolean getAutoInclude(String packageName)
public static boolean setAutoInclude(String packageName, boolean enable)
```

`setModuleScope` 把 UI 的 `ApplicationWithEquals` 集合转成 AIDL `Application` 列表；`legacy` 为真时额外把模块自身（userId=0）塞进列表——旧式模块需自 hook。`getModuleScope` 反向转换并剔除模块自身包名。

## 包与用户管理

```java
public static List<PackageInfo> getInstalledPackagesFromAllUsers(int flags, boolean filterNoProcess)
public static PackageInfo getPackageInfo(String packageName, int flags, int userId) throws PackageManager.NameNotFoundException
public static List<UserInfo> getUsers()
public static boolean installExistingPackageAsUser(String packageName, int userId)
public static boolean uninstallPackage(String packageName, int userId)
public static boolean forceStopPackage(String packageName, int userId)
public static int startActivityAsUserWithFeature(Intent intent, int userId)
public static List<ResolveInfo> queryIntentActivitiesAsUser(Intent intent, int flags, int userId)
public static boolean reboot()
```

`installExistingPackageAsUser` 比对返回值常量 `INSTALL_SUCCEEDED = 1` 判定成败。

## 日志与通知

```java
public static boolean isVerboseLogEnabled()
public static boolean setVerboseLogEnabled(boolean enabled)
public static ParcelFileDescriptor getLog(boolean verbose)   // verbose ? getVerboseLog : getModulesLog
public static boolean clearLogs(boolean verbose)
public static boolean enableStatusNotification()
public static boolean setEnableStatusNotification(boolean enabled)
public static boolean setHiddenIcon(boolean hide)
```

## 状态诊断

```java
public static boolean isSepolicyLoaded()
public static boolean systemServerRequested()
public static boolean dex2oatFlagsLoaded()
public static int getDex2OatWrapperCompatibility()   // 返回 ILSPManagerService.DEX2OAT_* 常量
public static boolean isMagiskInstalled()            // 扫 PATH 环境变量里是否有 magisk 可执行文件
```

## 调用流程

```mermaid
flowchart TD
    A["UI 调用<br/>ConfigManager.xxx()"] --> B["LSPManagerServiceHolder<br/>.getService()"]
    B --> C{"Binder 在线?"}
    C -->|否| D["返回安全默认值<br/>-1/false/null"]
    C -->|是| E["IPC 调用<br/>ILSPManagerService"]
    E --> F{"RemoteException?"}
    F -->|否| G["返回真实结果"]
    F -->|是| H["Log.e + 返回默认值"]

    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef ipc fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef err fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    class A class ui
    class B,E class ipc
    class C,F class err
    class D,G,H class plain
```

## 相关

- [App · Application 入口](./app-entry) — 持有全局 ExecutorService / OkHttp
- [ILSPManagerService · AIDL 契约](../../aidl/ilspmanagerservice) — 被门面的接口
- [AIDL 数据模型](../../aidl/models) — `Application` / `UserInfo` 等
