# 🚀 service.sh — late_start service

`service.sh` 是 Magisk 的 `late_start service` 脚本，在系统启动后期以 root 执行，负责拉起 Vector daemon。

> 📂 `zygisk/module/service.sh`
> 📦 magisk-loader 模块 · 启动阶段执行

## 职责

脚本本身极简，核心是用 `unshare` 在私有挂载命名空间内启动 daemon 二进制。daemon 的实际启动逻辑、心跳、重启策略都在 `daemon` 脚本与 `VectorDaemon` 中。

## 启动命令

```bash
MODDIR="${0%/*}"
cd "$MODDIR" || exit 1

unshare --propagation slave -m "$MODDIR/daemon" \
    --system-server-max-retry=3 "$@" &
```

| 要素 | 说明 |
| :--- | :--- |
| `MODDIR="${0%/*}"` | 取脚本所在目录作为模块根 |
| `unshare --propagation slave -m` | 创建私有挂载命名空间，传播设为 slave |
| `"$MODDIR/daemon"` | 实际启动 daemon 包装脚本 |
| `--system-server-max-retry=3` | 传递给 daemon 的 system_server 重启重试上限 |
| `&` | 后台运行，不阻塞 Magisk service 队列 |

## 启动链路

```mermaid
graph LR
    BOOT["Magisk late_start"]:::boot
    BOOT --> SVC["service.sh"]:::vec
    SVC --> UNS["unshare -m<br/>私有挂载命名空间"]:::vec
    UNS --> DAEMON["daemon 脚本<br/>app_process 拉起"]:::vec
    DAEMON --> VD["VectorDaemon.main"]:::core
    VD --> BR["sendToBridge<br/>注入 system_server"]:::core
    classDef boot fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef core fill:#143a4a,stroke:#4fb3d8,color:#bfe6f5
```

## 心跳与进程死亡

daemon 本身是常驻进程，通过 `app_process` 启动后进入 `Looper.loop()`。进程级别的"心跳"由 `ApplicationService` 管理：每个被注入的应用进程注册一个 `heartBeat` Binder，`linkToDeath` 后 daemon 在进程死亡时自动清理注册表。

```mermaid
graph TD
    APP["应用进程"]:::app
    APP -->|"heartBeat binder"| AS["ApplicationService<br/>ProcessInfo"]:::vec
    AS -->|"linkToDeath"| DEATH["binderDied()<br/>移除注册"]:::warn
    classDef app fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef warn fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
```

## system_server 重启策略

`service.sh` 传入 `--system-server-max-retry=3`，由 `VectorDaemon` 解析。当 daemon 通过桥事务向 system_server 注入失败（重试 3 次无响应）时，会触发 `restartSystemServer()`，通过 `ctl.restart` 重启 zygote：

```mermaid
graph TD
    INJ["sendToBridge 注入"]:::core
    INJ -->|"3 次失败"| RT{"restartRetry > 0?"}:::cond
    RT -->|是| RST["restartSystemServer<br/>ctl.restart zygote"]:::warn
    RT -->|否| FAIL["放弃注入"]:::bad
    INJ -->|"system_server 崩溃"| DD["DeathRecipient<br/>清缓存 + 重新占位"]:::vec
    DD --> INJ
    classDef core fill:#143a4a,stroke:#4fb3d8,color:#bfe6f5
    classDef cond fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef warn fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef bad fill:#3a1010,stroke:#e85a5a,color:#ffb0b0
    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

system_server 崩溃时 `DeathRecipient` 会清除 `ServiceManager`/`ActivityManager` 缓存、重新注册代理服务名，并递减重试计数后再次注入。

## 相关

- daemon 包装脚本见 [customize.sh · daemon 脚本](./customize-sh)
- 注入与重启细节见 [daemon-service-impl](../services/daemon-service-impl)
- 早期阶段说明见 [post-fs-data-sh](./post-fs-data-sh)
