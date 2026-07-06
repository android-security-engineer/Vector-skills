# 🗃️ ConfigCache

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/data/ConfigCache.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/data/ConfigCache.kt)
> 🟦 daemon 模块 · 模块/作用域不可变快照与原子交换

## 类职责

`object ConfigCache` 是 daemon 的**配置缓存中枢**。它从 SQLite 与 PackageManager 构建一份完整的"已启用模块 + 进程作用域"快照，以不可变 `DaemonState` 形式发布，所有读操作无锁访问快照，写操作生成新副本后整体替换引用。它同时负责管理器 UID 校验、misc 路径初始化、模块 APK 解析、偏好目录准备等横切职责。

模块可写操作委托给 `ModuleDatabase`，模块偏好委托给 `PreferenceStore`；`ConfigCache` 自身只读 DB 构建快照。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `state` | `@Volatile DaemonState` | 当前不可变快照，`private set` |
| `dbHelper` | `Database` | 公开供 `PreferenceStore`/`ModuleDatabase` 使用的 SQLite helper |
| `cacheUpdateChannel` | `Channel<Unit>` | `CONFLATED` 通道，合并缓存更新请求 |

`init` 块启动一个协程消费 `cacheUpdateChannel`，每个请求调用 `performCacheUpdate()`；同时 `applySqliteHelperWorkaround()`。

## 懒初始化与缓存就绪

```kotlin
private fun ensureCacheReady()
```

首次发现 `PackageManager` binder 存活时，加锁执行 `updateManager(false)`、`setupMiscPath()`、`performCacheUpdate()`，最后 `state = state.copy(isCacheReady = true)`。`isManager`、`getModulesForProcess`、`shouldSkipProcess` 等读方法会先调 `ensureCacheReady()`。

## 管理器与 misc 路径

```kotlin
fun updateManager(uninstalled: Boolean)
private fun setupMiscPath()
```

`updateManager` 查 `DEFAULT_MANAGER_PACKAGE_NAME` 的 `PackageInfo`，经 `InstallerVerifier.verifyInstallerSignature` 校验签名后写 `managerUid`，卸载时置 `-1`。`setupMiscPath` 从偏好读 `misc_path`，缺失则在 `/data/misc` 下用随机 UUID 新建目录，设置 `rwx--x--x` 权限与 `u:object_r:xposed_data:s0` SELinux 上下文。

## performCacheUpdate · 原子交换核心

```kotlin
private fun performCacheUpdate()
```

1. 查 `modules` 表 `enabled = 1` 的行，逐个跨用户解析 `PackageInfo`；命中缓存的旧模块（APK 路径与父目录不变且全局命名空间可访问）直接复用；
2. 否则 `getModuleApkPath` 定位含 `META-INF/xposed/java_init.list` 或 `assets/xposed_init` 的 split，`FileSystem.loadModule` 预加载，构造 `Module`（`service = oldModule?.service ?: InjectedModuleService(pkgName)`）；
3. 找不到包或解析失败的记入 `obsoleteModules`/`obsoletePaths`，事后清理 DB；
4. 查 `scope INNER JOIN modules`，对 `app_pkg_name == "system"` 映射到 `ProcessScope("system_server", 1000)`，其余用 `fetchProcesses()` 展开进程名；模块自身进程会跨用户镜像到所有用户的同 appId；
5. **原子交换**：`state = oldState.copy(modules = newModules, scopes = newScopes)`。

`requestCacheUpdate()` 仅 `cacheUpdateChannel.trySend(Unit)`，由协程异步消费，避免写路径阻塞 IPC。

## 查询接口

```kotlin
fun isManager(uid: Int): Boolean
fun getModulesForProcess(processName: String, uid: Int): List<Module>
fun getModuleByUid(uid: Int): Module?
fun getModulesForSystemServer(): List<Module>
fun getModuleApkPath(info: ApplicationInfo): String?
fun getInstalledModules(): List<ApplicationInfo>
fun shouldSkipProcess(scope: ProcessScope): Boolean
fun getModuleScope(packageName: String): MutableList<ApplicationInfo>?
fun getAutoInclude(packageName: String): Boolean
fun getAutoIncludeModules(): List<String>
fun getPrefsPath(packageName: String, uid: Int): String
```

`getModulesForSystemServer` 先做 SELinux `execmem` 检查，再查 `app_pkg_name=system` 的行；未命中缓存的模块用 `PackageParser` 解析（失败回退空 `ApplicationInfo`），手动补 `sourceDir`/`dataDir`/`deviceProtectedDataDir`/`credentialProtectedDataDir`/`processName`/`uid`，刻意不写回 `state.modules`，留给下次缓存更新收敛。

`getPrefsPath` 按 `uid/PER_USER_RANGE` 计算 user 后缀，递归 `chown`/`chmod`：根目录 `755`、子目录 `711`、文件 `744`。

## 快照交换模型

```mermaid
flowchart LR
    A["写请求"] --> B["cacheUpdateChannel.trySend"]
    B --> C["performCacheUpdate"]
    C --> D["构建 newModules / newScopes"]
    D --> E["state = oldState.copy(...)"]
    E --> F["volatile 发布"]
    G["读线程"] -.->|无锁读| F

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,D,E,F class vec
    class B class hot
    class A,G class plain
```

## 缓存一致性保证

`state` 为 `@Volatile`，写端在 `performCacheUpdate` 完成构建后整体替换引用，读端无锁直接读旧引用——典型的不可变快照发布模式。这意味着读端在最坏情况下看到的是上一次的快照，但绝不会看到半构建的 `modules`/`scopes`。`obsoleteModules`/`obsoletePaths` 的 DB 清理发生在新快照发布之前，但仅当 `packageManager` binder 仍存活时执行，避免在系统服务重启窗口内误删数据。`ensureCacheReady` 用 double-checked locking 保证只构建一次初始快照。

## 相关

- [DaemonState · 状态容器与 schema](./daemon-state)
- [ModuleDatabase · 模块写操作](./module-service)
- [PreferenceStore · 偏好差分](./preference-store)
- [InjectedModuleService · 推模式服务](./module-service)
- daemon 数据层见 [modules · daemon](../../modules/daemon)
