# 🧰 XposedHelpers · 反射工具方法详解

> 📂 [`legacy/src/main/java/de/robv/android/xposed/XposedHelpers.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/legacy/src/main/java/de/robv/android/xposed/XposedHelpers.java)
> 🟦 legacy 模块 · 方法/字段/构造器查找与调用的统一工具集

## 类职责

`public final class XposedHelpers` 是 Xposed API 中**最常用的反射门面**。它把"按名称定位方法/字段/构造器 → 设为 accessible → 缓存 → 调用/取值/赋值"这套模板代码收口为一组静态方法，并内置 `ConcurrentHashMap` 缓存与递归父类查找，让模块代码专注于 hook 逻辑本身。

Vector 版本相比原版有两处关键强化：

- **结构化缓存键** `MemberCacheKey`：用对象键（`Field`/`Method`/`Constructor` 内部类）而非字符串拼接做 `HashMap` 键，避免字符串计算的 hashCode 抵消 HashMap 查找收益（源码注释引用了 LSPosed/cloak 的反射基准测试）。
- **递归字段查找** `findFieldRecursiveImpl`：`getDeclaredField` 未命中时沿父类链逐层上探直到 `Object`，弥补原版只查声明类的局限。

## 方法查找系列

```java
// 精确匹配（参数类型严格相等），命中后 setAccessible(true) 并入缓存
public static Method findMethodExact(Class<?> clazz, String methodName, Class<?>... parameterTypes)
public static Method findMethodExact(String className, ClassLoader classLoader, String methodName, Object... parameterTypes)
public static Method findMethodExactIfExists(Class<?> clazz, String methodName, Object... parameterTypes)  // 不抛异常，未命中返回 null

// 最佳匹配：先试 exact，失败则按 ClassUtilsX.isAssignable 兼容性 + MemberUtilsX.compareMethodFit 选最优
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Class<?>... parameterTypes)
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Object... args)                 // 由实参类型推导
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Class<?>[] parameterTypes, Object[] args) // null 形参由实参补全

// 按返回类型 + 参数类型批量查找
public static Method[] findMethodsByExactParameters(Class<?> clazz, Class<?> returnType, Class<?>... parameterTypes)
```

`findMethodExact` 与 `findMethodBestMatch` 共享同一个 `methodCache`，但缓存键的 `isExact` 标志不同——精确匹配与模糊匹配各自独立缓存，互不污染。`findMethodBestMatch` 的模糊分支会跳过父类的 `private` 方法（`considerPrivateMethods` 在进入父类后置 false），防止意外命中不可继承的实现。

## 字段查找系列

```java
public static Field findField(Class<?> clazz, String fieldName)              // 递归父类查找，命中 setAccessible(true)
public static Field findFieldIfExists(Class<?> clazz, String fieldName)      // 未命中返回 null
public static Field findFirstFieldByExactType(Class<?> clazz, Class<?> type) // 按字段类型找第一个，Proguard 混淆类利器
```

`findFieldRecursiveImpl` 的查找路径：先 `clazz.getDeclaredField`，未命中则 `while` 循环取 `getSuperclass()` 逐层 `getDeclaredField`，遇 `Object.class` 或 null 终止并抛原 `NoSuchFieldException`。这让访问父类的 private 字段成为可能，是原版所没有的能力。

## getObjectField / setObjectField 系列

字段访问按"实例/静态 × 类型"两维展开，每个原始类型都有对应的 getter/setter：

```java
// 实例字段（obj.getClass() 定位）
public static Object getObjectField(Object obj, String fieldName)
public static boolean getBooleanField(Object obj, String fieldName)
public static int    getIntField(Object obj, String fieldName)
public static long   getLongField(Object obj, String fieldName)
// ... byte/char/double/float/short 同构
public static void setObjectField(Object obj, String fieldName, Object value)
public static void setBooleanField(Object obj, String fieldName, boolean value)
// ... 其余原始类型 setter 同构

// 静态字段（传 Class<?>）
public static Object getStaticObjectField(Class<?> clazz, String fieldName)
public static void   setStaticObjectField(Class<?> clazz, String fieldName, Object value)
// ... getStaticBooleanField / getStaticIntField 等同构

// 内部类外部实例
public static Object getSurroundingThis(Object obj)  // 等价 getObjectField(obj, "this$0")
```

所有 getter/setter 的实现模板一致：`findField(...).<type>Get/Set(obj, value)`，捕获 `IllegalAccessException`（理论上不应发生，因已 setAccessible）转 `IllegalAccessError`，`IllegalArgumentException` 原样上抛。这意味着字段名写错会在运行时以 `NoSuchFieldError` 失败，而非编译期发现。

## callMethod / callStaticMethod 系列

```java
public static Object callMethod(Object obj, String methodName, Object... args)
public static Object callMethod(Object obj, String methodName, Class<?>[] parameterTypes, Object... args)
public static Object callStaticMethod(Class<?> clazz, String methodName, Object... args)
public static Object callStaticMethod(Class<?> clazz, String methodName, Class<?>[] parameterTypes, Object... args)
```

均通过 `findMethodBestMatch` 解析方法后 `.invoke(obj|null, args)`，把 `InvocationTargetException` 的 cause 包成 `InvocationTargetError`（一个 `Error` 子类，调用方无需 try-catch）。`parameterTypes` 重载用于实参含 `null` 时消歧。

## newInstance 系列

```java
public static Object newInstance(Class<?> clazz, Object... args)
public static Object newInstance(Class<?> clazz, Class<?>[] parameterTypes, Object... args)
```

经 `findConstructorBestMatch` 解析后 `.newInstance(args)`，`InstantiationException` 转 `InstantiationError`。`initXResources` 中构造假 `ActivityThread` 即用此方法。

## 缓存与附加字段

```java
private static final ConcurrentHashMap<MemberCacheKey.Field, Optional<Field>> fieldCache;
private static final ConcurrentHashMap<MemberCacheKey.Method, Optional<Method>> methodCache;
private static final ConcurrentHashMap<MemberCacheKey.Constructor, Optional<Constructor<?>>> constructorCache;
private static final WeakHashMap<Object, HashMap<String, Object>> additionalFields;  // 模拟给对象附加字段
```

`Optional` 包装未命中结果，避免反复反射查找。`additionalFields` 配合 `setAdditionalInstanceField`/`getAdditionalInstanceField`/`removeAdditionalInstanceField`（及 `*StaticField` 变体）实现"给对象附加临时数据"，用 `WeakHashMap` 键随对象回收。

## 查找与调用流程

```mermaid
flowchart TD
    A["模块调用<br/>findMethodExact"] --> B["构造 MemberCacheKey"]
    B --> C{"methodCache 命中?"}
    C -->|命中| D["返回缓存 Method"]
    C -->|未命中| E["getDeclaredMethod<br/>+ setAccessible"]
    E --> F{"找到?"}
    F -->|是| G["Optional.of 存缓存"]
    F -->|否| H["Optional.empty 存缓存<br/>→ NoSuchMethodError"]
    G --> D
    D --> I["callMethod: invoke"]
    I --> J{"InvocationTargetException?"}
    J -->|是| K["包成 InvocationTargetError"]
    J -->|否| L["返回结果"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,E,F,G,H class vec
    class J class hot
    class A,D,I,K,L class plain
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge)
- [XC_MethodHook · 回调基类](./xc-method-hook)
- [findMethod 查找算法](../../../cookbook/hook-static-method) （如已存在）
- [hiddenapi 模块总览](../../modules/hiddenapi)
