# 🪆 Hook 内部类与匿名类

> 难度 ⭐⭐⭐ · 内部类、匿名类的二进制名含 `$`，混淆后还会改名，定位是关键。

## 场景

Hook 回调接口的匿名实现、Builder 的内部类、`ActivityThread` 的内部类、混淆后名如 `a$b$c` 的类。

## `$` 记法

JVM 二进制名里，嵌套类用 `$` 分隔，不是 `.`：

```kotlin
// 外部类 com.target.app.Foo 的内部类 Bar
// Java 源码：class Foo { static class Bar {} }
// 二进制名：com.target.app.Foo$Bar

val clazz = XposedHelpers.findClass("com.target.app.Foo\$Bar", lpparam.classLoader)
// Kotlin 字符串里 $ 需转义为 \$
```

| 类型 | 源码形态 | 二进制名 |
| :--- | :--- | :--- |
| 静态内部类 | `Foo.Bar` | `com.target.app.Foo$Bar` |
| 非静态内部类 | `Foo.Bar`（持外部引用） | `com.target.app.Foo$Bar` |
| 匿名类 | `new Runnable(){...}` | `com.target.app.Foo$1` |
| Lambda | `() -> {}` | `com.target.app.Foo$$Lambda$0`（可能被去糖） |

定位内部类时，源码里的嵌套关系要先转成 JVM 二进制名（`$` 分隔），再判断是否非静态内部类（构造隐含外部引用）。下图把"源码形态 → 二进制名 → Hook 构造签名"的转换链画清楚：

```mermaid
graph TD
    SRC["源码嵌套类"]:::in
    SRC --> C1{"静态 or 非静态?"}
    C1 -->|静态内部类| S1["二进制名 Outer$Inner<br/>构造签名: (参数...)"]:::ok
    C1 -->|非静态内部类| S2["二进制名 Outer$Inner<br/>构造签名: (Outer, 参数...)"]:::trap
    C1 -->|匿名类| S3["二进制名 Outer$1<br/>无稳定名, 按接口反查"]:::trap
    C1 -->|Lambda| S4["二进制名 Outer$$Lambda$0<br/>可能被去糖, 改 hook SAM"]:::trap
    S1 --> HOOK["findAndHookConstructor / findAndHookMethod"]
    S2 --> HOOK
    S3 --> IFACE["按 isAssignableFrom 反查"]
    S4 --> IFACE
    IFACE --> HOOK
    HOOK --> ESC["Kotlin 字符串里 $ 转义为 \$"]:::check
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
    classDef trap fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef check fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
```

> 关键卡点：非静态内部类构造**首参隐含外部类实例**（`param.args[0]` 是 `Outer`），漏写就 `NoSuchMethodError`；匿名类编号随源码漂移，硬编码 `Outer$1` 下次编译即失效，必须按实现的接口/父类反查。

## 非静态内部类的隐含字段

非静态内部类构造函数**首参数隐含外部类引用**，Hook 构造时要把外部类类型放进参数表：

```kotlin
// 源码：class Outer { class Inner(val x: Int) }
// 实际签名：Inner(Outer, int)
XposedHelpers.findAndHookConstructor(
    "com.target.app.Outer\$Inner",
    lpparam.classLoader,
    "com.target.app.Outer",   // 隐含的外部类引用
    Int::class.javaPrimitiveType,
    object : XC_MethodHook() {
        override fun afterHookedMethod(param: MethodHookParam) {
            // param.args[0] 是外部类实例
        }
    }
)
```

## ProGuard 混淆后定位

混淆后类名变成 `a`、`a$b`、`a$a`，无法按名字定位。策略是**按特征锚定**：

```mermaid
graph TD
    A["混淆后类名 a$b"]:::trap
    A --> B["改用方法签名/字段类型反查"]:::step
    B --> C{"能唯一锚定?"}
    C -->|是| D["hook 命中方法"]:::ok
    C -->|否| E["遍历 DexFile 全部类<br/>按接口/字段类型筛选"]:::step
    E --> D
    style A fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    style step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    style D fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

按签名反查示例：

```kotlin
// 目标：混淆类里返回 String、参数为 (int, String) 的方法
val outer = lpparam.classLoader.loadClass("com.target.app.a")
for (m in outer.declaredClasses) {           // 遍历内部类
    for (method in m.declaredMethods) {
        if (method.returnType == String::class.java &&
            method.parameterTypes.contentEquals(
                arrayOf(Int::class.javaPrimitiveType, String::class.java))) {
            XposedBridge.hookMethod(method, hooker)
        }
    }
}
```

## 匿名类的生命周期

匿名类没有稳定名字（`Foo$1`、`Foo$2` 随源码顺序变），且每次编译可能编号漂移。优先按**实现的接口/父类**反查，而非硬编码编号：

```kotlin
// 找实现了 OnClickListener 的匿名类
for (clazz in loadedClasses) {
    if (OnClickListener::class.java.isAssignableFrom(clazz) &&
        clazz.isAnonymousClass) {
        // 锚定成功
    }
}
```

## 陷阱清单

| 陷阱 | 后果 | 对策 |
| :--- | :--- | :--- |
| 漏写 `\` 转义 `$` | `findClass` 报 ClassNotFoundException | Kotlin 字符串里写 `\$` |
| 忘记隐含外部类参数 | 找不到构造函数 | 非静态内部类首参补外部类 |
| 硬编码混淆名 `a$b` | 下次混淆即失效 | 按签名/接口反查 |
| Lambda 被去糖 | 目标类不存在 | Hook 函数式接口的 SAM 方法 |

## 相关

- [Hook 构造函数](./hook-constructor)
- [Hook 静态方法](./hook-static-method)
- [Hook API](../developer/hook-api)
- [架构 · legacy · ProGuard](../architecture/legacy)
