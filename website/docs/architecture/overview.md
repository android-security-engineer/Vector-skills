# 系统全景

Vector 由若干个边界清晰的子系统组成。这一页给出全局地图，后续每页深入一个子系统。

## 组件地图

```mermaid
graph TD
    ZYG["Zygote"]:::proc
    SS["system_server<br/>（代理路由器）"]:::proc
    APP["用户应用（被 Hook）"]:::proc
    DAEMON["Daemon 守护进程<br/>（root,沙箱外）"]:::daemon
    FW["Vector 框架（内存）<br/>xposed / legacy / native"]:::core
    LSPLANT["LSPlant ART Hook 引擎"]:::core
    DEX2OAT["dex2oat 包装器"]:::core

    ZYG -->|fork| SS
    ZYG -->|fork| APP
    SS -->|Binder 中继 _VEC 事务| DAEMON
    APP -->|请求框架 DEX / 模块列表<br/>SharedMemory| DAEMON
    DAEMON -.FD 传递 SCM_RIGHTS.-> DEX2OAT
    APP -->|注入| FW
    FW --> LSPLANT
    FW -.配置/资源.-> DAEMON
    DEX2OAT -.劫持编译,禁止内联.-> LSPLANT

    classDef proc fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef daemon fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

## 各子系统职责

| 子系统 | 语言 | 职责 | 深入阅读 |
| :--- | :--- | :--- | :--- |
| **Zygisk 模块** | C++ / Kotlin | 注入引擎：从 Zygote 接管进程创建，建立 IPC，从内存引导框架 | [→](./zygisk) |
| **Daemon 守护进程** | Kotlin / C++ | 沙箱外的协调者：状态管理、IPC 资产服务器、SELinux 安全区 | [→](./daemon) |
| **Native 原生库** | C++ | JNI 桥：ART 方法 Hook、资源改写、ELF 符号解析、native 模块支持 | [→](./native) |
| **dex2oat 劫持** | C++ | 劫持 AOT 编译器，禁止内联，并抹除劫持痕迹 | [→](./dex2oat) |
| **xposed 模块** | Kotlin | 现代 libxposed API 实现：拦截器链、内存 ClassLoader | [→](./xposed) |
| **legacy 模块** | Kotlin | 经典 Xposed API 兼容层：回调分发、资源 Hook、XSharedPreferences | [→](./legacy) |
| **资源 Hook** | Kotlin / C++ | 运行时替换应用资源：动态类层级、二进制 XML 突变 | [→](./resources) |

## 数据流：一次 Hook 是怎么发生的

以"用户应用启动时被 Hook"为例，串起所有子系统：

```mermaid
sequenceDiagram
    autonumber
    participant ZYG as Zygote / Zygisk
    participant SS as system_server
    participant DAEMON as Daemon
    participant APP as 用户应用
    participant NAT as native 层
    participant LSP as LSPlant

    APP->>ZYG: 进程 fork
    ZYG->>APP: postAppSpecialize 拦截
    APP->>SS: 经 activity 服务发 _VEC(GET_BINDER)
    SS->>DAEMON: 转发 UID/PID/进程名/心跳
    DAEMON-->>SS: 核对作用域，返回 ApplicationService Binder
    SS-->>APP: 转交 Binder
    APP->>DAEMON: 拉取框架 DEX（SharedMemory）+ 混淆映射
    APP->>NAT: InMemoryDexClassLoader 引导 Kotlin 框架
    APP->>DAEMON: 请求本进程模块列表，从内存加载模块
    APP->>LSP: 模块调 Hook API → native → LSPlant 改写 entry_point
    Note over APP,LSP: 此后每次调用被 Hook 方法，先进入模块拦截逻辑
```

每一步都对应后续章节的一个子系统。建议按 [启动与注入链路](./boot-flow) → [IPC 与 Binder 中继](./ipc) 的顺序阅读，先把骨架建立起来，再逐个深入子系统。
