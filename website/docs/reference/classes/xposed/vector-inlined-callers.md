# 🎯 VectorInlinedCallers · 内联调用 registry

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorInlinedCallers.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorInlinedCallers.kt)
> 🟦 xposed 模块 · 需去优化的内联调用点注册表

## 类职责

`object VectorInlinedCallers` 维护一份**会被编译器内联、从而可能绕过普通方法 hook 的关键调用点**清单。`VectorDeopter` 据此对这些 `Executable` 做去优化，使 hook 能稳定生效。配套数据类 `TargetExecutable` 描述一个调用点。

## TargetExecutable（data class）

`data class TargetExecutable(className, methodName, params: Array<Class<*>>)` —— 强类型描述一个可执行目标。

| 属性 | 含义 |
| :--- | :--- |
| `className` | 宿主类全限定名 |
| `methodName` | 方法名，`"<init>"` 表示构造 |
| `params` | 形参类型数组 |
| `isConstructor` | `methodName == "<init>"` |

重写 `equals`/`hashCode`（`params` 用 `contentEquals`/`contentHashCode`）以作 map key。

## VectorInlinedCallers

### 关键常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `KEY_BOOT_IMAGE` | `"boot_image"` | boot image 阶段的内联点 |
| `KEY_BOOT_IMAGE_MIUI_RES` | `"boot_image_miui_res"` | MIUI 资源相关内联点 |
| `KEY_SYSTEM_SERVER` | `"system_server"` | system_server 内联点（当前空） |

### 注册内容

`KEY_BOOT_IMAGE` 的内联点（boot image 阶段，Application 创建路径）：

| 类 | 方法 | 参数 |
| :--- | :--- | :--- |
| `android.app.Instrumentation` | `newApplication` | `ClassLoader, String, Context` |
| `android.app.Instrumentation` | `newApplication` | `ClassLoader, Context` |
| `android.app.LoadedApk` | `makeApplicationInner` | `boolean, Instrumentation, boolean` |
| `android.app.LoadedApk` | `makeApplicationInner` | `boolean, Instrumentation` |
| `android.app.LoadedApk` | `makeApplication` | `boolean, Instrumentation` |
| `android.app.ContextImpl` | `getSharedPreferencesPath` | `String` |

`KEY_BOOT_IMAGE_MIUI_RES` 的内联点（MIUI 资源体系，需在 MIUI ROM 上去优化）：

| 类 | 方法 | 参数 |
| :--- | :--- | :--- |
| `android.content.res.MiuiResources` | `init` | `String` |
| `android.content.res.MiuiResources` | `updateMiuiImpl` | （无） |
| `android.content.res.MiuiResources` | `loadOverlayValue` | `TypedValue, int` |
| `android.content.res.MiuiResources` | `getThemeString` | `CharSequence` |
| `android.content.res.MiuiResources` | `<init>` | `ClassLoader` / （无）/ `AssetManager, DisplayMetrics, Configuration` |
| `android.miui.ResourcesManager` | `initMiuiResource` | `Resources, String` |
| `android.app.LoadedApk` | `getResources` | `Resources` |
| `android.content.res.Resources` | `getSystem` | `Resources` |
| `android.app.ApplicationPackageManager` | `getResourcesForApplication` | `ApplicationInfo` |
| `android.app.ContextImpl` | `setResources` | `Resources` |

`KEY_SYSTEM_SERVER` 为 `emptyList()`，预留 system_server 专用内联点扩展位。

### 查询语义

`get(where)` 在 `callers` 找不到 key 时返回 `emptyList()`，调用方（`VectorDeopter`）据此跳过该分组的去优化。MIUI 分组里的类在非 MIUI ROM 上不存在，反射查找会安全失败——注释称之为"simplified string-based resolution for unavailable classes"。

### 方法签名

```kotlin
fun get(where: String): List<TargetExecutable>
```

## 分组与去优化

```mermaid
flowchart TD
    A["VectorDeopter"] --> B["VectorInlinedCallers.get(KEY)"]
    B --> C{"KEY"}
    C -->|boot_image| D["Instrumentation/LoadedApk/ContextImpl"]
    C -->|boot_image_miui_res| E["MiuiResources/ResourcesManager"]
    C -->|system_server| F["空列表 → 跳过"]
    D --> G["逐项去优化"]
    E --> G
    G --> H["hook 可稳定生效"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,E,G class vec
    class C class hot
    class A,F,H class plain
```

## 相关

- [SystemServerHookers · 系统服务 hook](./system-server-hookers)（`VectorDeopter.deoptSystemServerMethods` 的同类机制）
- [LoadedApkHookers · ClassLoader 生命周期](./loaded-apk-hookers)（多处 `makeApplication` 内联点由此注册）
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
