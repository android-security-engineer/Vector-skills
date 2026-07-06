# 🖥️ CliSocketServer · CliHandler

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/env/CliSocketServer.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/env/CliSocketServer.kt)
> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/CliHandler.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/CliHandler.kt)
> 🟦 daemon 模块 · 本地 CLI 套接字与命令分发

## 类职责

这对类为 daemon 提供**非 IPC 的本地命令通道**：一个监听 Unix 域套接字的服务器，一个把 JSON 请求分发到 daemon 内部能力的命令处理器。供 `vec` CLI 工具在不经 Binder 的情况下查询状态、管理模块/作用域、配置开关、备份恢复数据库、清日志、流式获取日志。

## CliSocketServer

```kotlin
object CliSocketServer {
    private var isRunning = false
    fun start()
    private fun handleClient(socket: LocalSocket)
}
```

`start()` 在独立线程 `VectorCliListener`（`MIN_PRIORITY`）里：

1. `FileSystem.setupCli()` 取套接字路径；
2. `LocalSocket().bind(LocalSocketAddress(path, FILESYSTEM))` 绑定到文件系统；
3. `Os.listen(fd, 50)` 后 `LocalServerSocket(fd)` 包装；
4. 循环 `server.accept()`，每个连接 `VectorDaemon.scope.launch { handleClient(socket) }`；
5. `finally` 关闭 server/root socket 并删除套接字文件。

引用 `rootSocket`/`server`/`socketFile` 显式提到循环外，防止 GC 关闭 FD。

### handleClient · 鉴权与流式日志

```kotlin
val msb = input.readLong()
val lsb = input.readLong()
if (msb != BuildConfig.CLI_TOKEN_MSB || lsb != BuildConfig.CLI_TOKEN_LSB) { socket.close(); return }
```

先校验 128 位 UUID token（编译期注入）。读 `requestJson` 反序列化为 `CliRequest`。

`log/stream` 特殊处理：在交给 `CliHandler` 前拦截，按 `verbose` 选 `LogcatMonitor.getVerboseLog()`/`getModulesLog()`，回 `CliResponse(success=true, isFdAttached=true)`，再 `socket.setFileDescriptorsForSend(arrayOf(fd))` + `output.write(1)` 触发字节，借 ancillary data 把 FD 传给 CLI 进程。其余命令走 `CliHandler.execute(request)`。

## CliHandler

```kotlin
object CliHandler {
    fun execute(request: CliRequest): CliResponse
}
```

按 `request.command` 分发到 `handle*`，成功包 `CliResponse(success=true, data=...)`，异常包 `CliResponse(success=false, error=msg)`。

| command | action | 行为 |
| :--- | :--- | :--- |
| `status` | — | 版本、启用模块数、状态通知开关 |
| `modules` | `ls`/`enable`/`disable` | 列出（支持 `enabled`/`disabled` 过滤）、批量启用/禁用 |
| `scope` | `ls`/`add`/`set`/`rm` | 作用域查询/追加/覆盖/删除，`pkg/user` 解析 |
| `config` | `get`/`set` | `status-notification`/`verbose-log` 布尔读写 |
| `db` | `backup`/`restore`/`reset` | `VACUUM INTO` 备份、覆盖恢复、删库重建 |
| `log` | `clear` | 调 `ManagerService.clearLogs(verbose)`（`stream` 由 SocketServer 拦截） |

`handleModules.ls` 合并 `ConfigCache.state.modules.keys`（已启用快照）与 `ConfigCache.getInstalledModules()`（系统扫描），输出 `PACKAGE`/`UID`/`STATUS`。`handleDatabase.backup` 用 `VACUUM INTO '$path'` 生成一致且去碎片的副本，不长期持锁；`restore` 关闭 helper、复制文件、`requestCacheUpdate` 并回写 `misc_path`；`reset` 删主库与 `-wal`/`-shm` 后重建。

## 请求/响应模型与流转

```mermaid
flowchart TD
    CLI["vec CLI 进程"] -->|UUID token + JSON| Sock["CliSocketServer"]
    Sock --> Tok{"token 校验"}
    Tok -->|失败| Drop["close"]
    Tok -->|通过| Parse["反序列化 CliRequest"]
    Parse --> Cmd{"command"}
    Cmd -->|log/stream| FD["setFileDescriptorsForSend 传 FD"]
    Cmd -->|其他| CH["CliHandler.execute"]
    CH --> Resp["CliResponse JSON"]
    FD --> CLI
    Resp --> CLI

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class Sock,FD,CH,Resp class vec
    class Tok,Cmd class hot
    class CLI,Drop,Parse class plain
```

## 安全与并发模型

`isRunning` 守护 `start()` 幂等，避免重复监听。每个客户端连接在 `VectorDaemon.scope`（`Dispatchers.IO + SupervisorJob`）协程里处理，互不阻塞 accept 循环。`finally { socket.close() }` 确保异常也释放连接。UUID token 在编译期由 `BuildConfig.CLI_TOKEN_MSB/LSB` 注入，daemon 与 CLI 工具共享同一常量，无 token 的连接在读完 16 字节后立即关闭，杜绝未授权访问。流式日志的 FD 通过 ancillary data 传递后，`fis` 由方法结束自然回收，FD 所有权移交 CLI 进程。

## CliRequest / CliResponse 模型

`CliHandler.execute` 返回 `CliResponse(success, data, error, isFdAttached)`，由 `VectorIPC.gson` 序列化为 JSON。`isFdAttached=true` 仅在 `log/stream` 命令使用，提示 CLI 紧跟一次 `read` 取 FD。`handleDatabase.restore` 与 `reset` 会触发 `ConfigCache.requestCacheUpdate` 并回写 `misc_path` 偏好，确保重启后路径不丢失。

## 相关

- [VectorDaemon · 拉起 CliSocketServer](./vector-daemon)
- [ManagerService · clearLogs/setVerboseLog](./manager-service)
- [ConfigCache · 模块/作用域查询](./config-cache)
- [ModuleDatabase · 启用/禁用/作用域](./daemon-state)
- [LogcatMonitor · 日志文件](./logcat-monitor)
