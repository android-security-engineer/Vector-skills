# 🔗 多模块 Hook 同一方法

> 难度 ⭐⭐⭐ · 多个模块同时 Hook 同一个方法时，理解链式执行与优先级，避免冲突。

## 场景

- 模块 A 改某方法参数，模块 B 改其返回值，二者共存。
- 两个模块都想替换同一方法，谁说了算？
- 你写的新模块要兼容已存在的旧模块行为。

## 链式执行

多个 Hook 注册到同一方法时，按 `priority` 组成一条链。经典 API 的 `XCallback` 优先级：**数字越大越早执行**（before 阶段从高到低，after 阶段从低到高逆序）。

```mermaid
graph LR
    C["调用方"]:::in
    C --> B1["模块A before<br/>priority=100"]:::step
    B1 --> B2["模块B before<br/>priority=50（默认）"]:::step
    B2 --> O["原方法执行"]:::orig
    O --> A2["模块B after"]:::step2
    A2 --> A1["模块A after"]:::step2
    A1 --> R["返回结果给调用方"]:::out
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step2 fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef orig fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 设置优先级

```kotlin
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.callbacks.XCallback

XposedHelpers.findAndHookMethod(
    target, "doWork",
    object : XC_MethodHook(XCallback.PRIORITY_HIGHEST) {   // 10000，最先执行
        override fun beforeHookedMethod(param: MethodHookParam) { /* ... */ }
    }
)
```

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `PRIORITY_LOWEST` | -10000 | 最后执行（before 阶段） |
| `PRIORITY_DEFAULT` | 50 | 默认 |
| `PRIORITY_HIGHEST` | 10000 | 最先执行 |

`XC_MethodReplacement` 也接受优先级——多个替换同时存在时，最高优先级的 `replaceHookedMethod` 生效并跳过原方法，下游替换不再执行。

## 现代 API

libxposed 的 `Hooker` 同样带 `priority`，链式语义一致。此外支持**部分链执行**：用 `Invoker.Type.Chain` + `maxPriority` 只执行到某个优先级为止，便于在 Hook 内调用"截断的原方法"。

```kotlin
@XposedHooker
class MyHooker : Hooker {
    @BeforeInvocation
    static fun before(ctx: BeforeHookCallback): MyHooker {
        // priority 在注册时指定
        return MyHooker()
    }
}
```

## 避免冲突的实践

| 实践 | 说明 |
| :--- | :--- |
| 只改你该改的 | 用 `before` 改参数、`after` 改返回值，而非整体替换，给其他模块留执行空间 |
| 谨慎用替换 | `XC_MethodReplacement` 会跳过原方法及下游 before，等于独占方法 |
| 显式优先级 | 多模块共存场景显式设 `priority`，别依赖默认值的隐式顺序 |
| 幂等设计 | 假设你的 before 可能被其他模块再改，不要假设参数值"已经是你设的" |
| 调用原方法而非假设 | 需要原结果时用 `invokeOriginalMethod`，别猜 |

## 冲突排查

两个模块行为互相覆盖时，开 verbose log 看 Hook 链的注册与执行顺序（[日志与调试](./debugging)）。同方法多 Hook 的执行轨迹会按优先级打印。也可在调试时只启用其中一个模块，逐个二分定位冲突来源。

## 异常保护

链中某模块抛异常不会直接搞崩宿主——经典 API 有 `LegacyApiSupport` 兜底，现代 API 有 `ExceptionMode.PROTECTIVE`：`proceed()` 之前抛异常跳过该拦截器，之后抛异常则恢复下游缓存结果。但别依赖兜底，自己处理异常。

## 设计建议

设计一个会被其他模块共存的 Hook 时，把自己想成链上的一个环节：尽量只读不改、要改就改最小范围、要替换就显式标高优先级并写文档说明。这样多个模块叠加时能各取所需，而不是互相覆盖。社区约定：替换型 Hook 在模块说明里声明"会替换 X 方法"，方便其他模块作者知道需要协调优先级。

## 常见冲突模式

| 模式 | 现象 | 处理 |
| :--- | :--- | :--- |
| 两模块都 `returnConstant` 同方法 | 只有最高优先级生效 | 协调优先级，或改用 after 微调 |
| A 替换 + B 改参数 | B 的 before 仍执行，但 A 跳过原方法 | A 设更高优先级并接受 B 的改动 |
| A 改返回值 + B 改返回值 | after 逆序，低优先级后改"赢" | 用 priority 控制谁最后写 result |
| A 调 `invokeOriginalMethod` | 绕过整条链（含 B） | 仅用于确需绕过场景，文档说明 |

## 相关

- [完全替换方法实现](./replace-implementation)
- [拦截并改写返回值](./replace-return)
- [日志与调试](./debugging)
- [Hook API](../developer/hook-api)
