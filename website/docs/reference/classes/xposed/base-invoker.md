# ⚙️ BaseInvoker · 调用系统基类

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/hooks/BaseInvoker.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/hooks/BaseInvoker.kt)
> 🟦 xposed 模块 · `Invoker` 调用系统的核心实现

## 类职责

`internal abstract class BaseInvoker<T, U : Executable> : Invoker<T, U>` 是 Vector 调用系统的基类。它根据 `Invoker.Type` 决定是直接调原方法（`Origin`）还是构造一条部分 hook 链（`Chain`，按 `maxPriority` 过滤现代 hook，并兼容 legacy hook），最终都落到 `HookBridge.invokeOriginalMethod`。配套两个具体子类 `VectorMethodInvoker`（普通方法）与 `VectorCtorInvoker`（构造方法，支持 `newInstance`/`newInstanceSpecial`）。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `executable` | `U : Executable` | 被调用的 Method/Constructor |
| `type` | `Invoker.Type` | 默认 `Chain.FULL`，可经 `setType` 改 |

## 方法签名（基类）

```kotlin
// 设置调用类型（Origin / Chain），返回 this 供链式
override fun setType(type: Invoker.Type): T

// 按 type 解析并执行底层方法
protected fun proceedInvocation(thisObject: Any?, args: Array<out Any?>): Any?

// 生成 JNI shorty（返回类型 + 参数类型字符）
protected fun getExecutableShorty(): CharArray
```

`proceedInvocation` 的两条路径：

- **`Origin`**：直接 `HookBridge.invokeOriginalMethod`，`InvocationTargetException` 解包 `cause`；
- **`Chain`**：`HookBridge.callbackSnapshot` 取现代/legacy 两组 hook 快照，按 `maxPriority` 过滤现代 hook，构造 `terminal` 闭包——若存在 legacy hook 则经 `delegate.processLegacyHook` 包裹原方法调用，否则直接调原方法；最后用 `VectorChain` 串起执行。

`getTypeShorty` 把 `Int/Long/Float/Double/Boolean/Byte/Char/Short/Void` 映射为 `I/J/F/D/Z/B/C/S/V`，其余为 `L`。

---

## VectorMethodInvoker

`internal class VectorMethodInvoker(method: Method) : BaseInvoker<VectorMethodInvoker, Method>(method)`

```kotlin
override fun invoke(thisObject: Any?, vararg args: Any?): Any?

// 非虚拟直接调用（不经 hook 链）
override fun invokeSpecial(thisObject: Any, vararg args: Any?): Any?
```

`invokeSpecial` 走 `HookBridge.invokeSpecialMethod(executable, shorty, declaringClass, thisObject, *args)`。

---

## VectorCtorInvoker

`internal class VectorCtorInvoker<T : Any>(constructor: Constructor<T>) : BaseInvoker<CtorInvoker<T>, Constructor<T>>, CtorInvoker<T>`

```kotlin
override fun invoke(thisObject: Any?, vararg args: Any?): Any?   // 返回 null
override fun invokeSpecial(thisObject: Any, vararg args: Any?): Any?   // 返回 null

// 先 allocateObject 分配内存，再 proceedInvocation 驱动 <init>
override fun newInstance(vararg args: Any?): T

// 子类构造：校验继承关系，allocateObject 子类后 invokeSpecialMethod
override fun <U : Any> newInstanceSpecial(subClass: Class<U>, vararg args: Any?): U
```

## 调用路径

```mermaid
flowchart TD
    A["module.invoke / newInstance"] --> B["proceedInvocation"]
    B --> C{"type"}
    C -->|Origin| D["HookBridge.invokeOriginalMethod"]
    C -->|Chain| E["callbackSnapshot 取 hook"]
    E --> F["按 maxPriority 过滤现代 hook"]
    F --> G["构造 terminal"]
    G --> H{"有 legacy hook?"}
    H -->|是| I["delegate.processLegacyHook 包裹"]
    H -->|否| J["直接 invokeOriginalMethod"]
    I --> K["VectorChain.proceed"]
    J --> K
    L["invokeSpecial / newInstanceSpecial"] --> M["HookBridge.invokeSpecialMethod"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,E,F,G,K,M class vec
    class C,H class hot
    class A,L,I,J class plain
```

## 相关

- [VectorLegacyCallback · legacy 回调桥接](./vector-legacy-callback)
- [VectorInlinedCallers · 内联调用 registry](./vector-inlined-callers)
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
