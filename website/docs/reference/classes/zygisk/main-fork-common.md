# 🌱 Main (forkCommon)

> 📂 `zygisk/src/main/kotlin/org/matrix/vector/core/Main.kt`
> 🟦 zygisk 模块 · Java 侧框架引导入口

## 类职责

`object Main` 是 Vector 框架的 **Java 侧入口**，由 native `VectorModule` 通过 JNI `FindAndCall` 调用其 `forkCommon` 静态方法。它在 native 完成 DEX 加载、ART/JNI hook 安装、入口类定位之后，接管 Java 层的初始化编排：system_server 的系统钩子、Xposed 桥初始化、日志配置、寄生管理器检测、标准 Xposed 模块引导。它是 native 与 Java 两套注入逻辑的唯一衔接点。

## forkCommon 签名

```kotlin
@JvmStatic
fun forkCommon(
    isSystem: Boolean,
    isLateInject: Boolean,
    niceName: String,
    appDir: String?,
    binder: IBinder,
)
```

native 端的调用约定为 `FindAndCall(env, "forkCommon", "(ZZLjava/lang/String;Ljava/lang/String;Landroid/os/IBinder;)V", ...)`，参数顺序与签名逐字对应：

| 参数 | 来源 | 含义 |
| :--- | :--- | :--- |
| `isSystem` | `JNI_TRUE`/`JNI_FALSE` | 是否 system_server 进程 |
| `isLateInject` | `runtime_flags & LATE_INJECT` | 是否晚注入（system_server 专属） |
| `niceName` | `args->nice_name` | 进程名（包名或 `"system"`） |
| `appDir` | `args->app_data_dir`（system 为 `null`） | 应用数据目录 |
| `binder` | ApplicationService/manager binder | 与 daemon 通信的 IPC 句柄 |

## 初始化编排

```kotlin
if (isSystem) {
    ParasiticManagerSystemHooker.start()
}

val appService = ILSPApplicationService.Stub.asInterface(binder)
Startup.initXposed(isSystem, niceName, appDir, appService)

runCatching { Utils.Log.muted = VectorServiceClient.isLogMuted }
    .onFailure { t -> Utils.logE("Failed to configure logs from service", t) }
```

1. **system_server 系统钩子**：`isSystem` 时先启动 `ParasiticManagerSystemHooker`，解析系统级钩子；
2. **Xposed 桥初始化**：把 binder 包装成 `ILSPApplicationService`，调 `Startup.initXposed(isSystem, niceName, appDir, appService)` 完成 legacy 桥、资源、模块加载器等基础组件装配；
3. **日志静默配置**：从 `VectorServiceClient.isLogMuted`（即 `ApplicationService.isLogMuted` = 非 verbose）设 `Utils.Log.muted`，失败仅记录不中断。

## 寄生管理器分流

```kotlin
if (niceName == BuildConfig.ManagerPackageName) {
    val type = if (Process.myUid() == BuildConfig.HostPackageUid) "parasitic" else "user-installed"
    if (ParasiticManagerHooker.start()) {
        Utils.logI("Manager ($type) loaded into host, skipping standard bootstrap.")
        return
    }
}
```

判断当前进程是否为管理器包名。是则按 `myUid() == HostPackageUid` 区分**寄生**（注入到宿主 shell）与**用户安装**两种形态。`ParasiticManagerHooker.start()` 成功（拿到管理器 APK FD 与 manager service binder 并装好钩子）后直接 `return`，跳过标准 Xposed 引导——管理器进程不需要加载第三方模块。

## 标准引导

```kotlin
Utils.logV("Loading Vector/Xposed for $niceName (UID: ${Process.myUid()})")
Startup.bootstrapXposed(isSystem && isLateInject)
```

非管理器进程走标准路径：`Startup.bootstrapXposed` 加载作用域内的 Xposed 模块。`isSystem && isLateInject` 传 `true`，表示晚注入的 system_server 需要特殊处理已运行进程的模块加载（`auto_include` 等机制在 `VectorService.dispatchPackageChanged` 配合）。

## native→Java 衔接

```mermaid
flowchart TD
    N["VectorModule.postSpecialize"] --> FAC["FindAndCall forkCommon"]
    FAC --> M["Main.forkCommon"]
    M --> S{"isSystem?"}
    S -->|是| PMSH["ParasiticManagerSystemHooker.start"]
    S -->|否| SI["Startup.initXposed"]
    PMSH --> SI
    SI --> Log["配置 Utils.Log.muted"]
    Log --> Mgr{"niceName == Manager?"}
    Mgr -->|是且 start 成功| PMH["ParasiticManagerHooker.start<br/>return"]
    Mgr -->|否| Boot["Startup.bootstrapXposed<br/>加载第三方模块"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class M,SI,Log,PMH,PMSH,Boot class vec
    class S,Mgr class hot
    class N,FAC class plain
```

## 相关

- [module-cpp · native 调用方](./module-cpp)
- [parasitic-manager-hooker · 身份移植](./parasitic-manager-hooker)
- [bridge-service · binder 来源](./bridge-service)
- [application-service · ILSPApplicationService](../daemon/application-service)
