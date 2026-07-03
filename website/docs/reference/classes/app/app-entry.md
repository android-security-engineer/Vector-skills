# 🚀 App

> 📂 `app/src/main/java/org/lsposed/manager/App.java`
> 🟦 app 模块 · Application 入口

## 类职责

`public class App extends Application` 是管理器进程的**入口 Application**。它承担四件事：绕过隐藏 API 限制、初始化全局单例（ExecutorService / OkHttpClient / 偏好 / 主题 / 语言）、注册包变更广播接收器以驱动模块/应用列表刷新、挂载未捕获异常处理器把崩溃日志写到下载目录并打包 Daemon 日志。

`static {}` 块在类加载时调 `HiddenApiBypass.addHiddenApiExemptions("")` 放开全部隐藏 API，并向主线程 `Looper` 注册一个**一次性 IdleHandler**——首次空闲时在后台线程预取应用列表标签、初始化 `ModuleUtil`/`RepoLoader` 单例、加载 webview HTML 模板，避免首屏卡顿。

## 关键常量与字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `TAG` | `String` | `"LSPosedManager"`，全局日志标签 |
| `PER_USER_RANGE` | `int` | `100000`，用户 uid 区间大小，用于 uid/userId 换算 |
| `isParasitic` | `boolean` | `!Process.isApplicationUid(myUid())`——管理器是否寄生在宿主进程（非独立 uid） |
| `HTML_TEMPLATE` / `HTML_TEMPLATE_DARK` | `FutureTask<String>` | 懒加载的 webview 模板 HTML |
| `instance` | `App` | 单例，`getInstance()` 返回 |
| `executorService` | `ExecutorService` | `newCachedThreadPool()`，全局后台线程池 |
| `MainHandler` | `Handler` | 绑定主线程 Looper |
| `okHttpClient` / `okHttpCache` | `OkHttpClient` / `Cache` | 仓库加载与更新检查用的 HTTP 客户端，50 MiB 缓存 |

## 静态访问器

```java
public static App getInstance()
public static SharedPreferences getPreferences()
public static ExecutorService getExecutorService()
public static Handler getMainHandler()
public static OkHttpClient getOkHttpClient()      // 懒构建，DEBUG 时加 HttpLoggingInterceptor
public static Cache getOkHttpCache()
public static Locale getLocale(String tag)         // null/"SYSTEM" → 系统语言
public static Locale getLocale()
```

## 生命周期

```java
@Override protected void attachBaseContext(Context base)   // 读历史进程退出原因填入 map
@Override public void onCreate()                            // 单例赋值、偏好初始化、主题/语言、广播、更新检查
```

`onCreate` 的关键步骤：

1. `setCrashReport()` 安装 `UncaughtExceptionHandler`——崩溃时写 `cache/crash/<epoch>.log`，并通过 `MediaStore.Downloads` 把 Daemon 全量日志（`getLogs(zipFd)`）落盘为 zip。
2. 首次启动按系统「私有 DNS」设置写入 `doh` 偏好。
3. `AppCompatDelegate.setDefaultNightMode(ThemeUtil.getDarkTheme())` + `LocaleDelegate.setDefaultLocale(...)`。
4. 注册 `org.lsposed.manager.NOTIFICATION` 广播：把 Daemon 转发的包变更（`ACTION_PACKAGE_ADDED/CHANGED/FULLY_REMOVED`、`ACTION_USER_*`）翻译成 `ModuleUtil.reloadSingleModule` / `reloadInstalledModules` 或 `AppHelper.getAppList(true)` 刷新。
5. `UpdateUtil.loadRemoteVersion()` 拉取远端版本。

## 启动与广播流程

```mermaid
flowchart TD
    A["进程启动"] --> B["static {} 放开隐藏 API"]
    B --> C["attachBaseContext"]
    C --> D["onCreate"]
    D --> E["setCrashReport"]
    D --> F["偏好 / 主题 / 语言"]
    D --> G["注册包变更广播"]
    D --> H["UpdateUtil.loadRemoteVersion"]
    I["主线程首次空闲"] --> J["IdleHandler: 预取 AppList 标签<br/>init ModuleUtil / RepoLoader<br/>加载 HTML 模板"]
    K["Daemon 推送通知"] --> L["BroadcastReceiver"]
    L --> M{"isXposedModule?"}
    M -->|是| N["ModuleUtil.reloadSingleModule"]
    M -->|否| O["AppHelper.getAppList(true)"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,D,E,F,G,H,I,J,K,L class core
    class M class branch
    class N,O class ui
```

## 崩溃处理

```java
private void setCrashReport()
```

安装的 `UncaughtExceptionHandler`：取 `OffsetDateTime.now()` 作时间戳，在 `cache/crash/` 下写 `<epoch>.log`（含版本号、时间、pid/uid、堆栈）；Android 10+ 还通过 `MediaStore.Downloads` 在文档目录创建 `LSPosed_crash_report<epoch>.zip`，用 `LSPManagerServiceHolder.getService().getLogs(zipFd)` 把 Daemon 全量日志写入 zip，失败则删 uri。最后转发给原 handler。

## 网络与语言

```java
@NonNull public static OkHttpClient getOkHttpClient()
@NonNull public static Cache getOkHttpCache()
public static Locale getLocale(String tag)
public static Locale getLocale()
```

`getOkHttpClient` 懒构建：加 50 MiB 缓存、`CloudflareDNS`（DoH），DEBUG 构建追加 `HttpLoggingInterceptor`（HEADERS 级别）。`getLocale(tag)`：空或 `"SYSTEM"` 返回 `LocaleDelegate.getSystemLocale()`，否则 `Locale.forLanguageTag`。`getLocale()` 读 `language` 偏好后转发。

## 相关
- [MainActivity · 单 Activity 路由](./main-activity)
- [ThemeUtil · 主题](./theme-util)
- [RepoLoader · 在线仓库](./repo-loader)
