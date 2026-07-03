# 🌉 XposedBridge

> 📂 `legacy/src/main/java/de/robv/android/xposed/XposedBridge.java`
> 🟦 legacy 模块 · Xposed API 的中枢门面

## 类职责

`public final class XposedBridge` 是整个 legacy Xposed API 的**中央入口与运行时枢纽**。它对外暴露 hook 注册/卸载、原始方法调用、资源初始化、包加载回调注册等核心能力；对内则将真实 ART hook 委托给现代 native 桥 `HookBridge`，并通过 `CopyOnWriteSortedSet` 与 `LegacyApiSupport` 在新旧两套回调模型之间做翻译。

Vector 的 `XposedBridge` 不是 rovo89 原版，而是**适配层**：方法签名与原版兼容，但 `hookMethod` 的真正实现下放到 `HookBridge.hookMethod(...)`（C++ ART 引擎），并把传统 `XC_MethodHook` 包装进 `VectorNativeHooker`/`VectorLegacyCallback` 管线。

## 关键常量与字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `BOOTCLASSLOADER` | `ClassLoader` | 系统类加载器，用于定位 Android 框架类（应用类不可见） |
| `TAG` | `String` | `"VectorLegacyBridge"`，日志标签 |
| `XPOSED_BRIDGE_VERSION` | `int`（@Deprecated） | 旧版本号字段，请用 `getXposedVersion()` |
| `sLoadedPackageCallbacks` | `CopyOnWriteArraySet<XC_LoadPackage>` | 包加载回调集合（模块注册入口） |
| `sInitPackageResourcesCallbacks` | `CopyOnWriteArraySet<XC_InitPackageResources>` | 资源初始化回调集合 |
| `dummyClassLoader` | `volatile ClassLoader` | 资源 hook 用的虚拟父加载器 |

## hook 注册与卸载

```java
// 挂载单个方法/构造器的回调，返回 Unhook 句柄
public static XC_MethodHook.Unhook hookMethod(Member hookMethod, XC_MethodHook callback)

// 批量挂载类中所有同名方法
public static Set<XC_MethodHook.Unhook> hookAllMethods(Class<?> hookClass, String methodName, XC_MethodHook callback)

// 批量挂载类的所有构造器
public static Set<XC_MethodHook.Unhook> hookAllConstructors(Class<?> hookClass, XC_MethodHook callback)

// @Deprecated 卸载回调，推荐用 Unhook.unhook()
public static void unhookMethod(Member hookMethod, XC_MethodHook callback)
```

`hookMethod` 的核心校验链：拒绝非 `Executable`、拒绝 abstract 方法、拒绝 hook 自身框架内部方法（`declaringClass.classLoader == XposedBridge.class.getClassLoader()`）、拒绝 `Method.invoke`。校验通过后调用 `HookBridge.hookMethod(false, executable, VectorNativeHooker.class, callback.priority, callback)`，由 native 端完成 ART 方法替换。

## 原始方法调用与反优化

```java
// 调用 hook 之前的原始方法（绕过所有 hook）
public static Object invokeOriginalMethod(Member method, Object thisObject, Object[] args) throws Throwable

// 反优化某方法，防止其被内联导致 hook 失效
public static void deoptimizeMethod(Member deoptimizedMethod)
```

`invokeOriginalMethod` 把 `args==null` 归一化为空数组，再委托 `HookBridge.invokeOriginalMethod`。`deoptimizeMethod` 同样校验后委托给 `HookBridge.deoptimizeMethod`。

## 包/资源回调注册

```java
public static void hookLoadPackage(XC_LoadPackage callback)            // synchronized add
public static void hookInitPackageResources(XC_InitPackageResources callback)
public static void initXResources()                                    // 构建资源 dummy classloader
```

`initXResources` 通过 `ResourcesHook.makeInheritable` 让 `Resources`/`TypedArray` 可继承，再用 `ResourcesHook.buildDummyClassLoader` 拼出 `xposed.dummy.XResourcesSuperClass` 等占位父类，并把自身 classloader 的 `parent` 字段替换为 dummy 加载器。ZUI 设备的 NPE 通过临时塞入假 `ActivityThread` 规避。

## CopyOnWriteSortedSet

```java
public static final class CopyOnWriteSortedSet<E> {
    private transient volatile Object[] elements = EMPTY_ARRAY;
    public synchronized boolean add(E e);       // 复制+排序+替换
    public synchronized boolean remove(E e);    // 复制+删+替换
    public Object[] getSnapshot();              // 无锁读快照
    public <T> T[] getSnapshot(T[] a);
    public synchronized void clear();
}
```

写时复制 + `volatile` 发布快照：写操作复制整个数组并 `Arrays.sort` 后整体替换引用，读操作（`getSnapshot`）无锁直接读当前引用。这保证了 hook 回调遍历时看到的一致性快照，且不会被并发注册打断。

## LegacyApiSupport（新旧翻译核心）

```java
public static class LegacyApiSupport<T extends Executable> {
    public LegacyApiSupport(VectorLegacyCallback<T> callback, Object[] legacySnapshot)
    public void handleBefore();   // 正序遍历 beforeHookedMethod
    public void handleAfter();    // 逆序遍历 afterHookedMethod
}
```

`handleBefore` 把现代 `VectorLegacyCallback` 的 method/thisObject/args/result/skip 状态同步到传统 `MethodHookParam`，逐个调用 `beforeHookedMethod`；任一回调 `setResult`/`setThrowable` 会让 `returnEarly=true` 并提前结束。`handleAfter` 从 `beforeIdx-1` 逆序回调，恢复下游结果/异常。`syncronizeApi` 在 forward/backward 两个方向同步参数，仅在模块显式 `returnEarly` 时才把结果/异常写回现代 callback。

## 调用流程

```mermaid
flowchart TD
    A["模块调用<br/>hookMethod"] --> B{"参数校验"}
    B -->|通过| C["HookBridge.hookMethod<br/>(native ART 替换)"]
    B -->|失败| D["log + 返回 null"]
    C --> E["返回 Unhook 句柄"]
    F["方法被调用"] --> G["VectorNativeHooker.callback"]
    G --> H["LegacyApiSupport.handleBefore"]
    H --> I{"returnEarly?"}
    I -->|否| J["invokeOriginalMethod"]
    I -->|是| K["跳过原始"]
    J --> L["LegacyApiSupport.handleAfter"]
    K --> L
    L --> M["返回结果/抛异常"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,G,H,J,L class vec
    class B,I class hot
    class A,D,E,F,K,M class plain
```

## 相关

- [XposedHelpers · 方法/字段工具](./xposed-helpers)
- [XC_MethodHook · 回调基类](./xc-method-hook)
- [LegacyDelegateImpl · 翻译边界](./legacy-delegate)
- [HookBridge · native JNI 门面](../xposed/hook-bridge)
- [hook_bridge.cpp · ART hook 引擎](../native/hook-bridge-cpp)
