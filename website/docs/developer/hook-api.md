# Hook API

这一节讲清楚两种 API 下 Hook 的注册、执行控制与异常处理。底层都路由到同一个 native 引擎，差异只在表层接口。

## 经典 API

### 注册 Hook

`XposedHelpers.findAndHookMethod` 是最常用的入口，它定位方法并注册回调：

```kotlin
XposedHelpers.findAndHookMethod(
    targetClass,
    "methodName",
    String::class.java, Int::class.java,  // 参数类型
    object : XC_MethodHook() {
        override fun beforeHookedMethod(param: MethodHookParam) {
            // 方法执行前：可改参数、跳过执行
            param.args[0] = "replaced-arg"
        }
        override fun afterHookedMethod(param: MethodHookParam) {
            // 方法执行后：可改返回值
            param.result = transform(param.result)
        }
    }
)
```

### 控制执行

| 操作 | 方式 |
| :--- | :--- |
| 改参数 | `param.args[index] = newValue` |
| 改返回值 | `param.result = newValue`（before 设则跳过原方法） |
| 跳过原方法 | before 里设 `param.result`，原方法不执行 |
| 抛异常替代返回 | `param.throwable = Exception(...)` |
| 完全替换方法 | 用 `XC_MethodReplacement` 代替 `XC_MethodHook` |

### 反射缓存

`findAndHookMethod` 内部的反射查找走结构化缓存（`MemberCacheKey`），key 基于对象身份与结构属性而非字符串，重复查找**零分配**。所以反复 hook 同一方法是廉价的。

## 现代 API (libxposed)

现代 API 把 Hook 抽象为拦截器链，`Hooker` 类似 OkHttp 的 Interceptor。

### 注册 Hook

```kotlin
val method = targetClass.getDeclaredMethod("methodName", ...)
hook(method, MyHooker::class.java)
```

### Hooker 与优先级

每个 Hooker 带 `priority`。多个模块 hook 同一方法时，按优先级组成链：

```mermaid
graph LR
    C["调用方"]:::in
    C --> B1["Hooker(高优先级).before"]:::step
    B1 --> B2["Hooker(中).before"]:::step
    B2 --> B3["Hooker(低).before"]:::step
    B3 --> O["原方法执行"]:::orig
    O --> A3["Hooker(低).after"]:::step2
    A3 --> A2["Hooker(中).after"]:::step2
    A2 --> A1["Hooker(高优先级).after"]:::step2
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step2 fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef orig fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

### ExceptionMode

`VectorChain` 实现 `ExceptionMode`，`PROTECTIVE` 模式下：

- 拦截器在 `proceed()` **之前**抛异常 → 链跳过该拦截器，不影响下游。
- 拦截器在 `proceed()` **之后**抛异常 → 链捕获并恢复缓存的下游结果，**保护宿主进程**。

::: warning 别让模块异常搞崩宿主
模块代码抛出的未处理异常，在 PROTECTIVE 模式下不会传播到宿主应用。但依赖这个保护是不好的习惯——你的 Hook 逻辑应自己处理异常，避免依赖框架兜底。
:::

## 调用原方法

有时你想在 Hook 里调用原方法（绕过其他 Hook，或选择性执行）：

| 需求 | 经典 API | 现代 API |
| :--- | :--- | :--- |
| 调用原方法（绕过所有 Hook） | `XposedBridge.invokeOriginalMethod` | `Invoker.Type.Origin` |
| 执行部分 Hook 链 | — | `Invoker.Type.Chain`（按 `maxPriority`） |
| 构造函数特殊调用 | — | `VectorCtorInvoker`（分离分配与初始化） |

## Hook 失败的稳定性

native 层的 `HookBridge` 用原子操作设置备份方法 trampoline。若用户尝试调用一个**失败 Hook** 的原方法，框架**抛 Java 异常而非 native 崩溃**——避免一个坏 Hook 直接搞崩整个进程。

## 小结

| 维度 | 经典 API | 现代 API |
| :--- | :--- | :--- |
| 风格 | 回调 (`XC_MethodHook`) | 拦截器链 (`Hooker`) |
| 类型安全 | 弱（反射、字符串） | 强 |
| 优先级控制 | 有 | 有，更显式 |
| 异常保护 | `LegacyApiSupport` 兜底 | `ExceptionMode.PROTECTIVE` |
| 部分链执行 | 不直接支持 | `Invoker.Type.Chain` |

两套 API 底层共享同一个并发 native registry，可以共存于同一进程。
