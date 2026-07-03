# 🛠️ XposedHelpers

> 📂 `legacy/src/main/java/de/robv/android/xposed/XposedHelpers.java`
> 🟦 legacy 模块 · 反射查找与调用的工具集

## 类职责

`public final class XposedHelpers` 是 legacy Xposed API 的**静态工具门面**，封装了反射查找类/方法/构造器/字段、hook 一体化、动态调用方法、读写字段、附加实例字段、方法深度计数等高频操作。所有查找结果均走 `MemberCacheKey` 结构化缓存，避免重复反射开销。

## MemberCacheKey 结构化缓存

`XposedHelpers` 的性能核心是用**对象键**替代字符串键做缓存。字符串拼接会抹掉 HashMap 的哈希优势，因此用结构化键直接持有 `Class`/`String`/`Class[]`/`isExact`，靠反射对象的 `equals` 比较定位。

```java
private abstract static class MemberCacheKey {
    private final int hash;
    protected MemberCacheKey(int hash);
    public final int hashCode();            // 返回预计算 hash
    public abstract boolean equals(Object obj);
}

// 三个具体子类
static final class Field       extends MemberCacheKey  // (clazz, name)
static final class Method      extends MemberCacheKey  // (clazz, name, parameters, isExact)
static final class Constructor extends MemberCacheKey  // (clazz, parameters, isExact)
```

三个 `ConcurrentHashMap<MemberCacheKey, Optional<T>>` 分别缓存 Field/Method/Constructor，`Optional.empty()` 表示"已查过但不存在"（负缓存），避免重复抛 `NoSuchMethodException`。

| 缓存 | 类型 | 说明 |
| :--- | :--- | :--- |
| `fieldCache` | `ConcurrentHashMap<MemberCacheKey.Field, Optional<Field>>` | 字段查找缓存 |
| `methodCache` | `ConcurrentHashMap<MemberCacheKey.Method, Optional<Method>>` | 方法查找缓存 |
| `constructorCache` | `ConcurrentHashMap<MemberCacheKey.Constructor, Optional<Constructor<?>>>` | 构造器查找缓存 |
| `additionalFields` | `WeakHashMap<Object, HashMap<String,Object>>` | 附加实例字段（随对象回收） |
| `sMethodDepth` | `HashMap<String, ThreadLocal<AtomicInteger>>` | 方法调用深度计数 |

## 类与字段查找

```java
// 类查找（支持 java.lang.String[]、内部类 $ 与 . 两种写法）
public static Class<?> findClass(String className, ClassLoader classLoader)
public static Class<?> findClassIfExists(String className, ClassLoader classLoader)

// 字段查找（沿继承链递归到 superclass，跳过 Object）
public static Field findField(Class<?> clazz, String fieldName)
public static Field findFieldIfExists(Class<?> clazz, String fieldName)
public static Field findFirstFieldByExactType(Class<?> clazz, Class<?> type)  // 按类型找首字段
```

`findFieldRecursiveImpl` 先试 `getDeclaredField`，失败则沿 `getSuperclass()` 逐层上探，直到 `Object` 之前停止。

## 方法查找（精确 + 最佳匹配）

```java
// 精确匹配（参数类型必须完全一致）
public static Method findMethodExact(Class<?> clazz, String methodName, Class<?>... parameterTypes)
public static Method findMethodExact(String className, ClassLoader classLoader, String methodName, Object... parameterTypes)
public static Method findMethodExactIfExists(...)

// 最佳匹配（参数可赋值，含继承链，按 fit 度比较）
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Class<?>... parameterTypes)
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Object... args)
public static Method findMethodBestMatch(Class<?> clazz, String methodName, Class<?>[] parameterTypes, Object[] args)

// 按返回类型+参数类型找多个方法
public static Method[] findMethodsByExactParameters(Class<?> clazz, Class<?> returnType, Class<?>... parameterTypes)
```

`findMethodBestMatch` 先试精确匹配命中即返回，否则用 `isExact=false` 的缓存键在 `computeIfAbsent` 中遍历 `getDeclaredMethods()`（沿 superclass 上升且跳过父类 private），用 `ClassUtilsX.isAssignable` 筛选、`MemberUtilsX.compareMethodFit` 选最优。

## hook 一体化

```java
// 查找方法并挂 hook（末位参数为回调）
public static XC_MethodHook.Unhook findAndHookMethod(Class<?> clazz, String methodName, Object... parameterTypesAndCallback)
public static XC_MethodHook.Unhook findAndHookMethod(String className, ClassLoader classLoader, String methodName, Object... parameterTypesAndCallback)

// 查找构造器并挂 hook
public static XC_MethodHook.Unhook findAndHookConstructor(Class<?> clazz, Object... parameterTypesAndCallback)
public static XC_MethodHook.Unhook findAndHookConstructor(String className, ClassLoader classLoader, Object... parameterTypesAndCallback)

// 构造器查找
public static Constructor<?> findConstructorExact(Class<?> clazz, Class<?>... parameterTypes)
public static Constructor<?> findConstructorBestMatch(Class<?> clazz, Class<?>... parameterTypes)
```

`findAndHookMethod` 校验末位参数必须是 `XC_MethodHook`，用 `getParameterClasses` 把 `Class`/`String` 混合的参数表解析为纯 `Class[]`（String 走 `findClass` 解析），再调 `findMethodExact` + `XposedBridge.hookMethod`。

## 动态调用与实例化

```java
// 调用实例/静态方法（走 findMethodBestMatch 解析）
public static Object callMethod(Object obj, String methodName, Object... args)
public static Object callMethod(Object obj, String methodName, Class<?>[] parameterTypes, Object... args)
public static Object callStaticMethod(Class<?> clazz, String methodName, Object... args)
public static Object callStaticMethod(Class<?> clazz, String methodName, Class<?>[] parameterTypes, Object... args)

// 创建实例（走 findConstructorBestMatch）
public static Object newInstance(Class<?> clazz, Object... args)
public static Object newInstance(Class<?> clazz, Class<?>[] parameterTypes, Object... args)
```

`InvocationTargetError`（内部 Error 子类）包装被调用方法抛出的异常，与 `ClassNotFoundError` 一样不强制 catch。

## 字段读写

每个基本类型都有独立的 typed getter/setter（`getObjectField`/`setBooleanField`/`getIntField`/...），静态字段版本（`getStaticObjectField`/`setStaticIntField`/...）以 `null` 作为 `obj` 传入。所有都经 `findField(obj.getClass(), fieldName)` 取缓存字段再 `.set/.get`，`IllegalAccessException` 转 `IllegalAccessError`。

```java
public static Object getObjectField(Object obj, String fieldName)
public static void   setObjectField(Object obj, String fieldName, Object value)
public static Object getSurroundingThis(Object obj)   // 内部类取 this$0
// ... boolean/byte/char/double/float/int/long/short 实例与静态版本
```

## 附加字段与深度计数

```java
// 给对象"挂"额外字段（WeakHashMap，对象回收即清）
public static Object setAdditionalInstanceField(Object obj, String key, Object value)
public static Object getAdditionalInstanceField(Object obj, String key)
public static Object removeAdditionalInstanceField(Object obj, String key)
// 静态版本：以 obj.getClass() 为键
public static Object setAdditionalStaticField(Object obj/Class<?>, String key, Object value)

// 方法调用深度计数（ThreadLocal<AtomicInteger>）
public static int incrementMethodDepth(String method)
public static int decrementMethodDepth(String method)
public static int getMethodDepth(String method)
```

`incrementMethodDepth` 用于递归方法只在最外层执行一次逻辑（如 drawable 替换只加载一次）。

## 错误类型

| 内部类 | 父类 | 触发场景 |
| :--- | :--- | :--- |
| `ClassNotFoundError` | `Error` | `findClass` 找不到类 |
| `InvocationTargetError` | `Error` | `callMethod`/`newInstance` 被调方法抛异常 |

两者都继承 `Error` 而非 `Exception`，调用方无需 try-catch，未捕获时沿调用栈向上传播。

## 缓存查找流程

```mermaid
flowchart TD
    A["findMethodExact(clazz,name,params)"] --> B["构造 MemberCacheKey.Method<br/>(isExact=true)"]
    B --> C["methodCache.computeIfAbsent"]
    C --> D{"缓存命中?"}
    D -->|"已缓存 Optional"| E["返回/抛 NoSuchMethodError"]
    D -->|"首次查询"| F["clazz.getDeclaredMethod"]
    F --> G{"找到?"}
    G -->|"是"| H["setAccessible + Optional.of"]
    G -->|"否"| I["Optional.empty 负缓存"]
    H --> E
    I --> E
    J["findMethodBestMatch"] --> K["先试 findMethodExact"]
    K --> L{"命中?"}
    L -->|"是"| M["返回"]
    L -->|"否"| N["isExact=false 缓存键<br/>遍历 getDeclaredMethods 沿继承链"]
    N --> O["isAssignable 筛选 + compareMethodFit 选优"]
    O --> M

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,F,N,O class vec
    class D,G,L class hot
    class A,E,H,I,J,K,M class plain
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge)
- [XC_MethodHook · 回调基类](./xc-method-hook)
- [XposedInit · 模块加载](./xposed-init)
