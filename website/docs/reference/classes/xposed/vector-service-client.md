# 📡 VectorServiceClient · Daemon 客户端

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorServiceClient.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorServiceClient.kt)
> 🟦 xposed 模块 · 应用进程侧的 `ILSPApplicationService` 单例代理

## 类职责

`object VectorServiceClient : ILSPApplicationService, IBinder.DeathRecipient` 是应用进程持有的、对 daemon 端 `ApplicationService` 的**单例 Binder 代理**。它封装模块列表查询、prefs 路径获取、寄生管理器 binder 请求等 IPC，所有调用都用 `runCatching` 包裹并在 binder 死亡时安全返回默认值。`init` 注册 `linkToDeath`，`binderDied` 时清理引用。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `service` | `ILSPApplicationService?` | 远端服务代理（私有） |
| `processName` | `String` | 当前进程名（私有 set） |

## 方法签名

```kotlin
// 初始化：绑定服务代理 + linkToDeath
@Synchronized
fun init(appService: ILSPApplicationService?, niceName: String)

// IPC 包装（均 runCatching，失败返回默认）
override fun isLogMuted(): Boolean
override fun getLegacyModulesList(): List<Module>
override fun getModulesList(): List<Module>
override fun getPrefsPath(packageName: String): String?
override fun requestInjectedManagerBinder(binder: List<IBinder>): ParcelFileDescriptor?

override fun asBinder(): IBinder?

// binder 死亡回调：unlink + 置空
override fun binderDied()
```

`init` 仅在 `service == null && binder != null` 时绑定，`linkToDeath(this, 0)` 失败则回滚 `service = null` 并记日志。各 IPC 包装的默认值：`isLogMuted→false`、模块列表→`emptyList()`、路径/binder→`null`。

## IPC 方法语义

| 方法 | 远端调用 | 失败默认值 | 用途 |
| :--- | :--- | :--- | :--- |
| `isLogMuted` | `service.isLogMuted` | `false` | 判断日志是否静默 |
| `getLegacyModulesList` | `service.legacyModulesList` | `emptyList()` | 取 legacy 模块清单 |
| `getModulesList` | `service.modulesList` | `emptyList()` | 取现代模块清单 |
| `getPrefsPath` | `service.getPrefsPath(pkg)` | `null` | 取模块 prefs 文件路径 |
| `requestInjectedManagerBinder` | `service.requestInjectedManagerBinder(binders)` | `null` | 寄生管理器请求注入 binder，返回 ParcelFileDescriptor |

## 容错设计

- **`runCatching` 包裹每次 IPC**：daemon 端崩溃或 binder 死亡时，应用进程不会因一次远程调用异常而崩溃，模块加载流程拿到默认值后降级；
- **`@Synchronized init`**：`linkToDeath` 与赋值原子化，避免多线程同时初始化产生重复绑定或悬空引用；
- **`binderDied` 主动 unlink**：死亡回调里先 `unlinkToDeath` 再置空 `service`，防止已死的 binder 被再次操作；
- **`processName` 私有 set**：仅 `init` 可写，外部只读，保证进程标识与 binder 绑定时刻一致。

## 生命周期

```mermaid
flowchart TD
    A["ApplicationService.registerHeartBeat"] --> B["VectorServiceClient.init"]
    B --> C["linkToDeath"]
    C --> D["就绪: 模块加载/prefs/binder"]
    E["daemon 端 binder 死亡"] --> F["binderDied"]
    F --> G["unlinkToDeath"]
    G --> H["service = null"]
    H --> I["后续 IPC 返回默认值"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,F,G class vec
    class E class plain
    class A,H,I class plain
```

## 集成要点

- `init` 在 `ApplicationService.registerHeartBeat` 成功后由框架调用，`niceName` 即当前进程名，模块通过 `module.service` 间接使用此客户端；
- 模块列表查询 `getModulesList`/`getLegacyModulesList` 每次都走 IPC，daemon 端返回的是当前进程作用域内的快照，不缓存；
- `requestInjectedManagerBinder` 用于寄生管理器场景：daemon 把管理器 binder 注入到目标进程，返回的 `ParcelFileDescriptor` 是跨进程传递句柄；
- binder 死亡后所有 IPC 返回默认值，模块装载流程会拿到空模块列表而降级为 no-op，进程本身不崩溃。
- `TAG = "VectorServiceClient"`，日志经 `org.lsposed.lspd.util.Utils.Log` 输出，与 daemon 端日志同体系便于关联排查。
- `asBinder` 返回当前代理的 `IBinder`，外部可用其做 `linkToDeath` 二次监听或 `isBinderAlive` 探测。

## 相关

- [VectorModuleManager · 模块管理](./vector-module-manager)（从本客户端取 `Module` 后加载）
- [VectorLifecycleManager · 生命周期分发](./vector-lifecycle-manager)
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
