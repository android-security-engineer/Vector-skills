# 📡 BridgeService

> 📂 [`zygisk/src/main/kotlin/org/matrix/vector/service/BridgeService.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/kotlin/org/matrix/vector/service/BridgeService.kt)
> 🟦 zygisk 模块 · `execTransact` 的 Kotlin 侧陷阱

## 类职责

`object BridgeService` 是 system_server 进程里**手动 Binder 事务**的 Kotlin 处理端。它不向 `ServiceManager` 注册，而是由 native `IPCBridge::HookBridge` 安装的 JNI 函数表覆盖（`SetTableOverride`）劫持 `Binder.execTransact`，把 `_VEC` 事务转交给本类的 `execTransact` 静态方法。它在 system_server 内完成两件事：接收 daemon 推送的 `IDaemonService` binder（`SEND_BINDER`），以及应答各进程的 ApplicationService binder 请求（`GET_BINDER`）。

## 常量与状态

```kotlin
private const val TRANSACTION_CODE = ('_'.code shl 24) or ('V'.code shl 16) or ('E'.code shl 8) or 'C'.code
private const val TAG = "VectorZygiskBridge"

private enum class Action { UNKNOWN, SEND_BINDER, GET_BINDER }

@Volatile private var serviceBinder: IBinder? = null
@Volatile private var service: IDaemonService? = null
```

`TRANSACTION_CODE` 即 `0x5F564543`（`_VEC`），与 native/daemon 端一致。`service` 持有 daemon 的 `IDaemonService` 代理。

## serviceRecipient · 死亡回收

```kotlin
private val serviceRecipient: DeathRecipient = DeathRecipient {
    Log.e(TAG, "Vector daemin service died.")
    serviceBinder?.unlinkToDeath(this.serviceRecipient, 0)
    serviceBinder = null
    service = null
}
```

daemon 崩溃时清空引用，使后续 `GET_BINDER` 返回 `service?.requestApplicationService(...)` 的 null 结果，触发调用方降级。

## getService

```kotlin
@JvmStatic fun getService(): IDaemonService? = service
```

供 system_server 内其他 Kotlin 组件（如 `VectorServiceClient`）取已建立的 daemon 服务代理。

## receiveFromBridge · 接收 daemon binder

```kotlin
private fun receiveFromBridge(binder: IBinder?)
```

1. `binder == null` 则记错返回；
2. `Binder.clearCallingIdentity()` 清调用身份后解旧 `linkToDeath`，`restoreCallingIdentity` 复位；
3. `Binder_allowBlocking(binder)` 包装（同步 fork 路径允许阻塞调用）；
4. `IDaemonService.Stub.asInterface` 建 `service`，`linkToDeath(serviceRecipient)`；
5. 反射取 `ActivityThread.currentActivityThread()` 的 `applicationThread` 与 `systemContext` 的 activity token，调 `service?.dispatchSystemServerContext(atBinder, token)`，把 system_server 上下文交给 daemon 注册广播/UID 观察者。

## onTransact · 事务分发

```kotlin
@JvmStatic
fun onTransact(data: Parcel, reply: Parcel?, flags: Int): Boolean
```

读 `actionIdx` 映射到 `Action`：

- `SEND_BINDER`：仅 `Binder.getCallingUid() == 0`（root，即 daemon 经 `sendToBridge` 提权后注入）放行，调 `receiveFromBridge(data.readStrongBinder())`，成功 `writeNoException` + `true`；否则 `false`；
- `GET_BINDER`：读 `processName`/`heartBeat`，调 `service?.requestApplicationService(callingUid, callingPid, processName, heartBeat)`，非 null 则 `writeNoException` + `writeStrongBinder` + `true`，否则 `false`；
- `UNKNOWN` → `false`。

## execTransact · JNI 入口

```kotlin
@JvmStatic
fun execTransact(obj: IBinder, code: Int, dataObj: Long, replyObj: Long, flags: Int): Boolean
```

native `ExecTransact_Replace` 通过 `env->CallStaticBooleanMethod(bridge_service_class_, exec_transact_replace_method_id_, obj, code, dataObj, replyObj, flags)` 调用本方法。逻辑：

1. `code != TRANSACTION_CODE` 立即 `return false`（交还原 `execTransact`）；
2. `dataObj.asParcel()`/`replyObj.asParcel()` 把 native 指针转 `Parcel`，null 则记错返回 false；
3. `try { onTransact(data, reply, flags) }`：
   - 异常且非 `FLAG_ONEWAY` 时 `reply.setDataPosition(0)` + `writeException(e)`，返回 `true`（已处理，以异常形式）；
4. `finally` `data.recycle()` + `reply.recycle()`。

## Trap 数据流

```mermaid
flowchart TD
    D["daemon sendToBridge<br/>(root)"] -->|_VEC SEND_BINDER| Trap["CallBooleanMethodV_Hook"]
    D2["应用进程 zygisk"] -->|_VEC GET_BINDER| Trap
    Trap -->|"code==_VEC"| ET["BridgeService.execTransact"]
    Trap -->|其他| Orig["原 Binder.execTransact"]
    ET --> Act{"Action"}
    Act -->|SEND_BINDER| RFB["receiveFromBridge<br/>dispatchSystemServerContext"]
    Act -->|GET_BINDER| RAS["service.requestApplicationService"]
    RFB --> Svc["service = IDaemonService"]
    RAS --> App["ApplicationService binder"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class Trap,ET,RFB,RAS,Svc,App class vec
    class Act class hot
    class D,D2,Orig class plain
```

## 相关

- [ipc-bridge · native Trap 安装](./ipc-bridge)
- [main-fork-common · system_server 引导](./main-fork-common)
- [vector-service · dispatchSystemServerContext](../daemon/vector-service)
- [application-service · requestApplicationService](../daemon/application-service)
