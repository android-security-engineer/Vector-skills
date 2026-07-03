# 🛰️ VectorService

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/VectorService.kt`
> 🟦 daemon 模块 · `IDaemonService` 的主实现

## 类职责

`object VectorService : IDaemonService.Stub()` 是 Vector daemon 对外暴露的**根 Binder 服务**。它由 `VectorDaemon` 通过桥事务注入到 `system_server`，再由 zygisk 端的 `BridgeService` 拦截 `execTransact` 后取回。其核心职责：

- 接收 `system_server` 派发的上下文（`appThread`、`activityToken`），注册系统广播与 UID 观察者；
- 响应应用进程的 `requestApplicationService` 请求，按作用域决定是否发放 `ApplicationService`；
- 转发 `preStartManager` 给 `ManagerService`；
- 派发启动完成、配置变更、包变更、作用域请求等系统事件。

## 关键字段与常量

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `bootCompleted` | `Boolean` | 是否已收到 `LOCKED_BOOT_COMPLETED` |
| `ACTION_SECRET_CODE` | `String` | 拨号盘暗码动作，Q 以上用 `TelephonyManager.ACTION_SECRET_CODE` |
| `EXTRA_REMOVED_FOR_ALL_USERS` | `String` | `"android.intent.extra.REMOVED_FOR_ALL_USERS"` |
| `ACTION_MANAGER_NOTIFICATION` | `String` | `${DEFAULT_MANAGER_PACKAGE_NAME}.NOTIFICATION`，通知管理器刷新 |
| `FLAG_RECEIVER_INCLUDE_BACKGROUND` | `Int` | `0x01000000` |
| `FLAG_RECEIVER_FROM_SHELL` | `Int` | `0x00400000` |

## IDaemonService 实现

```kotlin
override fun dispatchSystemServerContext(appThread: IBinder?, activityToken: IBinder?)
override fun requestApplicationService(
    uid: Int, pid: Int, processName: String, heartBeat: IBinder
): ILSPApplicationService?
override fun preStartManager()
```

`requestApplicationService` 校验调用方必须为 `uid == 1000`（system_server），随后判断进程是否已注册、是否为管理器进程或命中作用域；只有 `ApplicationService.registerHeartBeat` 成功才返回单例。

## 广播接收与 UID 观察

`registerReceivers()` 用 `registerReceiverCompat` 注册一组 `IIntentReceiver.Stub`，全部以 `android.permission.BRICK` 限制为系统级发送方，仅暗码接收器以 `CONTROL_INCALL_EXPERIENCE` 导出。`createReceiver()` 在协程里按 action 分发：

```kotlin
when (intent.action) {
    Intent.ACTION_LOCKED_BOOT_COMPLETED -> dispatchBootCompleted()
    Intent.ACTION_CONFIGURATION_CHANGED -> dispatchConfigurationChanged()
    NotificationManager.openManagerAction -> ManagerService.openManager(intent.data)
    ACTION_SECRET_CODE -> ManagerService.openManager(intent.data)
    NotificationManager.moduleScopeAction -> dispatchModuleScope(intent)
    else -> dispatchPackageChanged(intent)
}
```

非有序广播需手动 `finishReceiver` 释放系统队列，Android 14+ 用 `appThread.asBinder()` 作为 token。

UID 观察者实现 `IUidObserver.Stub`，将 `onUidActive`/`onUidCachedChanged`/`onUidIdle` 映射到 `ModuleService.uidStarts`，`onUidGone` 映射到 `ModuleService.uidGone`，用于 libxposed 模块的推模式 binder 投递。

## 包变更派发

`dispatchPackageChanged(intent)` 是最复杂的方法：

- 解析 `moduleName`、`userId`、`isRemovedForAllUsers`，查 `ApplicationInfo.metaData` 的 `xposedminversion` 或 `ConfigCache.getModuleApkPath` 判断是否 Xposed 模块；
- `ACTION_PACKAGE_FULLY_REMOVED`：删偏好、按用户范围从 `ModuleDatabase` 移除；
- `ACTION_PACKAGE_ADDED/CHANGED`：更新 APK 路径；非模块但曾为作用域目标则请求缓存刷新；新增包时为所有 `auto_include` 模块自动追加作用域；
- `ACTION_UID_REMOVED`：若涉及模块或作用域则刷新缓存；
- 管理器自身变更走 `ConfigCache.updateManager`；
- 向寄生管理器与独立管理器广播 `ACTION_MANAGER_NOTIFICATION`；
- 真实模块更新（非移除）触发 `NotificationManager.notifyModuleUpdated`。

## 作用域请求派发

`dispatchModuleScope(intent)` 解析 `module://pkg:userId/scopePkg?action=...` 形态的 URI，回调 binder 来自 extras。`approve` 追加作用域并 `onScopeRequestApproved`，`deny`/`delete` 返回失败，`block` 写入 `scope_request_blocked` 集合并永久拒绝。

## 事件流转

```mermaid
flowchart TD
    A["system_server / zygisk"] --> B["dispatchSystemServerContext"]
    B --> C["registerReceivers"]
    C --> D["IIntentReceiver"]
    D --> E{"action 分发"}
    E -->|BOOT| F["dispatchBootCompleted"]
    E -->|PACKAGE| G["dispatchPackageChanged"]
    E -->|SCOPE| H["dispatchModuleScope"]
    G --> I["ModuleDatabase / ConfigCache"]
    H --> J["IXposedScopeCallback"]
    K["应用进程"] --> L["requestApplicationService"]
    L --> M{"作用域命中?"}
    M -->|是| N["ApplicationService"]
    M -->|否| O["返回 null"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,D,F,G,H,I,J,N class vec
    class E,M class hot
    class A,B,K,L,O class plain
```

## 相关

- [VectorDaemon · 入口与 looper](./vector-daemon)
- [ApplicationService · 应用进程 IPC](./application-service)
- [ManagerService · 管理器服务](./manager-service)
- [ConfigCache · 不可变快照](./config-cache)
- daemon 模块总览见 [modules · daemon](../../modules/daemon)
