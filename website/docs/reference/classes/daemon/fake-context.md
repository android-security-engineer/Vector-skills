# 🎭 FakeContext

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/utils/FakeContext.kt`
> 🟦 daemon 模块 · 无 Application 的伪造上下文

## 类职责

`class FakeContext(private val fakePackageName: String = "android") : ContextWrapper(null)` 是 daemon 进程使用的**桩上下文**。daemon 是注入到 `system_server` 子进程的纯服务进程，没有正常的 `Application`/`Context`，但 SQLite helper、Intent 构造、通知等框架 API 都需要一个 `Context`。`FakeContext` 伪装成 `"android"` 包，按需伪造各 Context 方法，让这些 API 在无 Application 的环境里正常工作。

## 关键设计

- 继承 `ContextWrapper(null)`——基类 `Context` 为 null，所有委托被短路，子类必须自行实现；
- 默认 `fakePackageName = "android"`，伪装成系统包以满足权限校验；
- 构造可传入自定义包名（少见，主要用默认值）。

## 伴生与缓存

```kotlin
companion object {
    @Volatile var nullProvider = false
    private var systemAppInfo: ApplicationInfo? = null
    private var fakeTheme: Resources.Theme? = null
}
```

`nullProvider` 控制 `getContentResolver` 是否返回 null（某些场景避免触发 provider 绑定）；`systemAppInfo`、`fakeTheme` 懒缓存。

## 覆写方法

```kotlin
override fun getPackageName(): String = fakePackageName
override fun getOpPackageName(): String = "android"
fun getUserId(): Int = 0
fun getUser(): android.os.UserHandle = HiddenApiBridge.UserHandle(0)
override fun getApplicationInfo(): ApplicationInfo
override fun getContentResolver(): ContentResolver?
override fun getTheme(): Resources.Theme
override fun getResources(): Resources = FileSystem.resources
override fun getAttributionTag(): String? = null
override fun getDatabasePath(name: String): File
override fun openOrCreateDatabase(name: String, mode: Int, factory: CursorFactory?): SQLiteDatabase
override fun openOrCreateDatabase(name: String, mode: Int, factory: CursorFactory, errorHandler: DatabaseErrorHandler?): SQLiteDatabase
```

| 方法 | 行为 |
| :--- | :--- |
| `getPackageName`/`getOpPackageName` | 返回 `"android"`，伪装系统身份 |
| `getUserId`/`getUser` | 固定 user 0 |
| `getApplicationInfo` | 懒查 `"android"` 包的 `ApplicationInfo`（TIRAMISU+ 用 `getApplicationInfo(pkg, 0L, 0)`），失败回退空 `ApplicationInfo` |
| `getContentResolver` | `nullProvider` 时返回 null，否则返回匿名 `ContentResolver(this)` |
| `getTheme` | 懒建 `resources.newTheme()` |
| `getResources` | 直接用 `FileSystem.resources`（预加载的框架资源） |
| `getAttributionTag` | `null`（Android 12+ 要求） |
| `getDatabasePath` | `File(name)`——daemon 传绝对路径，直接原样返回 |
| `openOrCreateDatabase` | 委托 `SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), ...)` |

## 使用场景

- `Database` 构造：`SQLiteOpenHelper(FakeContext(), dbPath, null, DB_VERSION)`——`FakeContext` 提供 `openOrCreateDatabase`/`getDatabasePath` 让 helper 在无 Application 环境建库；
- `NotificationManager` 构造通知需要 `Context`；
- `Intent` 构造与 `registerReceiver` 的包名解析。

注：`getDatabasePath` 注释明确"我们传绝对路径，所以直接返回"——`FileSystem.dbPath.absolutePath` 已是绝对路径，`File(name)` 不会破坏它。

## 在 daemon 中的位置

```mermaid
flowchart LR
    DB["Database"] --> FC["FakeContext"]
    FC -->|getDatabasePath| Path["FileSystem.dbPath (绝对)"]
    FC -->|openOrCreateDatabase| SQLite["SQLiteDatabase"]
    FC -->|getPackageName| Android["'android' 系统身份"]
    FC -->|getResources| Res["FileSystem.resources"]
    NM["NotificationManager"] --> FC
    Reg["registerReceiverCompat"] --> FC

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class FC,Path,SQLite,Android,Res class vec
    class DB,NM,Reg class plain
```

## 为何不用真实 Context

daemon 进程由 Zygisk 在 `system_server` 子进程里以 root 启动，没有走正常的 `ActivityThread` 应用启动流程，因此不存在合法的 `Application` 与 `ContextImpl`。直接 `new Context()` 不可行（抽象类），而 `ContextWrapper(null)` 是最轻量的可实例化基类。`FakeContext` 选择伪装成 `"android"` 而非空包名，是因为许多框架 API（如 `PackageManager.getPackageInfo` 的 caller 校验、`registerReceiver` 的权限推断）会取 `getPackageName()` 做信任判断，`"android"` 作为系统包能通过这些检查，避免被当作普通第三方应用拒绝。

## 与系统上下文的关系

`getResources` 直接返回 `FileSystem.resources`——这是 daemon 在 `ActivityThread.systemMain()` 后预加载的框架资源，绕过 `ContextImpl.getResources` 的正常链路。`getApplicationInfo` 也独立查 `"android"` 包而非依赖宿主 `ApplicationInfo`，保证 daemon 即便在 `system_server` 崩溃重启后的缓存清理窗口里仍能拿到稳定的 `ApplicationInfo`。`getContentResolver` 的 `nullProvider` 开关用于某些需要禁用 provider 绑定的场景，避免触发跨进程 provider 访问。

## 缓存与线程安全

`systemAppInfo` 与 `fakeTheme` 为 `companion object` 私有可变字段，非 `@Volatile`。由于 daemon 进程几乎所有 DB/通知访问都在主 Looper 或 `VectorDaemon.scope` 的 IO 协程里串行进行，且这两个字段只在首次访问时赋值一次后即只读，实际不存在可见性问题。`nullProvider` 标为 `@Volatile`，因为它是跨配置场景的开关，可能被不同调用路径修改，需保证可见性。`getDatabasePath` 返回 `File(name)` 而非缓存，因为每次调用 `name` 都是绝对路径，无需缓存。

## 相关

- [DaemonState · Database 构造](./daemon-state)
- [VectorDaemon · ActivityThread.systemMain 后的上下文](./vector-daemon)
- daemon 工具层见 [modules · daemon](../../modules/daemon)
