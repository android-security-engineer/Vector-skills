# 🌐 HookBridge

> 📂 `xposed/src/main/kotlin/org/matrix/vector/nativebridge/HookBridge.kt`
> 🟩 xposed 模块 · native JNI 门面（对应 hook_bridge.cpp）

## 类职责

`object HookBridge` 是 Kotlin/Java 侧与 native ART hook 引擎（`hook_bridge.cpp`）之间的**唯一 JNI 门面**。所有 hook 注册/卸载、原方法调用、反优化、回调快照、类型检查、DEX 信任标记等操作都经它声明为 `external` 函数，由 C++ 端实现并注册。

它是一个纯声明性对象——无字段、无逻辑，仅作 native 方法的命名空间与 Kotlin 调用入口。

## hook 注册与卸载

```kotlin
@JvmStatic
external fun hookMethod(
    useModernApi: Boolean,        // true=现代 API(VectorHookRecord), false=legacy(XC_MethodHook)
    hookMethod: Executable,       // 被 hook 的方法/构造器
    hooker: Class<*>,             // trampoline 类(VectorNativeHooker)
    priority: Int,                // 优先级
    callback: Any?,               // VectorHookRecord 或 XC_MethodHook
): Boolean

@JvmStatic
external fun unhookMethod(
    useModernApi: Boolean,
    hookMethod: Executable,
    callback: Any?,
): Boolean
```

`useModernApi` 区分两套回调存储路径：native `HookItem` 用 `modern_callbacks`/`legacy_callbacks` 两个 multimap 分别存。`hooker` 是 `VectorNativeHooker::class.java`，native 首次 hook 时用它构造 trampoline 对象。

## 反优化与原方法调用

```kotlin
@JvmStatic external fun deoptimizeMethod(method: Executable): Boolean

@JvmStatic
@Throws(InstantiationException::class)
external fun <T> allocateObject(clazz: Class<T>): T

@JvmStatic
@Throws(IllegalAccessException::class, IllegalArgumentException::class, InvocationTargetException::class)
external fun invokeOriginalMethod(method: Executable, thisObject: Any?, vararg args: Any?): Any?
```

| 方法 | 用途 | native 实现 |
| :--- | :--- | :--- |
| `deoptimizeMethod` | 让 ART 放弃内联/编译版本 | `lsplant::Deoptimize` |
| `allocateObject` | 不调构造器分配对象 | `env->AllocObject` |
| `invokeOriginalMethod` | 调 hook 前的原始方法 | 走 `HookItem.backup` 句柄调 `Method.invoke` |

`invokeOriginalMethod` 用 `vararg` 接收参数，native 端按 `Method.invoke` 语义处理 `thisObject`/`args`。

## invokeSpecialMethod：非虚调用

```kotlin
@JvmStatic
@Throws(IllegalAccessException::class, IllegalArgumentException::class, InvocationTargetException::class)
external fun <T> invokeSpecialMethod(
    method: Executable,
    shorty: CharArray,           // 方法签名短描述，shorty[0]=返回类型
    clazz: Class<T>,             // 显式接收者类型（非虚分派）
    thisObject: Any?,
    vararg args: Any?,
): Any?
```

`invokeSpecialMethod` 用 JNI `CallNonvirtual*MethodA` 实现**非虚调用**——即使子类重写了方法，也调用 `clazz` 上声明的版本。`shorty` 是类型短描述（`V`/`I`/`J`/`L`/`[` 等），native 端据此选择正确的 `CallNonvirtualXxxMethodA` 并做安全拆箱/装箱。native 实现用 `alloca` 在栈上分配 `jvalue[]`，并全局缓存包装类引用与 `valueOf` 方法 ID 以避免重复查找。

## 快照与类型检查

```kotlin
@JvmStatic @FastNative external fun instanceOf(obj: Any?, clazz: Class<*>): Boolean
@JvmStatic @FastNative external fun setTrusted(cookie: Any?): Boolean

@JvmStatic
external fun callbackSnapshot(hooker_callback: Class<*>, method: Executable): Array<Array<Any?>>

@JvmStatic external fun getStaticInitializer(clazz: Class<*>): Method?
```

| 方法 | 用途 |
| :--- | :--- |
| `instanceOf` | 跨 ClassLoader 的可靠 instanceof（`@FastNative` 优化） |
| `setTrusted` | 把内存加载的 DEX 标记为可信（绕过隐藏 API 限制），`lsplant::MakeDexFileTrusted` |
| `callbackSnapshot` | 返回 `Object[2][]`：[0]=现代回调数组（按 `hooker_callback` 类型），[1]=legacy 回调数组 |
| `getStaticInitializer` | 取 `<clinit>` 的 `Method`，找不到返回 null |

`callbackSnapshot` 是 `VectorNativeHooker.callback` 的关键输入——它在锁内对 callback 列表做一致快照，避免遍历期间被并发注册/卸载打断。`hooker_callback` 参数（即 `VectorHookRecord::class.java`）让 native 端用严格类型构造现代回调数组。

## native 方法注册签名

对应 `hook_bridge.cpp` 的 `gMethods[]`，JNI 签名表：

| Kotlin 声明 | JNI 签名 |
| :--- | :--- |
| `hookMethod` | `(ZLjava/lang/reflect/Executable;Ljava/lang/Class;ILjava/lang/Object;)Z` |
| `unhookMethod` | `(ZLjava/lang/reflect/Executable;Ljava/lang/Object;)Z` |
| `deoptimizeMethod` | `(Ljava/lang/reflect/Executable;)Z` |
| `invokeOriginalMethod` | `(Ljava/lang/reflect/Executable;Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;` |
| `invokeSpecialMethod` | `(Ljava/lang/reflect/Executable;[CLjava/lang/Class;Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;` |
| `allocateObject` | `(Ljava/lang/Class;)Ljava/lang/Object;` |
| `instanceOf` | `(Ljava/lang/Object;Ljava/lang/Class;)Z` |
| `setTrusted` | `(Ljava/lang/Object;)Z` |
| `callbackSnapshot` | `(Ljava/lang/Class;Ljava/lang/reflect/Executable;)[[Ljava/lang/Object;` |
| `getStaticInitializer` | `(Ljava/lang/Class;)Ljava/lang/reflect/Method;` |

## 调用关系

```mermaid
flowchart TD
    subgraph KT["Kotlin/Java 侧"]
        XH["XposedHelpers / XposedBridge"]
        VNH["VectorNativeHooker"]
        VHB["VectorHookBuilder"]
        VD["VectorDeopter"]
    end
    HB["HookBridge (object)"]
    subgraph CPP["hook_bridge.cpp"]
        HM["hooked_methods map"]
        HI["HookItem"]
        LSP["LSPlant"]
    end

    XH -->|"hookMethod(false,...)"| HB
    VHB -->|"hookMethod(true,...)"| HB
    VNH -->|"callbackSnapshot"| HB
    VNH -->|"invokeOriginalMethod"| HB
    VD -->|"deoptimizeMethod"| HB
    XH -->|"invokeOriginalMethod"| HB
    HB -->|"JNI"| HM
    HM --> HI
    HI --> LSP

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class HB class vec
    class VNH,VHB class hot
    class XH,VD,HM,HI,LSP class plain
```

## 相关

- [hook_bridge.cpp · ART hook 引擎](../native/hook-bridge-cpp) — 所有 `external` 的 C++ 实现
- [VectorNativeHooker · JNI trampoline](./vector-native-hooker) — `hookMethod`/`callbackSnapshot`/`invokeOriginalMethod` 主消费者
- [VectorHookBuilder · hook 注册](./vector-native-hooker) — `intercept` 调 `hookMethod(true,...)`
- [VectorDeopter · AOT 反优化](./vector-deopter) — `deoptimizeMethod` 调用方
- [XposedBridge · 中枢门面](../legacy/xposed-bridge) — `hookMethod(false,...)` legacy 路径
