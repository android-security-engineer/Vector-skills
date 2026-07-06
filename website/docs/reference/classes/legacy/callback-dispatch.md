# 🔀 XposedBridge · 回调分发与异常隔离

> 📂 [`legacy/src/main/java/de/robv/android/xposed/XposedBridge.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/legacy/src/main/java/de/robv/android/xposed/XposedBridge.java) · `LegacyApiSupport` 内部类
> 🟦 legacy 模块 · before/after 调用顺序、异常隔离、unhook 语义

## 类职责

`public static class LegacyApiSupport<T extends Executable>` 是 Vector 把**现代 native hook 管线**与**传统 `XC_MethodHook` 回调模型**粘合的翻译核心。当 ART 引擎通过 `VectorNativeHooker` 触发一次被 hook 方法时，`LegacyApiSupport` 负责把 native 侧的 `VectorLegacyCallback` 状态同步成 `MethodHookParam`，按"正序 before → 原始方法 → 逆序 after"的传统语义分发，并在每一步做异常隔离。

## 字段

```java
private final XC_MethodHook.MethodHookParam<T> param;     // 传统参数对象，每次 hook 新建
private final VectorLegacyCallback<T> callback;            // 现代回调，持有 method/thisObject/args/result/skip
private final Object[] snapshot;                           // 回调快照数组（已按优先级排序）
private int beforeIdx;                                     // before 遍历游标，供 after 逆序复用
```

## handleBefore：正序 + returnEarly 短路

```java
public void handleBefore() {
    syncronizeApi(param, callback, true);                  // 现代 → 传统
    for (beforeIdx = 0; beforeIdx < snapshot.length; beforeIdx++) {
        try {
            ((XC_MethodHook) snapshot[beforeIdx]).beforeHookedMethod(param);
        } catch (Throwable t) {
            XposedBridge.log(t);                           // 异常隔离：记日志，不中断链
            param.setResult(null);
            param.returnEarly = false;                     // 重置，让后续 before 仍能跑
        }
        if (param.returnEarly) { beforeIdx++; break; }     // 跳过剩余 before，保留位置供 after
    }
    syncronizeApi(param, callback, false);                 // 传统 → 现代（条件写回）
}
```

要点：

- **正序**遍历（`beforeIdx` 从 0 递增），高优先级先执行。
- 任一回调 `setResult`/`setThrowable` 置 `returnEarly=true`，立即 `break` 跳过剩余 before → 原始方法不会执行。
- 回调抛异常时**不中断链**：记日志、`setResult(null)`、`returnEarly=false`，让后续 before 回调仍有机会运行。这是关键的异常隔离设计。
- `beforeIdx++` 后 break，保证 `handleAfter` 能从"最后一个执行的 before 的下一个位置"逆序回溯。

## handleAfter：逆序 + 结果恢复

```java
public void handleAfter() {
    syncronizeApi(param, callback, true);                  // 重新同步（拿到原始方法执行后的 result/throwable）
    for (int afterIdx = beforeIdx - 1; afterIdx >= 0; afterIdx--) {
        Object lastResult = param.getResult();             // 暂存，供异常时回退
        Throwable lastThrowable = param.getThrowable();
        try {
            ((XC_MethodHook) snapshot[afterIdx]).afterHookedMethod(param);
        } catch (Throwable t) {
            XposedBridge.log(t);
            if (lastThrowable == null) param.setResult(lastResult);       // 回退到进入前结果
            else param.setThrowable(lastThrowable);
        }
    }
    syncronizeApi(param, callback, false);
}
```

要点：

- **逆序**遍历（从 `beforeIdx-1` 递减），最高优先级的 after 最后执行 → 拥有对返回值的最终决定权。
- 每个 after 之前暂存 `lastResult`/`lastThrowable`，若该 after 抛异常，**回退**到暂存值——保证一个异常回调不会污染其他回调的结果。
- 异常隔离策略：before 是"重置并继续"，after 是"回退并继续"。

## syncronizeApi：双向状态同步

```java
private void syncronizeApi(MethodHookParam<T> param, VectorLegacyCallback<T> callback, boolean forward) {
    if (forward) {                                         // 进入：现代 callback → 传统 param
        param.method = callback.getMethod();
        param.thisObject = callback.getThisObject();
        param.args = callback.getArgs();
        param.result = callback.getResult();
        param.throwable = callback.getThrowable();
        param.returnEarly = callback.isSkipped();
    } else {                                               // 退出：传统 param → 现代 callback
        callback.setThisObject(param.thisObject);
        callback.setArgs(param.args);
        if (param.returnEarly) {                           // 仅当模块显式跳过原始方法时才写回结果/异常
            if (param.throwable != null) callback.setThrowable(param.throwable);
            else callback.setResult(param.result);
        }
    }
}
```

`forward=false` 时**条件写回** result/throwable：只有 `returnEarly=true`（模块主动 `setResult`/`setThrowable`）才把结果交还 native。这避免普通拦截式 hook 的结果意外覆盖 native 已计算的原始返回值——尊重"默认调用原方法"的语义。

## unhook 处理

unhook 不在 `LegacyApiSupport` 内，而在 `XC_MethodHook.Unhook`：

```java
public class Unhook implements IXUnhook<XC_MethodHook> {
    public void unhook() {
        XposedBridge.unhookMethod(hookMethod, XC_MethodHook.this);   // → HookBridge.unhookMethod(false, executable, callback)
    }
}
```

回调快照在 hook 触发瞬间由 `getSnapshot()` 取得，是当时的一致性引用。即便中途 unhook，本快照仍按原列表执行完毕——unhook 只影响**后续**触发。这是写时复制快照模型的固有特性。

## 分发流程

```mermaid
flowchart TD
    N["native VectorNativeHooker"] --> L["LegacyApiSupport"]
    L --> S1["syncronizeApi forward<br/>现代→传统"]
    S1 --> B{"正序 before i=0..n"}
    B -->|抛异常| B1["log + setResult(null)<br/>returnEarly=false"]
    B -->|setResult/Throwable| B2["returnEarly=true<br/>break"]
    B -->|正常| B3["继续下一个"]
    B1 --> B
    B3 --> B
    B2 --> S2["syncronizeApi backward<br/>条件写回"]
    B -->|遍历完| S2
    S2 --> C{"returnEarly?"}
    C -->|否| O["invokeOriginalMethod<br/>执行原始"]
    C -->|是| SK["跳过原始"]
    O --> A
    SK --> A
    A["handleAfter"] --> S3["syncronizeApi forward"]
    S3 --> AF{"逆序 after i=beforeIdx-1..0"}
    AF -->|抛异常| AF1["log + 回退<br/>lastResult/lastThrowable"]
    AF -->|正常| AF2["继续逆序"]
    AF1 --> AF
    AF2 --> AF
    AF -->|遍历完| S4["syncronizeApi backward"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,B1,B2,B3,AF,AF1,AF2,S1,S2,S3,S4 class vec
    class C class hot
    class N,L,O,SK,A class plain
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge)
- [xposed-bridge-tl · 内部队列](./xposed-bridge-tl)
- [XC_MethodHook · 回调基类](./xc-method-hook)
- [xc-method-replacement · 替换式基类](./xc-method-replacement)
