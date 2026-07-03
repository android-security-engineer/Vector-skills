# 🧭 核心概念串讲

Vector 把四个看似不相关的 Android 子系统拧成一根注入链。这一页用一张全景图把它们串起来，让你理解每个零件为什么必不可少。深入细节见对应的架构章节。

## 全景图

```mermaid
graph TD
    ZYG["Zygisk<br/>注入引擎：劫持进程创建"]:::core
    BND["Binder<br/>无服务通信通道"]:::core
    ART["ART 运行时<br/>方法入口点改写"]:::core
    SE["SELinux<br/>沙箱边界绕过"]:::core

    ZYG -->|fork 出进程后| BND
    BND -->|拉取框架 DEX 与模块列表| ART
    SE -->|预配安全区供偏好读写| ART
    ART -->|LSPlant 改写 entry_point| HOOK["Hook 生效"]:::ok

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 四个角色各司其职

| 子系统 | 解决的问题 | Vector 的用法 |
| :--- | :--- | :--- |
| **Zygisk** | 怎么进入每个新进程 | hook Zygote 的 `postAppSpecialize`/`postServerSpecialize` |
| **Binder** | 进程间怎么传 Binder 引用而不注册服务 | JNI Trap 拦截 `execTransact`，搭便车 `_VEC` 事务码 |
| **ART** | 怎么改一个方法的执行流 | LSPlant 改写 `ArtMethod` 入口点 + dex2oat 禁内联 |
| **SELinux** | 跨沙箱怎么读写配置 | Daemon 预配 `xposed_data` 宽松上下文安全区 |

## 协同时序：一次 Hook 的诞生

```mermaid
sequenceDiagram
    autonumber
    participant ZYG as Zygisk
    participant SS as system_server
    participant DAEMON as Daemon（root,沙箱外）
    participant APP as 目标应用
    participant ART as ART + LSPlant

    Note over ZYG,SS: ① Zygisk 阶段：开机时注入 system_server
    ZYG->>SS: postServerSpecialize 拦截
    SS->>DAEMON: 经 serial 服务拉框架 DEX + 混淆映射
    DAEMON->>SS: SEND_BINDER 留下主 Binder
    Note over SS: system_server 持有 Daemon Binder，成为中介

    Note over ZYG,APP: ② Zygisk 阶段：每个应用启动时
    ZYG->>APP: postAppSpecialize 拦截
    APP->>SS: _VEC(GET_BINDER) + 进程名 + 心跳
    SS->>DAEMON: 转发 UID/PID/心跳
    DAEMON->>DAEMON: 核对作用域
    DAEMON-->>APP: ApplicationService Binder

    Note over APP,ART: ③ ART 阶段：在应用内引导框架并 Hook
    APP->>DAEMON: 拉取框架 DEX（SharedMemory）+ 模块列表
    APP->>ART: InMemoryDexClassLoader 引导 Kotlin 框架
    APP->>ART: 模块调 Hook API
    ART->>ART: LSPlant 改写 entry_point，dex2oat 已禁内联
    Note over APP,ART: 此后每次调用被 Hook 方法先进入模块逻辑
```

## 为什么缺一不可

```mermaid
graph TD
    NOZ["没有 Zygisk"]:::bad --> R1["无法进入新进程，注入无从谈起"]:::bad
    NOB["没有 Binder 中继"]:::bad --> R2["Daemon 与应用无法通信<br/>或注册服务被反作弊枚举"]:::bad
    NOA["没有 ART 改写"]:::bad --> R3["方法调用无法被劫持"]:::bad
    NOS["没有 SELinux 处理"]:::bad --> R4["应用读不到模块偏好<br/>或需暴露 IPC 服务"]:::bad
    classDef bad fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
```

- **Zygisk 是入口**：没有它，Vector 根本进不了新进程。这也是为什么必须启用 Zygisk 环境。
- **Binder 是血管**：Daemon 在沙箱外，应用在沙箱内，要安全传递 Binder 引用又不能注册可枚举的服务，全靠 JNI Trap 搭便车。
- **ART 是肌肉**：进到进程只是开始，真正改方法行为靠 LSPlant 改写入口点。但内联和已编译方法会绕过入口点，所以还要 dex2oat 禁内联 + VectorDeopter 逐回解释器。
- **SELinux 是边界**：应用受 `untrusted_app` 域约束，跨进程读数据被拒。Daemon 预配宽松上下文安全区，让偏好读写透明且无 IPC 开销。

## 关键设计取舍

| 取舍 | Vector 的选择 | 代价 |
| :--- | :--- | :--- |
| 注入方式 | Zygisk（非 Riru） | 需 root 管理器支持 Zygisk |
| 通信方式 | 不注册服务，Trap 搭便车 | 实现复杂，调试困难 |
| 代码加载 | 全程内存，不落盘 | 首次加载稍慢，无磁盘缓存 |
| Hook 稳定性 | dex2oat 禁内联 + 反优化 | 首次 AOT 编译稍慢 |
| 管理器 | 寄生宿主进程 | 用户经通知进入，非桌面图标 |

## 下一步深入

每个子系统都有专章拆解：

- [启动与注入链路](../architecture/boot-flow) — Zygisk 两阶段注入
- [IPC 与 Binder 中继](../architecture/ipc) — Binder Trap 细节
- [ART Hook 原理](./art-hook) — LSPlant 与内联/反优化
- [SELinux 边界处理](../architecture/selinux) — 安全区机制
- [安全与隐蔽性](../architecture/security) — 各防线汇总

## 相关链接

- [系统全景](../architecture/overview) — 组件地图
- [术语表](./glossary) — 术语解释
- [安全与责任](./safety) — 合法使用边界
