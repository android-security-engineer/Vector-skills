# 🪝 XC_MethodHook / XC_MethodReplacement

> 📂 `legacy/src/main/java/de/robv/android/xposed/XC_MethodHook.java`
> 📂 `legacy/src/main/java/de/robv/android/xposed/XC_MethodReplacement.java`
> 🟦 legacy 模块 · hook 回调抽象基类

## 类职责

`XC_MethodHook` 是所有方法 hook 回调的**抽象基类**，模块通过继承它并重写 `beforeHookedMethod`/`afterHookedMethod` 来介入目标方法。`XC_MethodReplacement` 是其特化，用 `replaceHookedMethod` 完全替换原方法（不调用原实现）。两者都继承 `XCallback`，携带 `priority` 决定回调顺序。

## XC_MethodHook

```java
public abstract class XC_MethodHook extends XCallback {
    public XC_MethodHook()              // 默认优先级
    public XC_MethodHook(int priority)  // 指定优先级

    protected void beforeHookedMethod(MethodHookParam<?> param) throws Throwable  // 空实现
    protected void afterHookedMethod(MethodHookParam<?> param) throws Throwable   // 空实现

    public void callBeforeHookedMethod(MethodHookParam<?> param) throws Throwable  // 转发
    public void callAfterHookedMethod(MethodHookParam<?> param) throws Throwable
}
```

| 回调 | 时机 | 能力 |
| :--- | :--- | :--- |
| `beforeHookedMethod` | 原方法调用前 | 可改 `args`、`setResult`/`setThrowable` 阻止原方法 |
| `afterHookedMethod` | 原方法调用后 | 可改 `result`/`throwable` 修改返回值 |

所有回调抛出的 `Throwable` 都被框架捕获并 log，不会让目标进程崩溃。

### MethodHookParam

```java
public static final class MethodHookParam<T extends Executable> extends XCallback.Param {
    public Member method;            // 被 hook 的方法/构造器
    public Object thisObject;        // 实例方法=this，静态=null
    public Object[] args;            // 实参数组
    public Object result = null;
    public Throwable throwable = null;
    public boolean returnEarly = false;

    public Object getResult();
    public void   setResult(Object result);        // before 调用 → 阻止原方法
    public Throwable getThrowable();
    public boolean hasThrowable();
    public void   setThrowable(Throwable t);       // before 调用 → 阻止原方法
    public Object getResultOrThrowable() throws Throwable;
}
```

`setResult`/`setThrowable` 都会清空对方并置 `returnEarly=true`。`returnEarly` 是 `LegacyApiSupport` 判断是否跳过原方法、以及 after 链是否回写的唯一开关。

### Unhook

```java
public class Unhook implements IXUnhook<XC_MethodHook> {
    public Member getHookedMethod();     // 返回被 hook 的方法
    public XC_MethodHook getCallback();  // 返回回调本身
    public void unhook();                // 委托 XposedBridge.unhookMethod
}
```

`Unhook` 是非静态内部类，持有外部 `XC_MethodHook.this`，`hookMethod` 返回它作为卸载句柄。

## XC_MethodReplacement

```java
public abstract class XC_MethodReplacement extends XC_MethodHook {
    public XC_MethodReplacement()
    public XC_MethodReplacement(int priority)

    protected final void beforeHookedMethod(MethodHookParam param)  // sealed：调 replaceHookedMethod
    protected final void afterHookedMethod(MethodHookParam param)   // sealed：空

    protected abstract Object replaceHookedMethod(MethodHookParam param) throws Throwable;
}
```

`XC_MethodReplacement` 把 `beforeHookedMethod`/`afterHookedMethod` 标为 `final`：before 里调 `replaceHookedMethod` 并 `setResult`（异常则 `setThrowable`），after 为空。原方法**永远不会被调用**。

### 预定义替换器

```java
public static final XC_MethodReplacement DO_NOTHING = ...  // PRIORITY_HIGHEST*2，恒返回 null

public static XC_MethodReplacement returnConstant(Object result)              // 默认优先级
public static XC_MethodReplacement returnConstant(int priority, Object result) // 指定优先级
```

| 常量/工厂 | 行为 |
| :--- | :--- |
| `DO_NOTHING` | 跳过原方法，返回 null（最高优先级，确保最先短路） |
| `returnConstant(v)` | 跳过原方法，恒返回 `v` |

## 回调顺序语义

`beforeHookedMethod` 按 priority **从高到低**正序调用；`afterHookedMethod` 按 priority **从高到低**逆序调用（即最高优先级的 after 最后执行，拥有对返回值的最终控制权）。这是 `XCallback` 的契约，`CopyOnWriteSortedSet`/`LegacyApiSupport` 都遵循此序。

## 调用时序

```mermaid
sequenceDiagram
    participant Native as VectorNativeHooker
    participant LAS as LegacyApiSupport
    participant CB1 as 回调A (priority高)
    participant CB2 as 回调B (priority低)
    participant Orig as 原方法

    Native->>LAS: handleBefore()
    LAS->>CB1: beforeHookedMethod(param)
    CB1->>CB1: setResult?(returnEarly=true)
    alt returnEarly
        LAS->>LAS: break before 链
    else 继续
        LAS->>CB2: beforeHookedMethod(param)
    end
    alt returnEarly=false
        LAS->>Native: 调用原方法
        Native->>Orig: invokeOriginalMethod
        Orig-->>Native: result
    end
    LAS->>LAS: handleAfter() 逆序
    LAS->>CB2: afterHookedMethod(param)
    LAS->>CB1: afterHookedMethod(param)
    LAS-->>Native: result/throwable

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge) — `hookMethod` 返回 `Unhook`
- [XposedHelpers · 工具集](./xposed-helpers) — `findAndHookMethod` 接受本类回调
- [LegacyDelegateImpl · 翻译边界](./legacy-delegate) — `processLegacyHook` 驱动 before/after
- [VectorChain · 现代递归链](../xposed/vector-chain) — 新 API 的等价机制
