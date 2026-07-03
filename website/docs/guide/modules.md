# 模块机制

模块是用户实际接触 Vector 的方式。这一节讲清楚"一个模块是什么、怎么被加载、怎么生效"。

## 模块是什么

一个 Xposed 模块本质上是一个**普通 APK**，但它声明了特殊的入口点。Vector 不会把它当作普通应用安装运行，而是把它的代码注入到目标进程里执行。

模块 APK 里有两个关键清单文件：

| 文件 | 作用 |
| :--- | :--- |
| `assets/xposed_init` | 声明 Java 入口类 |
| `assets/native_init` | 声明 native Hook 库文件名（可选） |

## 模块的生命周期

```mermaid
graph TD
    A["设备启动"] --> B["Zygisk 注入 system_server / 应用进程"]
    B --> C["框架向 Daemon 请求：<br/>哪些模块对这个进程生效？<br/>（Daemon 查 ConfigCache，按作用域过滤）"]
    C --> D["Daemon 返回模块 APK 路径列表"]
    D --> E["框架用 VectorModuleClassLoader<br/>从内存加载模块 APK"]
    E --> F["解析 assets/xposed_init → 找到入口类"]
    F --> G["注册回调：<br/>IXposedHookLoadPackage / IXposedHookZygoteInit / ..."]
    G --> H["目标应用加载时，触发回调<br/>→ 模块代码执行 Hook 注册"]
    style C fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    style E fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    style H fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 两种 API 体系

Vector 同时支持两套模块 API：

### 经典 API (`de.robv.android.xposed`)

老牌 Xposed 模块用的接口，由 [legacy 兼容层](../architecture/legacy) 实现。模块实现 `IXposedHookLoadPackage` 等接口，通过 `XposedHelpers.findAndHookMethod` 注册 Hook。

### 现代 API (libxposed)

类型安全的 OkHttp 风格拦截器链，由 [xposed 模块](../architecture/xposed) 实现。模块实现 `Hooker` 接口，通过 `HookBuilder` 注册 Hook。

两套 API 底层都路由到同一个 native Hook 引擎，可以共存。

```mermaid
graph TD
    LEG["经典 API<br/>de.robv.android.xposed<br/>（legacy 实现）"]:::api
    MOD["现代 API<br/>libxposed<br/>（xposed 实现）"]:::api
    LEG --> ENG["同一个 native Hook 引擎<br/>HookBridge / LSPlant"]:::core
    MOD --> ENG
    ENG --> ART["ART ArtMethod 入口点改写"]:::core
    classDef api fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

## 作用域

模块默认**不**对所有应用生效。用户需要管理器里为每个模块勾选"作用域"——即哪些应用进程允许加载该模块。

作用域信息存在 Daemon 的 SQLite 数据库里，以 `DaemonState` 不可变快照的形式缓存。每次有进程请求模块列表时，Daemon 都会核对作用域，**未授权的进程拿不到模块**。

## 隔离与隐蔽

模块加载时有几个关键设计：

- **从内存加载**：APK 映射进 `SharedMemory`，ART 摄取完 DEX 后立即解除映射，不留文件描述符。
- **ClassLoader 隔离**：模块的 ClassLoader 只挂在框架私有分支上，目标应用无法通过 `ClassLoader.getParent()` 链式反射发现模块。
- **`jar:` 拦截**：`VectorURLStreamHandler` 拦截标准 `jar:` 请求，避免触发 Android 全局 `JarFile` 缓存导致的文件锁。

## 接下来

想自己写模块，看[开发者文档](../developer/modules)。
