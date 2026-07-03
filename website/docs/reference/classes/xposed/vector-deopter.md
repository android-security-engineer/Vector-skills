# 🧯 VectorDeopter / VectorInlinedCallers

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorDeopter.kt`
> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorInlinedCallers.kt`
> 🟩 xposed 模块 · AOT 反优化引擎与内联调用者注册表

## 类职责

- **`VectorInlinedCallers`**：`object` 单例，维护一份**已知会内联目标 hook 方法的框架方法注册表**，按场景（boot image / MIUI 资源 / system_server）分组。
- **`VectorDeopter`**：`object` 单例，扫描注册表中的方法，反射定位 `Executable` 后调 `HookBridge.deoptimizeMethod` 让 ART 放弃已编译/内联版本，确保后续 hook 能真正生效。

两者配合解决一个核心问题：ART 在 AOT/JIT 编译时会**内联**短小方法，若被内联的方法恰好是 hook 的调用者，hook 可能对内联后的代码失效。反优化这些调用者强制 ART 回到解释执行或重新编译，让 hook 生效。

## VectorInlinedCallers

```kotlin
object VectorInlinedCallers {
    const val KEY_BOOT_IMAGE = "boot_image"
    const val KEY_BOOT_IMAGE_MIUI_RES = "boot_image_miui_res"
    const val KEY_SYSTEM_SERVER = "system_server"

    private val callers = mutableMapOf<String, List<TargetExecutable>>()
    fun get(where: String): List<TargetExecutable>
}
```

| 键 | 触发场景 | 典型条目 |
| :--- | :--- | :--- |
| `boot_image` | Zygote/应用启动反优化 | `Instrumentation.newApplication`、`LoadedApk.makeApplicationInner`/`makeApplication`、`ContextImpl.getSharedPreferencesPath` |
| `boot_image_miui_res` | MIUI 资源 hook 前反优化 | `MiuiResources.init`/`updateMiuiImpl`/`loadOverlayValue`/`getThemeString`、`ResourcesManager.initMiuiResource`、`LoadedApk.getResources` 等 |
| `system_server` | system_server 启动反优化 | `emptyList()`（预留） |

`boot_image` 覆盖的是应用启动路径上会调用 `makeApplication`/资源初始化的关键方法——这些方法一旦被内联，`hookLoadPackage`/资源 hook 就无法在正确时机介入。

## TargetExecutable

```kotlin
data class TargetExecutable(
    val className: String,
    val methodName: String,        // "<init>" 表示构造器
    val params: Array<Class<*>>,
) {
    val isConstructor: Boolean get() = methodName == "<init>"
    // 自定义 equals/hashCode（params 用 contentEquals/contentHashCode）
}
```

强类型签名描述，`isConstructor` 靠 `methodName == "<init>"` 判定。因为 `Array<Class<*>>` 的默认 `equals` 是引用比较，所以重写为内容比较，保证能正确去重/查找。

## VectorDeopter

```kotlin
object VectorDeopter {
    @JvmStatic
    fun deoptMethods(where: String, cl: ClassLoader?)

    fun deoptBootMethods()
    @JvmStatic
    fun deoptResourceMethods()
    fun deoptSystemServerMethods(sysCL: ClassLoader)
}
```

| 入口 | 调用时机 | 转发 |
| :--- | :--- | :--- |
| `deoptBootMethods()` | Zygote 早期 | `deoptMethods(KEY_BOOT_IMAGE, null)` |
| `deoptResourceMethods()` | `XposedInit.hookResources` 之前 | MIUI 下转发 `KEY_BOOT_IMAGE_MIUI_RES`，非 MIUI 无操作 |
| `deoptSystemServerMethods(sysCL)` | system_server 加载 | `deoptMethods(KEY_SYSTEM_SERVER, sysCL)` |

`deoptResourceMethods` 只在 `Utils.isMIUI` 时动作——MIUI 的资源管线与 AOSP 差异大，需要额外反优化 `MiuiResources` 系列。

### deoptMethods 实现

```kotlin
@JvmStatic
fun deoptMethods(where: String, cl: ClassLoader?) {
    val targets = VectorInlinedCallers.get(where)
    if (targets.isEmpty()) return
    val searchClassLoader = cl ?: ClassLoader.getSystemClassLoader()
    for (target in targets) {
        runCatching {
            val clazz = Class.forName(target.className, false, searchClassLoader)
            val executable: Executable = if (target.isConstructor) {
                clazz.getDeclaredConstructor(*target.params)
            } else {
                clazz.getDeclaredMethod(target.methodName, *target.params)
            }
            executable.isAccessible = true
            HookBridge.deoptimizeMethod(executable)
        }.onFailure {
            Utils.Log.v(TAG, "Skipping deopt for ${target.className}#${target.methodName}: ${it.message}")
        }
    }
}
```

| 步骤 | 说明 |
| :--- | :--- |
| 取注册表 | `VectorInlinedCallers.get(where)`，空则提前返回 |
| 选 ClassLoader | 传入的 `cl` 优先，否则 `getSystemClassLoader`（system_server 需用自己的 CL 才能找到 `android.app.*`） |
| 反射定位 | `Class.forName`（不初始化）+ `getDeclaredConstructor/Method`，按 `isConstructor` 分流 |
| 放宽访问 | `isAccessible = true` 绕过隐藏 API 限制 |
| native 反优化 | `HookBridge.deoptimizeMethod` → `lsplant::Deoptimize` |
| 容错 | 单个失败只 `log.v`，不影响其余目标 |

## 反优化在启动流程中的位置

```mermaid
flowchart LR
    A["Zygote/进程启动"] --> B["VectorDeopter.deoptBootMethods"]
    B --> C["hook 资源?"]
    C -->|"是, MIUI"| D["deoptResourceMethods<br/>反优化 MiuiResources 系列"]
    C -->|"否"| E["跳过"]
    D --> F["XposedInit.hookResources"]
    E --> F
    F --> G["加载模块"]
    G --> H["应用启动"]
    H --> I["makeApplication<br/>已反优化→解释执行→hook 生效"]

    subgraph SS["system_server 路径"]
        S1["sysCL 就绪"] --> S2["deoptSystemServerMethods(sysCL)"]
    end

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,F,I,S2 class vec
    class C class hot
    class A,E,G,H,S1 class plain
```

## 相关

- [XposedInit · 模块加载](../legacy/xposed-init) — `hookResources` 内调 `deoptResourceMethods`
- [HookBridge · native JNI 门面](./hook-bridge) — `deoptimizeMethod` 门面
- [hook_bridge.cpp · ART hook 引擎](../native/hook-bridge-cpp) — `lsplant::Deoptimize` 实现
