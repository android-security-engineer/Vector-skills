# 🧩 VectorModuleManager · 模块管理

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/core/VectorModuleManager.kt`
> 🟦 xposed 模块 · 模块 APK 装载与实例化

## 类职责

`object VectorModuleManager` 负责把一个 `Module`（来自 `VectorServiceClient` 的模块列表）装载进目标进程：构造 native library 搜索路径、用 `VectorModuleClassLoader` 创建隔离 ClassLoader、做 API 类完整性校验、构造 `VectorContext`、反射实例化模块入口类、`attachFramework`、注册进 `VectorLifecycleManager.activeModules` 并触发 `onModuleLoaded`，最后登记模块声明的 native 入口。

## 方法签名

```kotlin
// 装载一个模块，返回是否成功
fun loadModule(module: Module, isSystemServer: Boolean, processName: String): Boolean
```

## 装载流程细节

1. **native 路径**：按 `Process.is64Bit()` 选 `SUPPORTED_64/32_BIT_ABIS`，拼 `${apkPath}!/lib/${abi}${pathSeparator}`；
2. **ClassLoader**：`VectorModuleClassLoader.loadApk(apkPath, preLoadedDexes, librarySearchPath, initLoader)`，`initLoader` 为 `XposedModule` 自身的 classLoader；
3. **完整性校验**：`moduleClassLoader.loadClass(XposedModule::class.java.name).classLoader === initLoader`，否则说明模块私打了 API 类，记日志并返回 false；
4. **Context**：`VectorContext(packageName, applicationInfo, service)` 注入模块；
5. **实例化**：遍历 `module.file.moduleClassNames`，校验 `isAssignableFrom(XposedModule)`，无参构造 `newInstance`，`attachFramework`，加入 `activeModules`，调 `onModuleLoaded(ModuleLoadedParam)`；
6. **native 入口**：`module.file.moduleLibraryNames.forEach { NativeAPI.recordNativeEntrypoint(it) }`。

## 装载阶段与产物

| 阶段 | 输入 | 产物 | 失败处理 |
| :--- | :--- | :--- | :--- |
| native 路径 | `module.apkPath`、`Build.SUPPORTED_*_BIT_ABIS` | `librarySearchPath` 字符串 | — |
| ClassLoader | `apkPath`/`preLoadedDexes`/`librarySearchPath`/`initLoader` | `VectorModuleClassLoader` | 异常 → `return false` |
| 完整性校验 | `loadClass(XposedModule).classLoader` | `=== initLoader` 判定 | 私打 API → `return false` |
| Context | `packageName`/`applicationInfo`/`module.service` | `VectorContext` | — |
| 实例化 | `moduleClassNames` | `XposedModule` 实例 + `attachFramework` | 非 `XposedModule` 子类 skip，异常记日志 |
| native 登记 | `moduleLibraryNames` | `NativeAPI.recordNativeEntrypoint` | — |

## 隔离与安全要点

- **ClassLoader 隔离**：每个模块用独立的 `VectorModuleClassLoader`，parent 为 `XposedModule` 自身的 classLoader，模块间互不可见；
- **API 类私打检测**：若模块把 `XposedModule` 等 API 类编译进自己的 APK，`loadClass(...).classLoader` 会指向模块 CL 而非 `initLoader`，此时拒绝装载，避免 API 行为分叉；
- **无参构造强制**：模块入口类必须有无参构造，`setAccessible(true)` 后 `newInstance`；
- **`isSystemServer` 透传**：经 `ModuleLoadedParam.isSystemServer()` 传给模块，供其区分 system_server 与普通应用进程。

## 装载链路

```mermaid
flowchart TD
    A["loadModule(module)"] --> B["构造 native 路径"]
    B --> C["VectorModuleClassLoader.loadApk"]
    C --> D["API 类完整性校验"]
    D -->|"私打 API"| E["return false"]
    D -->|通过| F["VectorContext"]
    F --> G["遍历 moduleClassNames"]
    G --> H{"extends XposedModule?"}
    H -->|否| I["skip"]
    H -->|是| J["newInstance + attachFramework"]
    J --> K["activeModules.add"]
    K --> L["onModuleLoaded"]
    G --> M["recordNativeEntrypoint"]
    L --> N["return true"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,F,G,J,K,L,M class vec
    class D,H class hot
    class A,E,I,N class plain
```

## 集成要点

- `loadModule` 不去重：同 `Module` 重复调用会创建多个 ClassLoader 与实例，调用方需按 `modulesList` 保证只装载一次；
- 加入 `activeModules` 后模块可收后续事件，但**不补发**装载前已错过的包事件——故 system_server 模块须在 `startBootstrapServices` 之前装载；
- `module.file.preLoadedDexes` 是 daemon 端预 dex 产物，传给 `VectorModuleClassLoader` 跳过首次 DEX 校验加速装载；
- 顶层 `try/catch` 兜底，单模块异常仅记日志并返回 false，不中断同进程其他模块装载。
- 装载成功后 `Log.d` 记录 `Loaded module ${packageName} successfully`，失败路径分别记 `Log.e`，便于在 logcat 中按 `VectorModuleManager` tag 过滤排查。
- `module.service` 即 `VectorServiceClient`，模块通过 `XposedModule` 框架上下文间接访问 daemon IPC，而非持有原始 binder。

## 相关

- [VectorServiceClient · Daemon 客户端](./vector-service-client)（提供 `Module` 与 `service`）
- [VectorLifecycleManager · 生命周期分发](./vector-lifecycle-manager)（`activeModules` 的消费方）
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
