# 🖥️ SystemServerHookers · 系统服务 hook

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/hookers/SystemServerHookers.kt`
> 🟦 xposed 模块 · system_server 启动拦截与去优化

## 类职责

拦截 `system_server` 进程入口与 `SystemServer.startBootstrapServices`，在系统服务初始化阶段完成两件事：对内联严重的系统服务方法做去优化（deopt）、把 system_server 加载事件分发给现代与 legacy 模块引擎。

## 类清单

| 对象 | 说明 |
| :--- | :--- |
| [`HandleSystemServerProcessHooker`](#handlesystemserverprocesshooker) | 拦截 system_server 进程入口，去优化 + 挂载 bootstrap hook |
| [`StartBootstrapServicesHooker`](#startbootstrapserviceshooker) | 拦截 `startBootstrapServices`，派发加载事件 |

---

## HandleSystemServerProcessHooker

`object HandleSystemServerProcessHooker : XposedInterface.Hooker` —— 拦截 system_server 的顶层入口方法。`intercept` 先 `chain.proceed()`，取当前线程 `contextClassLoader`，调 `initSystemServer`。

### 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `callback` | `@Volatile Callback?` | 外部注册的 system_server 加载回调 |
| `systemServerCL` | `@Volatile ClassLoader?` | system_server 的 ClassLoader（私有 set） |

### 内部接口

```kotlin
interface Callback {
    fun onSystemServerLoaded(classLoader: ClassLoader)
}
```

### 方法签名

```kotlin
override fun intercept(chain: XposedInterface.Chain): Any?

// system_server 初始化：去优化 + 挂 startBootstrapServices hook + 回调
fun initSystemServer(classLoader: ClassLoader, isLate: Boolean = false)
```

`initSystemServer` 幂等（`systemServerCL != null` 直接返回）。非 late 路径反射找 `com.android.server.SystemServer.startBootstrapServices`，用 `VectorHookBuilder(startMethod).intercept(StartBootstrapServicesHooker)` 挂载。最后触发 `callback?.onSystemServerLoaded`。

---

## StartBootstrapServicesHooker

`object StartBootstrapServicesHooker : XposedInterface.Hooker` —— 拦截 `startBootstrapServices`，取出 `systemServerCL` 后调 `dispatchSystemServerLoaded`。

```kotlin
override fun intercept(chain: XposedInterface.Chain): Any?

// 双路派发：现代 + legacy
fun dispatchSystemServerLoaded(classLoader: ClassLoader)
```

`dispatchSystemServerLoaded` 先 `VectorLifecycleManager.dispatchSystemServerStarting(classLoader)`（现代），再 `VectorBootstrap.withLegacy { delegate.onSystemServerLoaded(classLoader) }`（legacy）。

## 启动序列

```mermaid
flowchart TD
    A["system_server 进程入口"] --> B["HandleSystemServerProcessHooker.intercept"]
    B --> C["chain.proceed"]
    C --> D["initSystemServer(CL)"]
    D --> E["VectorDeopter.deoptSystemServerMethods"]
    D --> F["反射 startBootstrapServices"]
    F --> G["VectorHookBuilder.intercept(StartBootstrapServicesHooker)"]
    D --> H["callback.onSystemServerLoaded"]
    I["startBootstrapServices 执行"] --> J["StartBootstrapServicesHooker.intercept"]
    J --> K["dispatchSystemServerLoaded"]
    K --> L["现代: dispatchSystemServerStarting"]
    K --> M["legacy: onSystemServerLoaded"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,E,F,G,J,K,L,M class vec
    class C,H class plain
    class A,I class plain
```

## 相关

- [VectorLifecycleManager · 生命周期分发](./vector-lifecycle-manager)
- [LoadedApkHookers · ClassLoader 生命周期](./loaded-apk-hookers)
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
