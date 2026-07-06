# 🧵 线程模型

Vector 跨多个进程，每个进程内部又有自己的线程结构。这一页把各进程的线程角色拆开，讲清楚谁在哪个线程上跑、为什么这样分。理解线程边界，是理解并发安全与性能特征的前提。

## 进程与线程全景

```mermaid
graph TD
    subgraph DAEMON["Daemon 进程（root）"]
        DL["主 Looper 线程"]:::core
        DBP["Binder 线程池（~15）"]:::core
        BG["后台协程（写路径）"]:::core
        NLC["native logcat 线程"]:::core
        SWD["sWatcherDaemon（SELinux 监控）"]:::core
        CSS["CliSocketServer 线程"]:::core
    end
    subgraph SS["system_server 进程"]
        ST["Binder 线程池"]:::ui
        STB["BridgeService（_VEC 处理）"]:::core
    end
    subgraph APP["目标应用进程"]
        AT["主线程 + Binder 线程池"]:::ui
        FW["框架引导线程"]:::core
    end
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
```

## Daemon 线程结构

Daemon 是线程最复杂的进程，因为它是中央协调者。

| 线程 | 角色 | 说明 |
| :--- | :--- | :--- |
| 主 Looper | 入口与生命周期 | `VectorDaemon` 初始化 looper，管理进程生命周期 |
| Binder 线程池 | 高频读路径 | 服务 `GET_BINDER`、模块列表、偏好读等 IPC，无锁读 `DaemonState` |
| 后台协程 | 低频写路径 | conflated channel 触发，重建 `DaemonState` 并原子交换 |
| native logcat | 日志解析 | 独立 native C++ 线程，对接 `liblog` 缓冲，零拷贝过滤 |
| sWatcherDaemon | SELinux 监控 | 监控 `/sys/fs/selinux/enforce` 与策略文件，动态重挂 dex2oat 包装器 |
| CliSocketServer | CLI 服务 | 在 `.cli_sock` 暴露命令行接口，UUID 令牌认证 |

```mermaid
graph TD
    subgraph 读["读路径：Binder 线程池（高频，无锁）"]
        R1["线程1 GET_BINDER"] --> RS["读 DaemonState"]:::ok
        R2["线程2 模块列表"] --> RS
    end
    subgraph 写["写路径：后台协程（低频，串行）"]
        W1["配置变更"] --> CH["conflated channel"]:::step
        CH --> W2["重建 state"]:::step
        W2 --> SW["原子交换"]:::step
    end
    subgraph 辅["辅助线程"]
        NL["native logcat"]:::core
        SW2["sWatcherDaemon"]:::core
        CS["CliSocketServer"]:::core
    end
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

### 协程作用域与异常隔离

所有后台协程共用 [VectorDaemon.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/VectorDaemon.kt) 的单例作用域：

```kotlin
val scope = CoroutineScope(Dispatchers.IO + SupervisorJob() + exceptionHandler)
```

- `Dispatchers.IO`：复用 JVM 的共享后台线程池，I/O 密集型任务（DB 查询、文件读写）的默认归宿。
- `SupervisorJob`：单个子协程失败不会取消兄弟协程——`LogcatMonitor`、`Dex2OatServer`、`CliSocketServer` 互不影响。
- `CoroutineExceptionHandler`：未捕获异常只记日志，不让 Daemon 进程崩。外加进程级 `Thread.setDefaultUncaughtExceptionHandler` 兜底，崩了就 `exitProcess(1)` 让 init 重拉。

```text
                       VectorDaemon.scope
              CoroutineScope(Dispatchers.IO + SupervisorJob + handler)
                               │
        ┌──────────────┬───────┴────────┬───────────────┬──────────────┐
        ▼              ▼                ▼               ▼              ▼
  LogcatMonitor   Dex2OatServer   CliSocketServer   ConfigCache    dumpProps
   .start()         .start()        .start()        init{}         AndDmesg
        │              │                │               │              │
        ▼              ▼                ▼               ▼              │
  runLogcat()     runSocketLoop()   handleClient()  for(req in      getprop
  (native 阻塞)    (accept 循环)     (per 连接)      channel){        dmesg
                                                    performCacheUpdate}
   │ SupervisorJob：任一失败不影响兄弟
   │ CoroutineExceptionHandler：Log.e 后吞掉
   │ 进程级 UncaughtExceptionHandler：exitProcess(1)
```

> [!TIP]
> | 线程/协程 | 实际线程名 / 调度器 | 入口 |
> | :--- | :--- | :--- |
> | 主 Looper | `main`（`THREAD_PRIORITY_FOREGROUND`） | `VectorDaemon.main` → `Looper.loop()` |
> | CLI 监听 | `VectorCliListener`（`MIN_PRIORITY`） | `CliSocketServer.start` |
> | 配置写 | `Dispatchers.IO` 池（`DefaultDispatcher-worker-N`） | `ConfigCache` init 块的 `for` 循环 |
> | logcat | `Dispatchers.IO` 协程 + native 线程 | `LogcatMonitor.start` → `runLogcat()` |
> | dex2oat socket | `Dispatchers.IO` 协程 | `Dex2OatServer.start` → `runSocketLoop()` |
> | dex2oat SELinux 观察器 | `FileObserver` 内部线程 | `selinuxObserver.startWatching()` |
> | dumpProps/dmesg | `Dispatchers.IO` 协程 | `LogcatMonitor.init` → `dumpPropsAndDmesg()` |

### 为什么这样分

- **读写在各自线程域**：Binder 线程池绝不能阻塞等数据库，否则池耗尽。读直接拿不可变引用，写走后台协程串行化。详见 [Daemon 并发模型](./concurrency)。
- **native logcat 独立线程**：日志解析是 I/O 密集且需持续监听 `liblog` 缓冲，与 Binder 逻辑无关，独立线程避免互相阻塞。
- **sWatcherDaemon 独立**：用 `FileObserver` 监控 SELinux 状态变化，需及时响应（系统切 permissive 时重挂包装器），不能和慢操作抢线程。

## native logcat 线程

Daemon 不依赖标准 `logcat` shell 命令，而是运行一个 native C++ 线程直接对接 Android `liblog` 缓冲（`LOG_ID_MAIN` 与 `LOG_ID_CRASH`）。

```mermaid
graph LR
    L["Android liblog 缓冲"]:::ui
    L --> N["native 解析线程"]:::core
    N -->|零拷贝过滤| F1["模块框架日志（轮转 4MB）"]:::core
    N -->|零拷贝过滤| F2["详细系统调试日志（轮转 4MB）"]:::core
    N -.截获父 PID 触发器.-> TR["!!refresh_modules!! / !!start_verbose!!"]:::step
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

关键：解析器对来自自身父 PID 的触发器字符串做反应，动态轮转 FD 或改变详尽度，无需额外 IPC。详见 [日志体系](./logging)。

## sWatcherDaemon

监控 SELinux 状态，保障 dex2oat 包装器在策略变化后仍能工作。

| 监控对象 | 触发动作 |
| :--- | :--- |
| `/sys/fs/selinux/enforce` | 系统切 permissive 时重新挂载包装器 |
| SELinux 策略文件 | 策略改动时动态适配 |

详见 [SELinux 边界处理](./selinux) 与 [dex2oat 编译劫持](./dex2oat)。

## system_server 线程

system_server 的标准 Binder 线程池负责处理事务。Vector 在此之上加了 `BridgeService`——当 `_VEC` 事务码到达时，在 Binder 线程上执行中转逻辑（转发给 Daemon、写回 ApplicationService Binder）。

- 不额外开线程，复用 system_server 已有线程池。
- 中转逻辑轻量（转发 + parcel 读写），不阻塞。
- 其余事务码原样放行，对系统无影响。

### system_server ↔ Daemon 的线程交互

Daemon 主动投递主 Binder 时，事务在 system_server 的某个 Binder 线程上被 `BridgeService.execTransact` 截获；此后应用发 `GET_BINDER`，system_server 的另一个 Binder 线程调 Daemon 的 `requestApplicationService`（这次是跨进程 Binder，落在 Daemon 的 Binder 线程池）：

```mermaid
sequenceDiagram
    autonumber
    participant VD as Daemon 主线程
    participant SS1 as system_server Binder 线程 A
    participant BS as BridgeService
    participant DBP as Daemon Binder 线程池
    participant APP as 应用 Binder 线程

    VD->>SS1: transact(_VEC, SEND_BINDER)
    SS1->>BS: execTransact (JNI hook)
    BS->>BS: receiveFromBridge 缓存 IDaemonService
    BS-->>VD: reply
    Note over APP: 应用启动
    APP->>SS1: transact(_VEC, GET_BINDER)
    SS1->>BS: execTransact
    BS->>DBP: service.requestApplicationService (跨进程)
    DBP->>DBP: 读 DaemonState 无锁
    DBP-->>BS: ApplicationService Binder
    BS-->>APP: reply 写回 Binder
```

> [!TIP]
> `BridgeService` 用 `Binder_allowBlocking(binder)` 给 Daemon Binder 加阻塞许可——`Main.forkCommon` 的同步 fork 路径里调它不会被 Binder 的"非阻塞调用方"检查卡住。Daemon 侧的 [`SystemService`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/system/SystemBinders.kt) 委托用 `@Volatile instance` + `synchronized` + `DeathRecipient` 清缓存，保证系统服务死了能重查、不死时只查一次。

## 目标应用线程

应用进程内，框架在主线程或 Binder 线程上引导，模块 Hook 回调通常在被 Hook 方法调用的线程上执行。

| 角色 | 线程 |
| :--- | :--- |
| 框架引导（`Main.forkCommon`） | 进程初始化线程 |
| 模块 `onCreate` / Hook 注册 | 通常主线程 |
| Hook 回调 | 被Hook方法调用方的线程 |

native 注入发生在 Zygisk 的 `postAppSpecialize`，运行在 fork 后的子进程主线程。此时尚未执行 `Application.onCreate`——Vector 在这里同步拉 Binder、取 DEX、装 ART hook，全部完成后才把控制权交回 Android 框架。这条路径在 [module.cpp](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/cpp/module.cpp) 的 `postAppSpecialize`，关键调用链：

```mermaid
graph TD
    POST["postAppSpecialize (主线程)"]:::core
    POST --> RB["IPCBridge.RequestAppBinder"]:::step
    RB --> FD["FetchFrameworkDex + FetchObfuscationMap"]:::step
    FD --> LD["LoadDex (InMemoryDexClassLoader)"]:::step
    LD --> ART["InitArtHooker / InitHooks"]:::step
    ART --> SEC["SetupEntryClass (查混淆入口类)"]:::step
    SEC --> FC["FindAndCall forkCommon"]:::step
    FC --> UL["SetAllowUnload(false) 防卸载"]:::out
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#143a4a,stroke:#4fb3d8,color:#cfeefb
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

> [!TIP]
> `lsplant::InitInfo` 的 `inline_hooker`/`inline_unhooker` 走 `HookInline`/`UnhookInline`（Dobby 风格），`art_symbol_resolver` 走 `ElfSymbolCache::GetArt()`——LSPlant 的 ART 符号解析在 native 线程上做惰性缓存，线程安全。`generated_class_name = "Vector_"`、`generated_source_name = "Dobby"` 是 LSPlant 生成 trampoline 类的命名前缀，避免与业务类撞名。

::: warning 模块线程安全
模块的 Hook 回调可能在任意线程执行（取决于被 Hook 方法在哪个线程被调用）。模块若维护共享状态，必须自行处理同步——框架不替你保证。
:::

## 线程安全保证汇总

| 机制 | 保证 |
| :--- | :--- |
| 不可变 `DaemonState` | 多线程读无锁安全 |
| 原子引用交换 | 写读不竞争，无撕裂 |
| conflated channel | 写串行化、去抖 |
| HookBridge 原子操作 | 备份方法 trampoline 设置线程安全 |
| `ElfSymbolCache` 惰性初始化 | 线程安全缓存 |
| 模块状态保存映射 | `ParasiticManagerHooker` 用并发静态映射 |

## 相关链接

- [Daemon 并发模型](./concurrency) — 读写分离细节
- [Daemon 守护进程](./daemon) — 整体职责
- [日志体系](./logging) — native logcat 线程
- [进程生命周期与心跳](./lifecycle) — 死亡回调线程
