# Daemon 守护进程

Daemon 是一个独立的、root 权限的 Dalvik 可执行程序，经 `app_process` 引导，完全运行在标准 Android 应用沙箱之外。它是 Vector 的中央协调者、状态管理者和 IPC 资产服务器。

## 为什么需要它

目标进程受严格沙箱与 SELinux 约束，**无法安全地访问外部配置文件或 SQLite 数据库**。Daemon 把这些操作卸载到自己身上，提供一个 IPC 后端，向目标应用安全高效地交付内存映射资源、配置状态和 native 文件描述符。

## 目录结构

```text
src/main/
├── jni/                      # Native C++（dex2oat 包装、logcat 解析、obfuscation）
│   ├── CMakeLists.txt
│   ├── logcat.cpp / logcat.h     # native logcat 循环
│   ├── dex2oat.cpp               # dex2oat 包装器入口
│   ├── obfuscation.cpp / .h      # 混淆映射 native 消费
│   └── logging.h                 # LOG_TAG="VectorNativeDaemon"
└── kotlin/org/matrix/vector/daemon/
    ├── data/                 # SQLite schema、不可变状态缓存、文件操作
    │   ├── ConfigCache.kt       # @Volatile state + conflated channel
    │   ├── DaemonState.kt       # 不可变快照 data class
    │   ├── Database.kt          # SQLiteOpenHelper
    │   ├── FileSystem.kt        # 文件锁、SharedMemory、模块预加载、getLogs
    │   ├── ModuleDatabase.kt    # modules/scope 表读写
    │   └── PreferenceStore.kt   # configs 表 + 差分偏好
    ├── env/                  # UNIX domain socket 服务、native 进程监控
    │   ├── CliSocketServer.kt   # .cli_sock + UUID 令牌 + FD 传递
    │   ├── Dex2OatServer.kt     # abstract socket + SCM_RIGHTS FD 回送
    │   └── LogcatMonitor.kt     # native runLogcat + ThreadSafeLRU
    ├── ipc/                  # AIDL 端点（Application/Manager/Module/SystemServer）
    │   ├── ApplicationService.kt    # per 进程 Binder + DEX/OBF 事务码
    │   ├── ManagerService.kt        # ILSPManagerService（管理器交互）
    │   ├── ModuleService.kt         # IXposedService 推送（libxposed 模块）
    │   ├── SystemServerService.kt   # serial 代理 + system_server 引导
    │   ├── InjectedModuleService.kt # 远程偏好差分回调
    │   └── CliHandler.kt            # CLI 命令路由
    ├── system/               # 系统 binder 代理、通知 UI
    │   ├── SystemBinders.kt         # SystemService 委托 + DeathRecipient
    │   ├── SystemExtensions.kt      # ActivityManager/PackageManager 反射桥
    │   └── NotificationManager.kt   # 状态栏通知 + 作用域请求
    ├── utils/                # 上下文伪造、签名校验、JNI 桥
    ├── Cli.kt                # 命令行接口定义（CliRequest/CliResponse）
    ├── VectorDaemon.kt       # 主入口与 looper 初始化
    └── VectorService.kt      # 主 IDaemonService 实现
```

## 启动序列

Daemon 经 `app_process` 引导，入口在 [VectorDaemon.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/VectorDaemon.kt) 的 `main`。它先抢文件锁防多开、准备主 Looper、占位代理服务，再起环境子线程、预加载 DEX，最后等系统服务齐备、向 `system_server` 投递主 Binder：

```mermaid
sequenceDiagram
    autonumber
    participant main as VectorDaemon.main
    participant FS as FileSystem
    participant SSVC as SystemServerService
    participant ENV as 环境子线程
    participant SM as ServiceManager
    participant SS as system_server

    main->>FS: tryLock() 防多开（失败 exitProcess(0)）
    main->>main: 解析参数 --system-server-max-retry / --late-inject
    main->>main: setDefaultUncaughtExceptionHandler（崩了 exitProcess(1)）
    main->>main: Process.setThreadPriority(FOREGROUND)
    main->>main: Looper.prepareMainLooper()
    main->>SSVC: registerProxyService("serial" 或 "serial_vector")
    Note over SSVC,SM: addService 占位 + IServiceCallback 监听真服务
    main->>ENV: LogcatMonitor.start()
    main->>ENV: Dex2OatServer.start()（SDK≥Q）
    main->>ENV: CliSocketServer.start()
    main->>main: scope.launch 预加载框架 DEX（getPreloadDex）
    main->>main: ActivityThread.systemMain() 初始化系统框架
    main->>SM: waitForSystemService package/activity/user/appops（runBlocking 轮询 1s）
    main->>main: sendToBridge(VectorService, false, retry)
    main->>SM: Os.seteuid(0) 提权
    main->>SS: transact(_VEC, SEND_BINDER, VectorService Binder) ×3 重试
    Note over SS: BridgeService 截获，缓存 IDaemonService
    SS-->>main: reply.readException() 成功
    main->>SM: Os.seteuid(1000) 回落
    main->>main: 若非 verbose → LogcatMonitor.stopVerbose()
    main->>main: Looper.loop() 进入主消息循环
```

> [!TIP]
> `--late-inject` 参数把代理服务名从 `serial` 改成 `serial_vector`，并置 `isLateInject=true`——用于开机后由其它框架（如 LSPosed 兼容入口）补注入的场景。`--system-server-max-retry=N` 控制 system_server 无响应时重启它的次数上限（默认 1）。`sendToBridge` 用 `check(Looper.myLooper() == getMainLooper())` 强制必须在主线程执行——因为它要 `Os.seteuid(0)` 提权投递事务，再 `seteuid(1000)` 回落，把 root 暴露面压到事务窗口内。投递最多重试 3 次（每次 `Thread.sleep(1000)`），全失败且 `restartRetry>0` 则 `ctl.restart zygote` 强制重启系统。

## 并发与状态管理

为在不饿死 Android Binder 线程池的前提下处理并发 IPC 请求，Daemon 把后台 I/O 与状态读取分离开。

- **不可变状态容器**：[`DaemonState`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/data/DaemonState.kt) data class 持有所有已启用模块与进程作用域的冻结快照。IPC 线程读取它**无需加锁**。
- **原子交换**：底层 SQLite 变更时，Daemon 触发一个 conflated channel 请求。后台协程查询数据库、计算新模块拓扑、实例化新 `DaemonState`，并在 [`ConfigCache`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/data/ConfigCache.kt) 里**原子交换** `@Volatile var state` 引用。
- **偏好隔离**：高频的模块偏好读写与核心状态解耦。由 [`PreferenceStore`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/data/PreferenceStore.kt) 管理，偏好序列化为二进制 blob 并以**差分更新**推送给模块，避免不必要的缓存重建。

```mermaid
graph LR
    subgraph 写路径["写路径（低频）"]
        W1["SQLite 变更"]:::step --> W2["后台协程"]:::step
        W2 --> W3["新 DaemonState"]:::step
        W3 --> W4["原子交换引用"]:::step
    end
    subgraph 读路径["读路径（高频）"]
        R1["IPC 线程"]:::step --> R2["直接读当前 DaemonState（无锁）"]:::out
    end
    W4 -.可见性.-> R2
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## IPC 架构

Daemon 实现了多层 IPC 设计，结合 Android Binder 与 UNIX domain socket。它**避免**向 `ServiceManager` 注册标准 AIDL 服务，转而经 Zygisk 模块拦截 Binder 事务并主动向目标进程推送 Binder 引用。

完整的两阶段 Binder 中继见 [IPC 与 Binder 中继](./ipc)。Daemon 侧的四个关键机制：

### 1. system_server 引导

Daemon 注册 `IServiceCallback` 监听硬件代理服务（通常是 `serial`）的注册。一旦截获，Daemon 用自己的 binder 替换该代理服务。Zygisk 模块查询此代理服务，经 `SharedMemory` 拉取框架加载器 DEX 和类混淆映射。

同时 Daemon 向 `activity` 服务发送原始 `ACTION_SEND_BINDER` 事务。Zygisk 模块的 JNI hook 在事务到达 Activity Manager 前截获，提取并保存 Daemon 的主 `VectorService` binder。

### system_server 崩溃恢复状态机

`sendToBridge` 在投递主 Binder 前给 `activity` 服务挂 `DeathRecipient`。system_server 崩溃/重启时，Daemon 清缓存、重新占位 `serial`、降级 `managerPid`，并经主线程 Handler 重投。三次投递失败且 `restartRetry>0` 则 `ctl.restart zygote` 强制重启系统：

```mermaid
stateDiagram-v2
    [*] --> 投递中: sendToBridge (主线程, Os.seteuid(0))
    投递中 --> 已注入: _VEC(SEND_BINDER) 成功 (≤3 次重试)
    已注入 --> 已注入: pingBinder 正常
    已注入 --> 崩溃恢复: activity 服务 binderDied
    note right of 崩溃恢复: unlinkToDeath + clearSystemCaches
    崩溃恢复 --> 崩溃恢复: SystemServerService.binderDied 清引用
    崩溃恢复 --> 崩溃恢复: addService(serial) 重占位 + ManagerService.guard=null
    崩溃恢复 --> 投递中: Handler(mainLooper).post 重投 (restartRetry-1)
    投递中 --> 强制重启: 3 次重试均无响应 && restartRetry>0
    note right of 强制重启: ctl.restart zygote_secondary (32+64 位)
    note right of 强制重启: 或 ctl.restart zygote (单 ABI)
    强制重启 --> [*]: SystemProperties.set ctl.restart
    已注入 --> [*]: Os.seteuid(1000) 回落 + Looper 退出
```

> [!TIP]
> `clearSystemCaches` 反射清掉 `ServiceManager.sServiceManager`/`sCache` 与 `ActivityManager.IActivityManager_singleton`——system_server 重启后旧缓存里的 Binder 全是死引用，必须先抹掉，否则后续 `ServiceManager.getService` 会拿到死句柄。`restartSystemServer` 选目标时按 ABI 决定：32+64 位都有则重启 `zygote_secondary`（它是双 Zygote 架构里负责拉起 system_server 的那个），单 ABI 则直接重启 `zygote`。见 [VectorDaemon.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/VectorDaemon.kt) 的 `restartSystemServer`。

### 2. 目标应用会合

应用向 Daemon 请求框架访问，经 `system_server` 中转：

1. 应用查询 `activity` 服务，`system_server` 内的 Zygisk 模块截获。
2. `system_server` 把应用 UID/PID/进程名和新创建的心跳 `BBinder` 转发给 Daemon。
3. Daemon 核对 `ConfigCache` 判断应用是否在某已启用模块的作用域内。
4. 批准则返回 `ApplicationService` binder，由 `system_server` 转交应用。
5. Daemon 把 `DeathRecipient` 链接到心跳 binder，应用进程死亡时自动清理内部跟踪映射。
6. 应用用 `ApplicationService` binder 拉取自己的模块列表、框架 DEX 和混淆映射。

### 3. libxposed 模块注入

与目标应用的"请求访问"不同，Daemon **主动推送** API binder 给模块进程，仅限使用现代 libxposed API 的模块。

1. Daemon 向 Activity Manager 注册 `IUidObserver` 监控进程生命周期。
2. UID 活跃时，`ModuleService` 检查它是否属于已启用 libxposed 模块。
3. Daemon 取 `IXposedService` binder，经 `IActivityManager.getContentProviderExternal` 投递到按模块包名构造的合成 authority。
4. 执行 `IContentProvider.call`，动作 `SEND_BINDER`，Bundle 内装 binder。Binder 在 `Application.onCreate` 执行前注入模块进程。

### 4. native socket IPC

对 Java Binder 上下文之外的 native 组件，Daemon 提供两种 UNIX domain socket。

- **命令行接口**：[`CliSocketServer`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/env/CliSocketServer.kt) 在 `/data/adb/lspd/.cli_sock` 暴露文件系统 socket，监听线程名 `VectorCliListener`、优先级 `MIN_PRIORITY`。CLI 客户端用编译期 UUID 令牌（`BuildConfig.CLI_TOKEN_MSB/LSB`，先读两个 long 校验）认证，以结构化 JSON 通信（`CliRequest`/`CliResponse`，经 `VectorIPC.gson`）。实时日志流（`log stream`）场景下，Daemon 把日志文件的原始 `FileDescriptor` 经 `socket.setFileDescriptorsForSend` 附到回复 payload，客户端直接从 OS 级流缓冲读取。其余命令路由到 [`CliHandler`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/CliHandler.kt)：`status` / `modules` / `scope` / `config` / `db` / `log`，数据库备份用 `VACUUM INTO`、恢复后 `requestCacheUpdate` 触发重建。

```mermaid
graph TD
    ACC["客户端连 .cli_sock"]:::in
    ACC --> TOK{"readLong×2 == CLI_TOKEN?"}
    TOK -->|否| CL["socket.close()"]:::bad
    TOK -->|是| CMD{"CliRequest.command"}
    CMD -->|status| H1["handleStatus<br/>version + 模块数"]:::step
    CMD -->|modules| H2["handleModules<br/>ls/enable/disable"]:::step
    CMD -->|scope| H3["handleScope<br/>ls/add/set/rm"]:::step
    CMD -->|config| H4["handleConfig<br/>get/set status-notification/verbose-log"]:::step
    CMD -->|db| H5["handleDatabase<br/>backup(VACUUM INTO)/restore/reset"]:::step
    CMD -->|log| H6{"action?"}
    H6 -->|clear| H7["ManagerService.clearLogs"]:::step
    H6 -->|stream| FD["CliSocketServer 直接回 FD<br/>不经 CliHandler"]:::ok
    H1 & H2 & H3 & H4 & H5 & H7 --> RES["CliResponse{success,data|error}"]
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef bad fill:#3a2a2a,stroke:#e8a838,color:#ffd9b0
    classDef step fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

> [!TIP]
> `log stream` 是唯一不进 `CliHandler` 的命令——它在 `CliSocketServer.handleClient` 里直接拦截，因为要附 FD。流程是：`writeUTF(CliResponse{isFdAttached:true})` → `FileInputStream(logFile).fd` → `socket.setFileDescriptorsForSend([fd])` → `output.write(1)` 触发字节携带 SCM_RIGHTS 辅助数据。`db backup` 用 `VACUUM INTO '<path>'` 而非文件拷贝，产出的是去碎片、一致性的快照，不长期持锁；`db restore` 先 `close()` 数据库 helper、复制文件覆盖、再 `requestCacheUpdate` 触发 `performCacheUpdate` 重建状态。
- **Dex2Oat 包装器**：[`Dex2OatServer`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/env/Dex2OatServer.kt) 监听一个 abstract UNIX domain socket（路径由 native `getSockPath()` 在模块安装期随机化）。C++ `dex2oat` 包装器连此 socket，发一个字节索引（0/1=32 位 release/debug，2/3=64 位 release/debug，4/5=hooker lib），Daemon 经 `SCM_RIGHTS`（`setFileDescriptorsForSend`）回送对应预打开的 FD。

```mermaid
graph LR
    subgraph 文件socket["文件系统 socket（CLI）"]
        CLI["CliSocketServer<br/>/data/adb/lspd/.cli_sock"]:::core
        CLI -->|UUID 令牌 + JSON| H["CliHandler.execute"]:::core
        CLI -->|log stream| FD1["附 FileDescriptor 回送"]:::step
    end
    subgraph 抽象socket["abstract socket（dex2oat）"]
        D2O["Dex2OatServer<br/>随机名"]:::core
        D2O -->|1 字节索引| MAP["fdArray[0..5]"]:::step
        MAP -->|SCM_RIGHTS| FD2["回送 dex2oat/hooker FD"]:::step
    end
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
```

> [!TIP]
> `Dex2OatServer` 启动时按 ELF magic（`0x7F 'E' 'L' 'F'` + 第 5 字节判 32/64 位）扫描 `/apex/com.android.art/bin/`（Android 11+）或 `/apex/com.android.runtime/bin/`（Android 10）下的 `dex2oat`/`dex2oatd`，把 FD 一次性 `Os.open` 进 `fdArray`，避免运行期再开文件的 SELinux 风险。

## native 环境子系统

Daemon 依赖 native C++ 子系统拦截 Android 编译管线并直接解析系统日志缓冲，避开标准 shell 工具的开销与局限。

### AOT 编译劫持

详见 [dex2oat 编译劫持](./dex2oat)。Daemon 侧的关键：为确保替换后的编译器二进制对所有新进程可见，Daemon fork 一个特权子进程，用 `setns` 配 `CLONE_NEWNS` 经 `/proc/1/ns/mnt` 进入 init (PID 1) 挂载命名空间，对 `/apex` 下的目标编译器执行只读 bind mount。

为保障包装器连接无 SELinux 拒绝，Daemon 在绑定 socket 前动态写 `/proc/self/task/[tid]/attr/sockcreate`，指示内核用特定上下文（如 `u:r:dex2oat:s0` 或 `u:r:installd:s0`）标记该 abstract socket。

若包装器被禁用或不兼容，Daemon 卸载二进制并以 `resetprop` 把内联标志直接注入 `dalvik.vm.dex2oat-flags` 系统属性作为回退。Kotlin Daemon 经 `FileObserver` 监控 `/sys/fs/selinux/enforce` 及策略文件，在系统切到 permissive 或改动策略时动态重新挂载包装器。

#### dex2oat 兼容性状态机

`Dex2OatServer.compatibility` 有 5 个状态，驱动管理器 UI 的提示与 SELinux 观察器的重挂逻辑：

```mermaid
stateDiagram-v2
    [*] --> DEX2OAT_OK: 启动时 doMount(true) 成功
    DEX2OAT_OK --> DEX2OAT_SELINUX_PERMISSIVE: enforce 文件非 1
    DEX2OAT_OK --> DEX2OAT_SEPOLICY_INCORRECT: untrusted_app 可执行 dex2oat_exec
    DEX2OAT_SELINUX_PERMISSIVE --> DEX2OAT_OK: enforce 恢复且无策略错误
    DEX2OAT_SEPOLICY_INCORRECT --> DEX2OAT_OK: 策略修正后 doMount(true)
    DEX2OAT_OK --> DEX2OAT_MOUNT_FAILED: 重挂后 notMounted() 仍为真 → stopWatching
    DEX2OAT_OK --> DEX2OAT_CRASHED: socket 循环异常 → doMount(false) → stopWatching
    DEX2OAT_CRASHED --> [*]: 不再观察，需用户介入
```

### native logcat 监控

Daemon 不依赖标准 logcat shell 执行，而是运行一个 native C++ 进程直接对接 Android `liblog` 缓冲（`LOG_ID_MAIN` 与 `LOG_ID_CRASH`）。入口在 [`LogcatMonitor.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/env/LogcatMonitor.kt) 的 `runLogcat()`（native），由 `VectorDaemon.scope` 协程阻塞式调用。

native 解析器对日志事件做**零拷贝**处理，严格按预定义精确标签（Magisk、KernelSU）和前缀标签（dex2oat、Vector、LSPosed）过滤输出，写入两个轮转日志文件（一个模块框架、一个详细系统调试），达 4MB 自动轮转。

为控制这个隔离的 native 循环，Kotlin Daemon 把特定字符串触发器（如 `!!refresh_modules!!`、`!!start_verbose!!`）直接注入 Android 日志流。C++ 解析器截获来自自身父 PID 的这些消息，动态轮转文件描述符或改变详尽度状态，无需额外 IPC 开销。

```mermaid
graph LR
    LIB["Android liblog 缓冲<br/>LOG_ID_MAIN / LOG_ID_CRASH"]:::ui
    LIB -->|零拷贝| NLC["native runLogcat 线程"]:::core
    NLC -->|过滤标签/前缀| MF["模块框架日志（4MB 轮转）"]:::core
    NLC -->|过滤标签/前缀| VF["详细系统调试日志（4MB 轮转）"]:::core
    KOT["Kotlin Daemon"]:::core -->|Log.i 触发器| LIB
    KOT -.父 PID 截获.-> TR["!!refresh_modules!!<br/>!!start_verbose!!<br/>!!stop_verbose!!"]:::step
    TR -->|JNI 回调 refreshFd| NLC
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
```

> [!TIP]
> `LogcatMonitor` 还带一个 `ThreadSafeLRU`（默认 10 条）管理历史日志文件，并通过 `checkFd` 检测 `st_nlink == 0`（文件被外部删除但 FD 仍打开）——此时从 `/proc/self/fd` 读符号链接把文件"复活"回原位，保证日志流不断。`refreshFd(isVerboseLog)` 由 native 经 JNI 回调，返回新 detach 的 `ParcelFileDescriptor` FD 给 native 写。
