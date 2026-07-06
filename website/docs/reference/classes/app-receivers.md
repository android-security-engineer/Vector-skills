# app · receivers 包

> 📂 [`app/src/main/java/org/lsposed/manager/receivers/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/)
> 🟦 管理器与 Daemon 服务 Binder 的持有者

## 核心类

| 类 | 职责 | 关键方法 |
| :--- | :--- | :--- |
| [`LSPManagerServiceHolder`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java) | 持有 `ILSPManagerService` Binder，监听其死亡并自杀 | `init(IBinder)`、`getService()`、`binderDied()` |

## 类继承结构

```mermaid
classDiagram
    class IBinder_DeathRecipient {
        <<interface>>
        +binderDied()
    }
    class LSPManagerServiceHolder {
        -static LSPManagerServiceHolder holder
        -static ILSPManagerService service
        +static init(IBinder binder)$
        +static getService()$ ILSPManagerService
        -linkToDeath(IBinder)
        +binderDied()
    }
    IBinder_DeathRecipient <|.. LSPManagerServiceHolder : implements
    note for LSPManagerServiceHolder "静态字段全进程共享\ninit() 幂等：holder==null 才创建"
```

## 包职责

持有管理器与 Daemon 之间的核心 IPC Binder——`ILSPManagerService`。管理器进程启动时把收到的 Binder 注册进来，此后全 app 通过 `getService()` 静态方法取用。Binder 一旦死亡，直接杀死管理器进程（寄生场景下没有 Binder 等于失去对框架的控制）。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`LSPManagerServiceHolder`](#lspmanagerserviceholder) | 持有 `ILSPManagerService` Binder，监听其死亡并自杀 |

### Binder 生命周期时序

```mermaid
sequenceDiagram
    participant DAEMON as Daemon 进程<br/>ILSPManagerService
    participant ZY as Zygisk 注入器
    participant HOLDER as LSPManagerServiceHolder
    participant UI as 管理器 UI/util

    ZY->>HOLDER: init(binder)
    HOLDER->>HOLDER: linkToDeath(binder, 0)
    HOLDER->>HOLDER: Stub.asInterface(binder)<br/>存入 static service
    HOLDER-->>UI: getService() 可用
    Note over UI,DAEMON: 全 app 经 getService() 走 IPC

    alt Daemon 崩溃
        DAEMON-->>HOLDER: binderDied()
        HOLDER->>HOLDER: System.exit(0)
        HOLDER->>HOLDER: Process.killProcess(getpid())
    else linkToDeath 即时失败
        HOLDER->>HOLDER: RemoteException → binderDied()
    end
```

---

## LSPManagerServiceHolder

`public class LSPManagerServiceHolder implements IBinder.DeathRecipient`

**Binder 持有者单例**。管理器以寄生方式注入宿主进程后，Daemon 通过某种渠道把 `ILSPManagerService` 的 IBinder 传进来，本类负责接住、转成 AIDL 接口、注册死亡监听。

### 关键设计

- **静态字段持有**：[`service`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java#L31) 与 [`holder`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java#L30) 都是 `static`，整个进程共享一份。[`init()`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java#L33) 仅在 `holder == null` 时创建实例，保证幂等。
- **`IBinder.DeathRecipient`**：实现 [`binderDied()`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java#L56-L60)，Daemon 一旦崩溃即触发。
- **激进自杀**：`binderDied()` 里先 `System.exit(0)` 再 `Process.killProcess(Os.getpid())`——双保险。寄生管理器失去与 Daemon 的连接后没有任何独立存活的意义。
- **linkToDeath 容错**：[`linkToDeath`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/receivers/LSPManagerServiceHolder.java#L48-L54) 捕获 `RemoteException`，若 Binder 已死则直接调 `binderDied()`，避免漏掉死亡事件。

### 主要方法

```java
// 进程启动时调用，注册 Daemon 传入的 Binder（幂等）
public static void init(IBinder binder)

// 取得 ILSPManagerService 代理对象（全 app 都用它）
public static ILSPManagerService getService()

// Binder 死亡回调：杀掉自身进程
@Override
public void binderDied()
```

### 内部流程

构造时先 `linkToDeath(binder)`，若 `linkToDeath` 抛 `RemoteException`（说明 Binder 已死）则直接走 `binderDied()`；否则把 Binder 转成 `ILSPManagerService` 存入静态 `service`。

### 谁在用

- [`LogsFragment`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/fragment/LogsFragment.java)：`LSPManagerServiceHolder.getService().getLogs(zipFd)` 拉取日志 FD 写入 zip。
- [`CompileDialogFragment`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/fragment/CompileDialogFragment.java)：`getService().clearApplicationProfileData(...)` / `performDexOptMode(...)` 触发 dex 优化。
- [`ConfigManager`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ConfigManager.java) 封装了大量经此 Binder 的调用，是全 app 走 IPC 的统一门面。

## 相关

- [app 模块总览](../modules/app)
- [app · util 包](./app-util)（`ModuleUtil` 等使用此 Holder 的工具）
- AIDL 接口见 [services AIDL · ILSPManagerService](../aidl/ilspmanagerservice)
- 寄生注入机制见 [Zygisk 模块 · 寄生式管理器](../../architecture/zygisk#寄生式管理器与身份移植)
