# 🔗 VectorChain

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/hooks/VectorChain.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/hooks/VectorChain.kt)
> 🟩 xposed 模块 · 现代 hook 递归链状态机

## 类职责

`class VectorChain : Chain` 是现代 Xposed API（`io.github.libxposed.api`）的**拦截链引擎**。每个 `VectorChain` 实例代表链上的一个节点，持有当前 hook 索引，通过递归 `proceed` 把控制权向下游传递，直到链尾触发原始方法（及 legacy hook）。它还负责按 `ExceptionMode` 处理 hooker 抛出的异常，决定是跳过、恢复还是直接抛出。

`VectorHookRecord` 是配套的数据类，承载单个 hook 的 `hooker`/`priority`/`exceptionMode`，被 native 端存储与快照。

## VectorHookRecord

```kotlin
data class VectorHookRecord(
    val hooker: XposedInterface.Hooker,
    val priority: Int,
    val exceptionMode: ExceptionMode,
)
```

`HookBridge.hookMethod(true, ...)` 现在存储的是 `VectorHookRecord` 而非旧的 `HookerCallback`，native 端 `callbackSnapshot` 会以 `VectorHookRecord` 数组形式回吐现代 hook 列表。

## 构造参数

```kotlin
class VectorChain(
    private val executable: Executable,
    private val thisObj: Any?,
    private val args: Array<Any?>,
    private val hooks: Array<VectorHookRecord>,
    private val hookIndex: Int,                                    // 当前节点在 hooks 中的位置
    private val terminal: (thisObj: Any?, args: Array<Any?>) -> Any?,  // 链尾：原始方法+legacy
) : Chain
```

每个 `proceed` 会构造一个 `hookIndex+1` 的新 `VectorChain` 作为下游节点，形成递归。

## 内部状态

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `proceedCalled` | `Boolean` | 本节点是否已向下游转发执行 |
| `downstreamResult` | `Any?` | 下游返回的结果（用于崩溃后恢复） |
| `downstreamThrowable` | `Throwable?` | 下游抛出的异常（用于崩溃后恢复） |

这三个字段是异常恢复机制的基础：当 hooker 在 `proceed` 之后崩溃，`executeDownstream` 已缓存下游的真实结果/异常，父链可以恢复而非丢失。

## Chain 接口实现

```kotlin
override fun getExecutable(): Executable = executable
override fun getThisObject(): Any? = thisObj
override fun getArgs(): List<Any?> = args.toList()
override fun getArg(index: Int): Any? = args[index]

// 四种 proceed 重载，均可替换 thisObject 和/或 args
override fun proceed(): Any? = internalProceed(thisObj, args)
override fun proceed(currentArgs: Array<Any?>): Any? = internalProceed(thisObj, currentArgs)
override fun proceedWith(thisObject: Any): Any? = internalProceed(thisObject, args)
override fun proceedWith(thisObject: Any, currentArgs: Array<Any?>): Any? = internalProceed(thisObject, currentArgs)
```

模块可以在 before 逻辑里修改 `args` 后 `chain.proceed(modifiedArgs)`，或改 receiver 后 `proceedWith(newThis)`。

## internalProceed 状态机

```kotlin
private fun internalProceed(thisObject: Any?, currentArgs: Array<Any?>): Any? {
    proceedCalled = true
    // 链尾：触发原始方法（含 legacy hook）
    if (hookIndex >= hooks.size) {
        return executeDownstream { terminal(thisObject, currentArgs) }
    }
    // 非尾：构造下游节点，调当前 hooker.intercept(nextChain)
    val record = hooks[hookIndex]
    val nextChain = VectorChain(executable, thisObject, currentArgs, hooks, hookIndex + 1, terminal)
    return try {
        executeDownstream { record.hooker.intercept(nextChain) }
    } catch (t: Throwable) {
        handleInterceptorException(t, record, nextChain, thisObject, currentArgs)
    }
}
```

两个分支都经 `executeDownstream` 包装，确保下游结果/异常被缓存。`terminal` 是 `VectorNativeHooker` 注入的 lambda：若有 legacy hook 且 delegate 可用，走 `delegate.processLegacyHook`（内含 `LegacyApiSupport` before/after），否则直接 `invokeOriginalSafely`。

## ExceptionMode 处理

```kotlin
private fun handleInterceptorException(
    t: Throwable, record: VectorHookRecord, nextChain: VectorChain,
    recoveryThis: Any?, recoveryArgs: Array<Any?>,
): Any?
```

异常处理按"异常来源 × ExceptionMode"决策：

| 条件 | 动作 |
| :--- | :--- |
| 异常来自下游（`nextChain.proceedCalled && t === nextChain.downstreamThrowable`） | 原样抛出（不吞下游异常） |
| `ExceptionMode.PASSTHROUGH` | 原样抛出（不救援 hooker 崩溃） |
| 崩溃在 `proceed` 之前（`!nextChain.proceedCalled`） | 跳过该 hooker，`nextChain.internalProceed` 继续 |
| 崩溃在 `proceed` 之后 | 恢复下游状态：有 `downstreamThrowable` 抛出，否则返回 `downstreamResult` |

`DEFAULT` 模式（非 PASSTHROUGH）保证 hooker 自身 bug 不会让目标方法丢失结果——这是"PROTECTIVE"语义：框架尽量让调用方拿到下游真实结果。

## 递归调用流程

```mermaid
flowchart TD
    Start["方法被调用<br/>VectorNativeHooker.callback"] --> Root["构造 rootChain<br/>hookIndex=0"]
    Root --> IP["internalProceed"]
    IP --> Chk{"hookIndex ≥ size?"}
    Chk -->|"是（链尾）"| Term["terminal lambda<br/>processLegacyHook / invokeOriginal"]
    Chk -->|"否"| Mk["构造 nextChain<br/>hookIndex+1"]
    Mk --> Inter["record.hooker.intercept(nextChain)"]
    Inter -->|"调 nextChain.proceed"| IP2["下游 internalProceed"]
    IP2 -.-> Chk
    Inter -->|"返回结果"| ED["executeDownstream<br/>缓存 result"]
    Inter -->|"抛异常"| HE["handleInterceptorException"]
    HE -->|"下游异常/PASSTHROUGH"| Throw["抛出"]
    HE -->|"proceed前崩溃"| Skip["跳过 hooker<br/>nextChain.internalProceed"]
    HE -->|"proceed后崩溃"| Rec["恢复 downstream<br/>result/throwable"]
    ED --> Ret["返回上层"]
    Term --> ED
    Skip --> Ret
    Rec --> Ret

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class Root,IP,Mk,Inter,ED,IP2 class vec
    class Chk,HE class hot
    class Start,Term,Throw,Skip,Rec,Ret class plain
```

## 相关

- [VectorNativeHooker · JNI trampoline](./vector-native-hooker) — 构造 rootChain、注入 terminal
- [HookBridge · native JNI 门面](./hook-bridge) — `callbackSnapshot` 回吐 `VectorHookRecord[]`
- [LegacyDelegateImpl · 翻译边界](../legacy/legacy-delegate) — terminal 里的 `processLegacyHook`
- [XC_MethodHook · 回调基类](../legacy/xc-method-hook) — legacy 等价机制
