# Daemon 并发模型

Daemon 是所有目标进程的中央协调者，同时服务大量 IPC 请求。它要在不饿死 Binder 线程池的前提下处理并发，又要让高频的配置读取不阻塞。Vector 的解法是**不可变状态 + 原子交换 + 写读分离**——读路径完全无锁，写路径后台串行。这一页拆解这条并发管线。

## 问题：Binder 线程池不能阻塞

Android Binder 线程池是有限的（默认 15 个左右）。每个目标进程的 `GET_BINDER`、模块列表查询、偏好读写都是一次 IPC。若每次读都加锁等数据库查询，线程池很快耗尽，新 IPC 排队超时，目标进程注入失败。

```mermaid
graph TD
    subgraph 锁模型["加锁模型 ✗"]
        L1["IPC 线程"] --> L2["等数据库锁"]:::bad
        L2 -.阻塞.-> L3["Binder 线程池耗尽"]:::bad
    end
    subgraph Vector["Vector 读写分离 ✓"]
        V1["IPC 线程"] --> V2["直接读不可变 DaemonState<br/>无锁"]:::def
        V3["后台协程串行写"] --> V4["原子交换引用"]:::step
    end
    classDef bad fill:#3a2a2a,stroke:#e8a838,color:#ffd9b0
    classDef def fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

## 不可变 DaemonState

`DaemonState` 是一个 data class，持有所有已启用模块与进程作用域的**冻结快照**。它是不可变的——构造完成后绝不修改。IPC 线程读取它**无需加锁**，因为不可变对象天生线程安全：多个线程同时读同一个引用，谁也不会读到半成品状态。

```mermaid
graph TD
    DS["DaemonState（不可变）"]:::core
    DS --> DS1["已启用模块列表"]
    DS --> DS2["进程作用域映射"]
    DS --> DS3["模块拓扑快照"]
    R1["IPC 线程 A 读"]:::reader -.无锁.-> DS
    R2["IPC 线程 B 读"]:::reader -.无锁.-> DS
    R3["IPC 线程 C 读"]:::reader -.无锁.-> DS
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef reader fill:#1a2030,stroke:#6b7689,color:#cdd6e3
```

## 写路径：原子交换

配置变更（用户在管理器里勾选模块、改作用域）是低频操作。变更经 SQLite 落库后，Daemon 走写路径：

1. **触发**：底层 SQLite 变更触发一个 conflated channel 请求。
2. **构建**：后台协程查询数据库，计算新模块拓扑，实例化新 `DaemonState`。
3. **交换**：在 `ConfigCache` 里**原子交换**引用——把缓存指针从旧 state 换成新 state。
4. **可见**：此后 IPC 线程读到的是新 state。

```mermaid
graph LR
    subgraph 写路径["写路径（低频，后台串行）"]
        W1["SQLite 变更"]:::step --> W2["conflated channel 请求"]:::step
        W2 --> W3["后台协程查库 + 算拓扑"]:::step
        W3 --> W4["新 DaemonState"]:::step
        W4 --> W5["原子交换 ConfigCache 引用"]:::step
    end
    subgraph 读路径["读路径（高频，无锁）"]
        R1["IPC 线程"] --> R2["读当前 DaemonState"]:::ok
    end
    W5 -.可见性.-> R2
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

### conflated channel 的作用

conflated channel 是一种"只保留最新值"的通道：若多个变更在后台协程消费前堆积，旧请求被丢弃，只处理最新。这保证了写路径**串行化且去抖**——用户快速连续改几次作用域，不会触发多次完整数据库重建，只重建最后一次。

### 原子交换为何安全

引用赋值在 JVM 层是原子的（`volatile` 引用写）。旧 state 引用被换掉的瞬间，正在读旧 state 的线程仍持有旧引用，读完即释；新读请求拿到新引用。没有读写竞争，没有撕裂状态。

## 偏好隔离与差分更新

模块偏好（`SharedPreferences`）是高频读写，但语义上和核心状态（模块列表/作用域）不同——偏好是每个模块自己的键值对，变更粒度小、频率高。若每次偏好变更都重建整个 `DaemonState`，写路径会被打爆。

为此偏好由 `PreferenceStore` 独立管理，与核心状态解耦：

- 偏好序列化为二进制 blob。
- 以**差分更新**推送给模块——只传变化的部分，不重传整个偏好集。
- 避免不必要的缓存重建。

```mermaid
graph TD
    DS["DaemonState（核心状态）"]:::core
    DS -.解耦.-> PS["PreferenceStore（独立）"]:::core
    PS --> PS1["偏好序列化为二进制 blob"]:::step
    PS1 --> PS2["差分计算"]:::step
    PS2 --> PS3["只推送变化部分给模块"]:::step
    NOTE["偏好高频变更<br/>不触发 DaemonState 重建"]:::note
    PS3 -.说明.-> NOTE
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef note fill:#1a2030,stroke:#6b7689,color:#cdd6e3
```

## 读写分离的全景

把读路径和写路径彻底分到不同线程域：

| 路径 | 频率 | 线程 | 加锁 | 操作 |
| :--- | :--- | :--- | :--- | :--- |
| 读 | 高频 | Binder IPC 线程池 | 无锁 | 读当前 `DaemonState` 引用 |
| 写（核心） | 低频 | 单后台协程 | 串行 | 重建 `DaemonState` + 原子交换 |
| 写（偏好） | 高频 | `PreferenceStore` | 独立 | 差分更新，不碰核心状态 |

```mermaid
graph TD
    subgraph IPC["Binder 线程池（高频读）"]
        I1["线程 1: GET_BINDER"] --> RS["读 DaemonState<br/>无锁"]:::ok
        I2["线程 2: 模块列表"] --> RS
        I3["线程 3: 偏好读"] --> RS
    end
    subgraph BG["后台（低频写）"]
        B1["配置变更"] --> CH["conflated channel"]:::step
        CH --> B2["协程: 重建 state"]:::step
        B2 --> SW["原子交换引用"]:::step
    end
    subgraph PREF["偏好通道（独立）"]
        P1["偏好变更"] --> P2["差分"]:::step
        P2 --> P3["推送模块"]:::step
    end
    SW -.可见.-> RS
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

差分推送的意义在于：一个模块可能有数百个偏好键，但单次用户操作通常只改一两个。全量重传会让 IPC payload 膨胀、序列化耗时；差分只传变化部分，单次推送开销恒定在小常数级。配合 conflated channel 的去抖特性，即使偏好被快速连续修改，也只会触发一次差分推送，不会打满 Binder 线程。

## 与进程生命周期的协作

进程死亡清理（见 [进程生命周期与心跳](./lifecycle)）也走写路径。`DeathRecipient` 触发后，不直接修改共享映射（那会破坏无锁读），而是触发 conflated channel 请求，后台协程构建不含该 PID 的新 `DaemonState` 并原子交换。正在服务其它进程的 IPC 线程完全不受影响。

## 小结

| 设计 | 解决的问题 |
| :--- | :--- |
| 不可变 `DaemonState` | 读路径无锁，线程安全 |
| conflated channel | 写路径串行化、去抖 |
| 原子交换引用 | 无锁切换快照，读写不竞争 |
| 偏好隔离 | 高频偏好变更不打爆核心状态重建 |
| 差分更新 | 偏好推送只传变化部分 |
| 死亡清理走写路径 | 不破坏正在服务的 IPC 线程 |

## 相关链接

- [Daemon 守护进程](./daemon) — 并发模型在 Daemon 整体职责中的位置
- [进程生命周期与心跳](./lifecycle) — 死亡清理如何走写路径
- [IPC 与 Binder 中继](./ipc) — 读路径服务的高频 IPC 来源
