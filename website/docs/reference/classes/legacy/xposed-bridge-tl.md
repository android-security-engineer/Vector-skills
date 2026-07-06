# 🧵 XposedBridge · 内部 ThreadLocal 与回调队列

> 📂 [`legacy/src/main/java/de/robv/android/xposed/XposedBridge.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/legacy/src/main/java/de/robv/android/xposed/XposedBridge.java)
> 🟦 legacy 模块 · hook 回调存储与线程状态的实现演进

## 类职责（本篇聚焦内部状态管理）

原版 rovo89 `XposedBridge` 用 `ThreadLocal` 栈保存"当前正在执行的 hook 链"以防递归重入，用自定义链表/`SortedSet` 维护每个方法的回调队列。**Vector 的 legacy 兼容层不再在 Java 侧维护这些结构**——它把回调的存储、排序、分发全部下放到 native ART 引擎（`HookBridge`）与现代回调管线（`VectorLegacyCallback`/`LegacyApiSupport`），Java 侧只保留少量入口集合。本篇梳理源码中**实际存在**的内部状态结构，并标注与原版差异。

## ThreadLocal：sMethodDepth

源码中唯一的 `ThreadLocal` 位于 `XposedHelpers`，用于追踪方法调用深度（重入计数），而非 hook 回调栈：

```java
// XposedHelpers.java
private static final HashMap<String, ThreadLocal<AtomicInteger>> sMethodDepth = new HashMap<>();
```

它按方法名为每个线程维护一个 `AtomicInteger` 深度计数器，供 `callMethod`/`invokeOriginalMethod` 等递归场景判断重入层次。`XposedBridge` 自身**没有** `ThreadLocal` 字段——原版用于传递 `MethodHookParam` 的 `ThreadLocal` 机制，在 Vector 中由 native 端的 `VectorLegacyCallback` 直接持有 param 状态替代。

## 回调存储：CopyOnWriteSortedSet

`XposedBridge` 内部定义的有序集合，是**包加载/资源回调**的容器（方法级 hook 回调由 native 持有）：

```java
public static final class CopyOnWriteSortedSet<E> {
    private transient volatile Object[] elements = EMPTY_ARRAY;

    public synchronized boolean add(E e);       // 复制 → Arrays.sort → 整体替换引用
    public synchronized boolean remove(E e);     // 复制 → 删 → 替换
    public synchronized void clear();
    public Object[] getSnapshot();               // 无锁读 volatile 快照
    public <T> T[] getSnapshot(T[] a);
    private int indexOf(Object o);               // 线性查找
}
```

写时复制 + `volatile` 发布：写操作复制整个数组、`Arrays.sort` 后整体替换 `elements` 引用；读操作（`getSnapshot`）无锁直接返回当前引用。排序依据元素自身的 `Comparable`/`equals`——对 `XCallback` 子类即按 `priority` 降序。这保证遍历回调时看到一致性快照，不被并发注册打断。

> 注：方法级 hook 的回调列表（原版 `XC_MethodHook` 链表）在 Vector 中**不在 Java 侧**。`hookMethod` 把单个 `callback` 直接交给 `HookBridge.hookMethod(...)`，native 端维护多模块回调的优先级合并。

## 入口回调集合

```java
public static final CopyOnWriteArraySet<XC_LoadPackage> sLoadedPackageCallbacks = new CopyOnWriteArraySet<>();
/*package*/ static final CopyOnWriteArraySet<XC_InitPackageResources> sInitPackageResourcesCallbacks = new CopyOnWriteArraySet<>();
```

这两个用的是 JDK 的 `CopyOnWriteArraySet`（非自定义的 `CopyOnWriteSortedSet`），因为包/资源回调的顺序由 `XCallback.priority` 在 `callAll` 时通过快照数组处理，集合本身不需要排序。`hookLoadPackage`/`hookInitPackageResources` 在 `synchronized` 块内 `add`。

## 优先级体系

优先级常量定义在 `XCallback`，`CopyOnWriteSortedSet` 与 `LegacyApiSupport` 都依赖它：

```java
// XCallback.java
public static final int PRIORITY_DEFAULT = 50;
public static final int PRIORITY_LOWEST   = -10000;
public static final int PRIORITY_HIGHEST  = 10000;
public final int priority;   // 构造时确定，不可变
```

`XC_MethodHook` 构造时把 `priority` 传给 `XCallback`，`hookMethod` 调用时透传 `callback.priority` 给 `HookBridge.hookMethod(..., callback.priority, callback)`，native 端据此在回调链中定位插入位置。

## 与原版的差异

| 机制 | 原版 rovo89 | Vector legacy |
| :--- | :--- | :--- |
| 方法 hook 回调链表 | Java 侧 `XC_MethodHook` 链表 + `sHookedMethodCallbacks` | native `HookBridge` 持有，Java 只传单个 callback |
| 当前 hook 上下文 | `ThreadLocal<MethodHookParam>` 栈 | `VectorLegacyCallback` 直接持有 param |
| 回调优先级排序 | Java 侧 `CopyOnWriteSortedSet` 按方法 | native 端合并，`CopyOnWriteSortedSet` 仅用于包/资源回调 |
| 方法深度/重入 | `ThreadLocal` 栈 | `XposedHelpers.sMethodDepth`（仅深度计数） |

## 状态流转

```mermaid
flowchart TD
    A["hookMethod(callback)"] --> B["HookBridge.hookMethod<br/>(传 priority)"]
    B --> C["native 维护回调链<br/>按 priority 插入"]
    C --> D["方法被调用"]
    D --> E["VectorNativeHooker.callback"]
    E --> F["LegacyApiSupport<br/>(持有 snapshot[])"]
    F --> G["handleBefore 正序"]
    G --> H["handleAfter 逆序"]

    I["hookLoadPackage(cb)"] --> J["sLoadedPackageCallbacks.add"]
    J --> K["callAll: callbacks 数组遍历"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,E,F,G,H class vec
    class D class hot
    class A,I,J,K class plain
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge)
- [callback-dispatch · 回调分发](./callback-dispatch)
- [XC_MethodHook · 回调基类](./xc-method-hook)
- [HookBridge · native JNI 门面](../xposed/hook-bridge)
