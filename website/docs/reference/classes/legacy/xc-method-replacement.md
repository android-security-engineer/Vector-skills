# 🔁 XC_MethodReplacement · 替换式 hook 基类

> 📂 [`legacy/src/main/java/de/robv/android/xposed/XC_MethodReplacement.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/legacy/src/main/java/de/robv/android/xposed/XC_MethodReplacement.java)
> 🟦 legacy 模块 · 完全替换原方法实现的回调基类

## 类职责

`public abstract class XC_MethodReplacement extends XC_MethodHook` 是 `XC_MethodHook` 的特化分支：当一个 hook 想**彻底替换**原方法（不调用原始实现）时，继承它比重写 `beforeHookedMethod`/`afterHookedMethod` 更直接、语义更清晰。模块只需实现一个 `replaceHookedMethod(param)`，其返回值或抛出的异常即作为原方法的最终结果。

它通过 `final` 化两个钩子方法把"替换"语义钉死：

```java
@Override
protected final void beforeHookedMethod(MethodHookParam param) throws Throwable {
    try {
        Object result = replaceHookedMethod(param);   // 模块逻辑
        param.setResult(result);                      // 设结果 → returnEarly=true → 跳过原始方法
    } catch (Throwable t) {
        param.setThrowable(t);                        // 异常直接透传给调用方
    }
}

@Override
protected final void afterHookedMethod(MethodHookParam param) throws Throwable {
    // 空实现：替换模式下原方法不会被执行，after 无意义
}
```

`setResult` / `setThrowable` 都会把 `MethodHookParam.returnEarly` 置 true，从而在 `LegacyApiSupport.handleBefore` 中触发"跳过 `invokeOriginalMethod`"。这正是替换语义的底层支撑。

## 抽象方法

```java
// 模块实现此方法：返回值作为原方法返回，抛出的 Throwable 透传给原调用方
protected abstract Object replaceHookedMethod(MethodHookParam param) throws Throwable;
```

## 预置实例与工厂

```java
// 跳过原方法、返回 null（priority = PRIORITY_HIGHEST * 2，确保最先执行）
public static final XC_MethodReplacement DO_NOTHING;

// 返回固定值的工厂方法
public static XC_MethodReplacement returnConstant(final Object result)
public static XC_MethodReplacement returnConstant(int priority, final Object result)
```

`DO_NOTHING` 是一个匿名子类单例，`replaceHookedMethod` 直接 `return null`，优先级设为 `PRIORITY_HIGHEST * 2`（20000），高于任何普通回调，确保它第一个拿到控制权。`returnConstant` 返回一个闭包了 `result` 的匿名 `XC_MethodReplacement`，是"强制改返回值"的最简写法。

## 构造器

```java
public XC_MethodReplacement()             // 默认优先级 PRIORITY_DEFAULT (50)
public XC_MethodReplacement(int priority) // 指定优先级，见 XCallback.priority
```

## 关于 XC_MethodGlideReplacement

> ⚠️ 任务描述提及的 `XC_MethodGlideReplacement`（滑动替换）**未在当前源码中直接找到**。`legacy/src/main/java/de/robv/android/xposed/` 目录下只有 `XC_MethodReplacement.java` 一个文件，包内不存在 `Glide` 变体类。若该类曾在某些 Xposed 分支中出现，Vector 的 legacy 兼容层尚未移植它。需要"条件性替换"语义时，建议用 `XC_MethodHook` + `beforeHookedMethod` 中 `param.setResult(...)` 配合 `returnEarly` 实现。

## 替换 vs 拦截对比

```mermaid
flowchart TD
    subgraph 替换 ["XC_MethodReplacement"]
        R1["beforeHookedMethod (final)"] --> R2["replaceHookedMethod"]
        R2 -->|正常返回| R3["setResult<br/>returnEarly=true"]
        R2 -->|抛异常| R4["setThrowable<br/>returnEarly=true"]
        R3 --> R5["跳过 invokeOriginalMethod"]
        R4 --> R5
        R5 --> R6["afterHookedMethod (空)"]
    end

    subgraph 拦截 ["XC_MethodHook"]
        H1["beforeHookedMethod"] --> H2{"setResult/Throwable?"}
        H2 -->|否| H3["invokeOriginalMethod"]
        H2 -->|是| H4["跳过原始"]
        H3 --> H5["afterHookedMethod"]
        H4 --> H5
    end

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class R2,R3,R4,R5 class vec
    class H2 class hot
    class R1,R6,H1,H3,H4,H5 class plain
```

核心区别：替换式**不调用** `invokeOriginalMethod`（`afterHookedMethod` 为空），拦截式**默认调用**原方法并在之后还能改结果。选择替换式意味着放弃"基于原方法结果做后处理"的能力。

## 相关

- [XC_MethodHook · 回调基类](./xc-method-hook)
- [XposedBridge · 中枢门面](./xposed-bridge)
- [callback-dispatch · 回调分发](./callback-dispatch)
- [XposedHelpers · findAndHookMethod](./xposed-helpers-extra)
