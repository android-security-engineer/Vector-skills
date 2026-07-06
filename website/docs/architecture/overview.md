# 系统全景

Vector 由若干个边界清晰的子系统组成。这一页给出全局地图，后续每页深入一个子系统。

## Gradle 模块全景

Vector 的 Gradle 聚合工程在 [settings.gradle.kts](https://github.com/android-security-engineer/Vector-skills/blob/master/settings.gradle.kts) 中声明了以下模块（`native` 与 `magisk-loader` 不经 Gradle，分别由 CMake 与 shell 脚本产出）：

| 模块 | namespace | 产出 | 职责 |
| :--- | :--- | :--- | :--- |
| `:app` | `defaultManagerPackageName` | 管理器 APK | 寄生式管理器界面（不独立安装，经宿主进程加载） |
| `:daemon` | `org.matrix.vector.daemon` | `daemon` 二进制 | root 守护进程：IPC 资产服务器、模块数据库、状态管理 |
| `:dex2oat` | `org.matrix.vector.dex2oat` | dex2oat 包装器 | 劫持 AOT 编译器，禁止内联并抹除痕迹 |
| `:zygisk` | `org.matrix.vector` | Zygisk 模块 `.so` + Magisk 包 | 注入引擎：C++ Zygisk hook + Kotlin 框架引导 |
| `:xposed` | `org.matrix.vector.impl` | 框架 DEX 一部分 | libxposed 现代 API 实现：拦截器链、内存 ClassLoader |
| `:legacy` | `org.matrix.vector.legacy` | 框架 DEX 一部分 | 经典 `de.robv.android.xposed` API 兼容层 |
| `:services:daemon-service` | `org.lsposed.lspd.daemonservice` | AIDL 接口 | `ILSPApplicationService` / `ILSPSystemServerService` 等 Binder 契约 |
| `:services:manager-service` | `org.lsposed.lspd.managerservice` | AIDL 接口 | `ILSPManagerService` 管理面接口 |
| `:hiddenapi:stubs` | — | stub JAR | 编译期占位，提供 hidden API 符号 |
| `:hiddenapi:bridge` | — | bridge JAR | 运行期反射桥，访问非公开 API |
| `:external:axml` | — | 库 | 二进制 XML 解析（资源 Hook 依赖） |
| `:external:apache` | — | 库 | Apache 衍生工具（HTTP/编码） |
| `native`（CMake） | — | `libnative.a` | JNI 桥：ART 方法 Hook、ELF 解析、native 模块支持 |
| `magisk-loader`（脚本） | — | 打包脚本 | 把上述产物组装成可刷入的 Magisk 模块 zip |

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
    MGR["寄生式管理器<br/>（宿主 com.android.shell）"]:::mgr

    ZYG -->|fork| SS
    ZYG -->|fork| APP
    SS -->|Binder 中继 _VEC 事务| DAEMON
    APP -->|请求框架 DEX / 模块列表<br/>SharedMemory| DAEMON
    DAEMON -.FD 传递 SCM_RIGHTS.-> DEX2OAT
    APP -->|注入| FW
    FW --> LSPLANT
    FW -.配置/资源.-> DAEMON
    DEX2OAT -.劫持编译,禁止内联.-> LSPLANT
    SS -.resolveActivity 重定向.-> MGR
    MGR -.身份移植.-> APP

    classDef proc fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef daemon fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef mgr fill:#143a4a,stroke:#4fb3d8,color:#c8e8f6
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

## 进程拓扑与信任边界

Vector 的关键设计是：**只有 Daemon 持有 root**，应用进程里的框架代码运行在应用自己的沙箱权限下，root 与沙箱之间靠 Binder 跨越边界。下图展示各进程的信任级别与跨边界通道：

```mermaid
graph LR
    subgraph ROOT["root 域（SELinux 自定义类型）"]
        DAEMON["Daemon<br/>seteuid(0) 临时提权"]:::root
        DEX2OAT["dex2oat 包装器<br/>execute_no_trans"]:::root
    end
    subgraph SYS["system 域 (UID 1000)"]
        SS["system_server<br/>Binder Trap 中继"]:::sys
    end
    subgraph APP["应用沙箱 (per-UID)"]
        FWK["Vector 框架内存<br/>InMemoryDexClassLoader"]:::app
        MOD["第三方模块<br/>VectorModuleClassLoader"]:::app
    end

    DAEMON <-.Binder _VEC 事务.-> SS
    SS <-.Binder 中继.-> FWK
    DAEMON -.SharedMemory FD.-> FWK
    FWK --> MOD
    DAEMON -.SOCK/exec.-> DEX2OAT

    classDef root fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef sys fill:#143a4a,stroke:#4fb3d8,color:#c8e8f6
    classDef app fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

> [!TIP]
> Daemon 在向 `system_server` 投递主 Binder 时，会在 [VectorDaemon.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/VectorDaemon.kt) 的 `sendToBridge` 中先 `Os.seteuid(0)`，事务完成后再 `Os.seteuid(1000)` 回落。这种"瞬时提权"把 root 暴露面压到最小。

## 关键源码索引

| 子系统 | 入口文件 |
| :--- | :--- |
| Zygisk C++ 模块 | [module.cpp](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/cpp/module.cpp) |
| Zygisk IPC 桥 | [ipc_bridge.cpp](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/cpp/ipc_bridge.cpp) |
| Kotlin 引导入口 | [Main.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/kotlin/org/matrix/vector/core/Main.kt) |
| Daemon 主入口 | [VectorDaemon.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/VectorDaemon.kt) |
| Native 抽象引擎 | [context.cpp](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/core/context.cpp) |
| Hook 引擎注册表 | [hook_bridge.cpp](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/jni/hook_bridge.cpp) |
| 拦截器链 | [VectorChain.kt](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/hooks/VectorChain.kt) |
