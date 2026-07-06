# 🎯 VectorNativeHooker / VectorHookBuilder

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/hooks/VectorNativeHooker.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/hooks/VectorNativeHooker.kt)
> 🟩 xposed 模块 · JNI trampoline 与 hook 注册构造器

## 类职责

本文件定义两个协作类：

- **`VectorHookBuilder`**：实现 `XposedInterface.HookBuilder`，链式配置 `priority`/`exceptionMode`，调 `intercept(hooker)` 完成注册，返回 `HookHandle`。
- **`VectorNativeHooker<T>`**：native 端通过 JNI 实例化的**回调入口**。当被 hook 的方法被调用时，C++ 端会构造它的实例并调 `callback(args)`，由它拉取 hook 快照、构造 `VectorChain`、驱动现代+legacy 两套链。

## VectorHookBuilder

```kotlin
class VectorHookBuilder(private val origin: Executable) : HookBuilder {
    private var priority = XposedInterface.PRIORITY_DEFAULT
    private var exceptionMode = ExceptionMode.DEFAULT

    override fun setPriority(priority: Int): HookBuilder
    override fun setExceptionMode(mode: ExceptionMode): HookBuilder
    override fun intercept(hooker: Hooker): HookHandle
}
```

`intercept` 的校验链与 `XposedBridge.hookMethod` 一致：拒绝 abstract 方法、拒绝 hook 框架内部方法（`declaringClass.classLoader == VectorHookBuilder::class.java.classLoader`）、拒绝 `Method.invoke`。

校验通过后构造 `VectorHookRecord(hooker, priority, exceptionMode)`，调 `HookBridge.hookMethod(true, origin, VectorNativeHooker::class.java, priority, record)` 注册（`useModernApi=true`）。失败抛 `HookFailedError`。

返回的 `HookHandle`：

```kotlin
override fun getExecutable(): Executable = origin
override fun unhook() { HookBridge.unhookMethod(true, origin, record) }
```

## VectorNativeHooker

```kotlin
class VectorNativeHooker<T : Executable>(private val method: T) {
    private val isStatic = Modifier.isStatic(method.modifiers)
    private val returnType = if (method is Method) method.returnType else null

    fun callback(args: Array<Any?>): Any?   // 由 C++ 经 JNI 调用
}
```

native 端在 `hookMethod` 首次 hook 某方法时，用 `VectorNativeHooker(Executable)` 构造函数 + `callback([Ljava/lang/Object;)Ljava/lang/Object;` 方法创建 trampoline 对象，交给 LSPlant 替换目标 ART 方法。方法被调用时，C++ 把所有参数（含 receiver）打包成 `Object[]` 传给 `callback`。

### callback 流程

```kotlin
fun callback(args: Array<Any?>): Any? {
    val thisObject = if (isStatic) null else args[0]
    val actualArgs = if (isStatic) args else args.sliceArray(1 until args.size)
    val snapshots = HookBridge.callbackSnapshot(VectorHookRecord::class.java, method)
    val modernHooks = snapshots[0] as Array<VectorHookRecord>
    val legacyHooks = snapshots[1]
    // 快速路径：无任何 hook → 直接调原方法
    if (modernHooks.isEmpty() && legacyHooks.isEmpty()) {
        return invokeOriginalSafely(thisObject, actualArgs)
    }
    val terminal = { tObj, tArgs ->
        val delegate = VectorBootstrap.delegate
        if (legacyHooks.isNotEmpty() && delegate != null) {
            delegate.processLegacyHook(method, tObj, tArgs, legacyHooks) { invokeOriginalSafely(tObj, tArgs) }
        } else {
            invokeOriginalSafely(tObj, tArgs)
        }
    }
    val rootChain = VectorChain(method, thisObject, actualArgs, modernHooks, 0, terminal)
    val result = rootChain.proceed()
    // 返回前类型校验
    validateReturnType(result)
    return result
}
```

关键点：

| 步骤 | 说明 |
| :--- | :--- |
| 参数拆分 | 静态方法 args 全是参数；实例方法 args[0] 是 receiver |
| 快照拉取 | `callbackSnapshot` 返回 `Object[2][]`：[0]=modern `VectorHookRecord[]`，[1]=legacy 回调 |
| 快速路径 | 两套都空 → 跳过链构造，直接 `invokeOriginalSafely` |
| terminal 注入 | 有 legacy hook 且 delegate 可用 → 走 `processLegacyHook`；否则直调原方法 |
| 类型校验 | 返回前校验 result 与 returnType 兼容 |

### 返回类型校验

```kotlin
private fun isBoxingCompatible(obj: Any, targetType: Class<*>): Boolean  // 基本类型装箱兼容
```

| 返回情况 | 处理 |
| :--- | :--- |
| `returnType` 为 null（构造器）或 `Void.TYPE` | 不校验 |
| `result == null` 且 `returnType.isPrimitive` | 抛 `NullPointerException`（基本类型不能返回 null） |
| `result == null` 且非基本类型 | 允许 |
| `!instanceOf(result, returnType) && !isBoxingCompatible(...)` | `logD` 类型不匹配警告 |

`instanceOf` 走 `HookBridge.instanceOf`（跨 ClassLoader 的可靠检查），`isBoxingCompatible` 处理 `Integer` vs `int` 等装箱/拆箱场景。

### invokeOriginalSafely

```kotlin
private fun invokeOriginalSafely(tObj: Any?, tArgs: Array<Any?>): Any? {
    return try {
        HookBridge.invokeOriginalMethod(method, tObj, *tArgs)
    } catch (ite: InvocationTargetException) {
        throw ite.cause ?: ite   // 解包真实异常
    }
}
```

`HookBridge.invokeOriginalMethod` 在 native 端走 backup 句柄调用 hook 前的原始方法；`InvocationTargetException` 被解包为底层 cause 再抛，避免双重包装。

## 与 native 的协作

```mermaid
sequenceDiagram
    participant App as 目标应用
    participant Cpp as hook_bridge.cpp
    participant LSP as LSPlant
    participant VNH as VectorNativeHooker
    participant VC as VectorChain
    participant LD as LegacyDelegateImpl

    Note over Cpp,LSP: 首次 hookMethod
    Cpp->>LSP: Hook(method, hookerObj, callback方法)
    LSP-->>Cpp: backup 句柄

    Note over App,VNH: 方法被调用
    App->>LSP: 调用被 hook 的方法
    LSP->>VNH: callback(args[])
    VNH->>Cpp: callbackSnapshot(method)
    Cpp-->>VNH: [modern[], legacy[]]
    alt 两套都空
        VNH->>Cpp: invokeOriginalMethod
    else 有 hook
        VNH->>VC: 构造 rootChain + terminal
        VC->>VC: proceed 递归
        VC->>LD: terminal→processLegacyHook (如有legacy)
        LD->>Cpp: invokeOriginal
    end
    VNH->>VNH: 返回类型校验
    VNH-->>LSP: result
    LSP-->>App: 返回

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
```

## 相关

- [VectorChain · 递归链状态机](./vector-chain) — `callback` 构造并驱动它
- [VectorBootstrap · DI 引导](./vector-bootstrap) — `delegate` 提供 `processLegacyHook`
- [HookBridge · native JNI 门面](./hook-bridge) — `hookMethod`/`callbackSnapshot`/`invokeOriginalMethod`
- [hook_bridge.cpp · ART hook 引擎](../native/hook-bridge-cpp) — 实例化 trampoline、存 backup
- [LegacyDelegateImpl · 翻译边界](../legacy/legacy-delegate) — terminal 里的 legacy 处理
