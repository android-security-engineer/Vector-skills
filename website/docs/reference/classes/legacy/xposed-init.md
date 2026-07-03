# 🚀 XposedInit

> 📂 `legacy/src/main/java/de/robv/android/xposed/XposedInit.java`
> 🟦 legacy 模块 · 模块加载与资源 hook 入口

## 类职责

`public final class XposedInit` 是 legacy 模块的**启动协调器**，负责三类工作：加载 legacy 模块 APK 并实例化其入口类、加载现代模块（委托 `VectorModuleManager`）、以及初始化资源 hook 管线（`hookResources`）。它是模块生命周期与现代 DI 委托（`LegacyDelegateImpl`）之间的胶水层。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `startsSystemServer` | `boolean` | 当前进程是否为 system_server |
| `disableResources` | `volatile boolean` | 资源 hook 失败后置位，全局禁用 |
| `resourceInit` | `AtomicBoolean` | `hookResources` 的单次执行锁 |
| `loadedModules` | `Map<String, Optional<String>>` | 已加载模块：Optional 含 apk 路径=legacy 模块，empty=现代模块 |
| `loadedPackagesInProcess` | `Set<String>` | 进程内已加载包集合（ConcurrentHashMap.newKeySet） |

`loadedModules` 的设计很关键：`Optional.of(apk)` 表示这是 legacy 模块（`XSharedPreferences` 据此判断走新路径还是旧路径），`Optional.empty()` 表示现代模块。

## 模块加载

```java
// 从 VectorServiceClient 取 legacy 模块列表并逐个加载
public static void loadLegacyModules()

// 加载现代模块（委托 VectorModuleManager），并清理 ActivityThread.mPackages 缓存
public static void loadModules(ActivityThread at)

// 单个 legacy 模块加载：构造 librarySearchPath、VectorModuleClassLoader、校验 API、init 模块类
private static boolean loadModule(String name, String apk, PreLoadedApk file)
```

`loadLegacyModules` 遍历 `VectorServiceClient.getLegacyModulesList()`，先把 `name->Optional.of(apk)` 暂存进 `loadedModules`（供 `XSharedPreferences` 提前读到路径），再调 `loadModule`；加载失败则移除该条目。

`loadModule` 流程：

1. 按 `Process.is64Bit()` 选 ABI，拼出 `apk!/lib/<abi>` 形式的 `librarySearchPath`
2. 用 `VectorModuleClassLoader.loadApk(apk, preLoadedDexes, librarySearchPath, initLoader)` 构造隔离 classloader
3. 校验模块没有把 Xposed API 编进自己的 APK（`XposedBridge.class.getClassLoader()` 必须等于 `initLoader`），否则拒绝加载
4. `initNativeModule(file.moduleLibraryNames)` 记录 native 入口 so 名
5. `initModule(mcl, apk, file.moduleClassNames)` 实例化并分发入口

## initModule 入口分发

```java
private static boolean initModule(ClassLoader mcl, String apk, List<String> moduleClassNames)
```

对每个模块类：要求实现 `IXposedMod` 子接口，`newInstance()` 后按接口分发：

| 接口 | 动作 |
| :--- | :--- |
| `IXposedHookZygoteInit` | 调 `initZygote(StartupParam)`（modulePath、startsSystemServer） |
| `IXposedHookLoadPackage` | 包装成 `Wrapper` 经 `XposedBridge.hookLoadPackage` 注册 |
| `IXposedHookInitPackageResources` | 先 `hookResources()` 再注册资源回调 |

任一类加载失败只 log 不中断其他类；`count>0` 视为模块加载成功。

## hookResources 资源管线

```java
public static void hookResources() throws Throwable
```

`compareAndSet(false,true)` 保证只执行一次。步骤：

1. `VectorDeopter.deoptResourceMethods()` 反优化资源相关内联方法
2. `ResourcesHook.initXResourcesNative()` 初始化 native 资源 hook（失败则 `disableResources=true`）
3. hook `ApplicationPackageManager.getResourcesForApplication`，记录 packageName↔resDir
4. 按 SDK 版本选 `createResources`/`createResourcesForActivity`（S+）或 `getOrCreateResources`（R-），hook 其 after，把返回的 `Resources` 替换为 `XResources` 子类（`cloneToXResources`）
5. hook `TypedArray.obtain`，把结果替换为 `XResources.XTypedArray`
6. 替换系统 `Resources.mSystem` 为 `XResources`，调 `XResources.init(latestResKey)`

`cloneToXResources` 在资源首次加载时触发 `XC_InitPackageResources` 回调链（`XCallback.callAll`），让模块能在资源初始化时介入。

## 类关系

```mermaid
classDiagram
    class XposedInit {
        +loadLegacyModules()
        +loadModules(ActivityThread)
        +hookResources()
        -loadModule(name, apk, file)
        -initModule(mcl, apk, names)
        +disableResources
        +loadedModules
    }
    class VectorServiceClient {
        +getLegacyModulesList()
        +getModulesList()
        +getProcessName()
    }
    class VectorModuleClassLoader {
        +loadApk(apk, dexes, libPath, parent)
    }
    class VectorModuleManager {
        +loadModule(module, sysSrv, procName)
    }
    class VectorDeopter {
        +deoptResourceMethods()
    }
    class ResourcesHook {
        +initXResourcesNative()
    }
    class LegacyDelegateImpl {
        +loadModules(activityThread)
        +onPackageLoaded(info)
    }

    XposedInit ..> VectorServiceClient : 取模块列表
    XposedInit ..> VectorModuleClassLoader : 构造隔离 CL
    XposedInit ..> VectorModuleManager : 加载现代模块
    XposedInit ..> VectorDeopter : 反优化
    XposedInit ..> ResourcesHook : native 资源 hook
    LegacyDelegateImpl ..> XposedInit : 委托调用

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class XposedInit,VectorModuleClassLoader,VectorDeopter,ResourcesHook class vec
    class LegacyDelegateImpl class hot
    class VectorServiceClient,VectorModuleManager class plain
```

## 相关

- [XposedBridge · 中枢门面](./xposed-bridge)
- [XSharedPreferences · 跨进程偏好读](./xshared-preferences)
- [LegacyDelegateImpl · 翻译边界](./legacy-delegate)
- [VectorModuleClassLoader · 隔离 classloader](../xposed/vector-module-classloader)
- [VectorDeopter · AOT 反优化](../xposed/vector-deopter)
- [resources_hook.cpp · 资源 hook native](../native/resources-hook-cpp)
