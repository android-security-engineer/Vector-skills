# 🐚 寄生管理器深入

Vector 管理器不以独立应用存在，而是"掏空"一个宿主进程寄生运行。这是它最反直觉、也最能体现隐蔽设计哲学的一环。这一页深入讲清楚宿主选择、身份移植全流程，以及为什么是 `com.android.shell`。

## 为什么不用独立应用

```mermaid
graph TD
    subgraph 独立["独立应用管理器 ✗"]
        I1["固定包名"] --> I2["桌面图标可枚举"]:::bad
        I2 --> I3["进程可被扫描"]:::bad
        I3 --> I4["反作弊零成本发现"]:::bad
    end
    subgraph 寄生["Vector 寄生模型 ✓"]
        P1["掏空 shell 进程"] --> P2["系统以为是 shell"]:::good
        P2 --> P3["无独立包名/图标"]:::good
        P3 --> P4["从根上消除管理器检测面"]:::good
    end
    classDef bad fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef good fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

独立应用有固定包名、桌面图标可枚举、进程可被反作弊扫描。寄生模型让管理器**根本不以独立应用存在**——系统以为运行的是宿主，实际跑的是管理器界面。代价是用户不能用常规方式打开它，需经系统通知进入。

## 宿主选择：为什么是 com.android.shell

| 候选 | 选用原因 / 不选原因 |
| :--- | :--- |
| `com.android.shell` | ✅ 选用。系统内置、无法被卸载、UID 固定、有 shell 权限但又不至于过于敏感，是天然的伪装宿主 |
| 普通第三方应用 | ❌ 可能被卸载、包名不稳定、权限不足 |
| system_server | ❌ 系统核心进程，寄生会危及稳定性 |

`com.android.shell` 是 Android 系统自带的 shell 进程，几乎所有设备都有，且正常运行时不会引起怀疑。Vector 把它的进程内容替换为管理器代码，系统层面看到的是 shell 在运行。

## 身份移植全流程

寄生不是简单的"在 shell 里跑代码"，而是一整套身份伪造。分 system_server 侧与应用宿主侧两步。

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant SS as system_server
    participant NAT as native Zygisk
    participant SHELL as com.android.shell 进程
    participant HK as ParasiticManagerHooker

    U->>SS: 发带 LAUNCH_MANAGER category 的 Intent
    SS->>SS: resolveActivity 被拦截，重定向到宿主包
    Note over SS: processName 设为管理器包名
    SS->>SHELL: 启动宿主进程
    NAT->>SHELL: preAppSpecialize 检测宿主 UID + 管理器进程名
    NAT->>SHELL: 注入 GID_INET 保证网络
    NAT->>HK: 交给身份移植
    HK->>SHELL: 替换 ApplicationInfo，注入管理器 DEX
    HK->>SHELL: 伪造 ContextImpl 绕过包名校验
    HK->>SHELL: 拦截生命周期手动保存/恢复状态
    Note over SHELL: 运行的是管理器界面，系统却以为是 shell
```

### 1. system_server 意图重定向

`ParasiticManagerSystemHooker` 拦截 `ActivityTaskSupervisor.resolveActivity`。检测到带 `LAUNCH_MANAGER` category 的 Intent 时，动态修改返回的 ActivityInfo：

- 强制系统启动宿主包（`com.android.shell`）。
- 把 `processName` 设为管理器包名。
- 调整主题和 recents 标志以模仿独立应用。

这样系统以为在启动 shell，实际加载的是管理器。

### 2. 应用宿主劫持

native 模块在 `preAppSpecialize` 检测到宿主包 UID 和管理器进程名时，先向进程 GID 数组注入 `GID_INET` (3003) 保证网络访问，然后交给 `ParasiticManagerHooker.kt` 执行身份移植：

| 步骤 | 作用 |
| :--- | :--- |
| 代码注入 | 拦截 `LoadedApk.getClassLoader` 与 `ActivityThread.handleBindApplication`，用管理器 APK（经 FD 提供）替换宿主 ApplicationInfo，把管理器 DEX 注入宿主 `PathClassLoader` |
| 状态伪造 | 系统 ActivityManager 不知伪造的管理器 Activity，旋转等生命周期切换会丢数据——hooker 拦截 `performStopActivityInner` 手动把 Bundle/PersistableBundle 存进静态并发映射，`scheduleLaunchActivity` 时重注入 |
| 上下文伪造 | 拦截 `ActivityThread.installProvider` 与 `WebViewFactory.getProvider`，构造伪造 `ContextImpl` 绕过 Android 与 Chromium 内部的包名校验 |

```mermaid
graph TD
    H["宿主进程 com.android.shell"]:::host
    H --> P["preAppSpecialize: 注入 GID_INET"]:::step
    H --> R["替换 ApplicationInfo → 注入管理器 DEX"]:::step
    H --> C["伪造 ContextImpl → 绕过包名校验"]:::step
    H --> L["拦截生命周期 → 手动保存/恢复状态"]:::step
    P --> OUT["运行管理器界面<br/>系统以为是 shell"]:::out
    R --> OUT
    C --> OUT
    L --> OUT
    classDef host fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 进入方式：系统通知

既然桌面没图标，用户怎么打开管理器？开机后 Vector 通过 Daemon 的通知 UI 推一个系统通知，点击即触发带 `LAUNCH_MANAGER` category 的 Intent，进入上述重定向流程。

```mermaid
graph LR
    U["用户"] -->|看通知栏| N["Vector 系统通知"]:::core
    N -->|点击| LAUNCH["发 LAUNCH_MANAGER Intent"]:::core
    LAUNCH --> M["寄生管理器界面"]:::host
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef host fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
```

通知被清理？检查系统设置 → 应用 → shell → 通知权限；仍不行则重启设备重新触发。详见 [常见问题 FAQ](../guide/faq#管理器闪退--打不开)。

## 稳定性兜底

寄生模型最大的风险是系统不知伪造 Activity 存在，生命周期切换会丢状态。Vector 的兜底：

| 风险 | 兜底机制 |
| :--- | :--- |
| 屏幕旋转丢数据 | 拦截 `performStopActivityInner` 手动保存 Bundle，`scheduleLaunchActivity` 重注入 |
| WebView 包名校验失败 | 伪造 `ContextImpl` 绕过 Chromium 校验 |
| ContentProvider 安装失败 | 拦截 `installProvider` 注入伪造上下文 |
| 网络访问被拒 | `preAppSpecialize` 注入 `GID_INET` |
| 宿主被冻结/清理 | 加入电池优化白名单或重新发通知 |

## 小结

| 设计点 | 解决的问题 |
| :--- | :--- |
| 寄生而非独立安装 | 消除管理器自身的包名/图标/进程检测面 |
| 选 `com.android.shell` | 系统内置、不可卸载、不引人怀疑 |
| system_server 重定向 | 让系统以为启动的是 shell |
| 身份移植三步 | 代码注入 + 状态伪造 + 上下文伪造 |
| 系统通知进入 | 桌面无图标场景下的可靠入口 |
| 生命周期手动保存恢复 | 应对系统不知伪造 Activity 的风险 |

## 相关链接

- [Zygisk 模块](./zygisk#寄生式管理器与身份移植) — 寄生管理器的实现位置
- [安全与隐蔽性设计](./security#防线六寄生式管理器) — 寄生作为隐蔽防线
- [常见问题 FAQ](../guide/faq) — 管理器找不到/闪退
- [快速上手](../guide/quickstart) — 经通知进入管理器
