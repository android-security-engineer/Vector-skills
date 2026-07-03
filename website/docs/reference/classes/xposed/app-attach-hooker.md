# 🔗 AppAttachHooker · CrashDumpHooker · DexTrustHooker

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/hookers/`
> 🟦 xposed 模块 · 早期 attach、崩溃日志、DEX 信任

## 包职责

三个小型 `XposedInterface.Hooker`，分别处理：应用进程早期 attach 触发 legacy 模块装载、未捕获异常的诊断日志、DEX 解析时把框架 ClassLoader 标记为受信任以放行反射。

## 类清单

| 对象 | 说明 |
| :--- | :--- |
| [`AppAttachHooker`](#appattachhooker) | 拦截 `ActivityThread.attach`，触发 legacy 模块装载 |
| [`CrashDumpHooker`](#crashdumphooker) | 拦截未捕获异常，记日志后放行 |
| [`DexTrustHooker`](#dextrusthooker) | 拦截 DEX 解析，标记框架 CL 为受信任 |

---

## AppAttachHooker

`object AppAttachHooker : XposedInterface.Hooker` —— 拦截 `ActivityThread` 的 `attach` 阶段。先 `chain.proceed()` 执行真实 attach，再取 `chain.thisObject` 作为 `activityThread`，经 `VectorBootstrap.withLegacy` 调 `delegate.loadModules(activityThread)`，把现代模块装载进当前进程。

## 时序与边界

| 方面 | 说明 |
| :--- | :--- |
| 触发时机 | `ActivityThread.attach` 返回之后，此时 `Application` 尚未 `onCreate`，是装载模块的最早稳定点 |
| `chain.proceed` 先行 | 必须先让真实 `attach` 跑完，否则 `ActivityThread` 内部字段（如 `mInstrumentation`、`mApplication`）未就绪，模块装载会 NPE |
| `thisObject` 判空 | `chain.thisObject` 理论非空，但防御性判空避免极端情况抛 NPE 中断 attach |
| `withLegacy` 闭包 | 仅当 legacy delegate 存在时才调 `loadModules`，否则 no-op |

## 三者关系

| Hooker | 拦截点 | 产物 |
| :--- | :--- | :--- |
| `AppAttachHooker` | `ActivityThread.attach` | 触发 `delegate.loadModules` → 模块 ClassLoader 装载 |
| `CrashDumpHooker` | 未捕获异常处理器 | `Utils.logE` 诊断日志 |
| `DexTrustHooker` | DEX 文件解析 | `HookBridge.setTrusted` 标记 cookie |

`AppAttachHooker` 与 `LoadedApkHookers` 的分工：前者负责"进程级"模块装载触发（一次 attach 一次），后者负责"包级"生命周期事件派发（每个 LoadedApk 多次）。模块的入口类装载由 `VectorModuleManager.loadModule` 完成，本 hooker 仅是触发器。

---

## CrashDumpHooker

`object CrashDumpHooker : XposedInterface.Hooker` —— 拦截框架的未捕获异常处理器。取 `args.firstOrNull() as? Throwable`，非空时 `Utils.logE("Crash unexpectedly", throwable)` 记录诊断信息，再 `chain.proceed()` 让默认终止逻辑执行。`try` 包裹防止日志本身抛异常影响崩溃流程。

```kotlin
override fun intercept(chain: XposedInterface.Chain): Any?
```

---

## DexTrustHooker

`object DexTrustHooker : XposedInterface.Hooker` —— 拦截 DEX 文件解析。先 `chain.proceed()` 拿到 DEX cookie 结果，再从 `args` 找第一个 `ClassLoader`（Android P 上若为 null 则退化为 `DexTrustHooker::class.java.classLoader`）。沿 parent 链向上找，若命中框架自身的 ClassLoader，则 `HookBridge.setTrusted(result)` 告知 native 层此 DEX cookie 受信任，避免 ART 阻断 hook 引擎的反射访问。

```kotlin
override fun intercept(chain: XposedInterface.Chain): Any?
```

## 信任判定流程

```mermaid
flowchart TD
    A["DEX 解析"] --> B["DexTrustHooker.intercept"]
    B --> C["chain.proceed → cookie"]
    C --> D["取 args 中 ClassLoader"]
    D --> E{"Android P 且为 null?"}
    E -->|是| F["用框架自身 CL"]
    E -->|否| G["沿 parent 链"]
    F --> G
    G --> H{"命中框架 CL?"}
    H -->|是| I["HookBridge.setTrusted(cookie)"]
    H -->|否| J["不标记"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,G,I class vec
    class E,H class hot
    class A,F,J class plain
```

## 相关

- [LoadedApkHookers · ClassLoader 生命周期](./loaded-apk-hookers)
- [SystemServerHookers · 系统服务 hook](./system-server-hookers)
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
