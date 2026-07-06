# 🔌 ModuleService · InjectedModuleService

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/ModuleService.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/ModuleService.kt)
> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/InjectedModuleService.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/ipc/InjectedModuleService.kt)
> 🟦 daemon 模块 · libxposed 模块推模式与偏好回调

## 类职责

这两个类服务的是 **libxposed 推模式模块**（即新版 API 的模块）：

- `ModuleService(private val loadedModule: Module)`：实现 `IXposedService.Stub()`，每个已加载模块一个实例，绑定到模块自身的 `service` 字段，由 daemon 主动把 binder 推给模块进程；
- `InjectedModuleService(private val packageName: String)`：实现 `ILSPInjectedModuleService.Stub()`，作为模块偏好的**回调注册中心**，跟踪每个 group 的 `IRemotePreferenceCallback` 并在差分写入时推送。

`ConfigCache` 在构建 `Module` 时为未持有 service 的模块创建 `InjectedModuleService(pkgName)`，作为 `module.service`。

## ModuleService · 推模式投递

```kotlin
companion object {
    private val uidSet = ConcurrentHashMap.newKeySet<Int>()
    private val serviceMap = Collections.synchronizedMap(WeakHashMap<Module, ModuleService>())
    fun uidClear()
    fun uidStarts(uid: Int)
    fun uidGone(uid: Int)
}
```

`uidStarts` 由 `VectorService` 的 `IUidObserver` 回调驱动：首次见到某 uid 时，查 `ConfigCache.getModuleByUid`，若为非 legacy 模块，从 `serviceMap` 取或新建 `ModuleService(module)`，调 `sendBinder(uid)`。

```kotlin
private fun sendBinder(uid: Int)
```

**ContentProvider 陷阱投递**：构造 `authority = packageName + AUTHORITY_SUFFIX`，`getContentProviderExternal` 取 provider，按 SDK 版本分支调 `provider.call(...)`，extras 带 `"binder"` 键的模块 service binder。这样模块进程无需 `bindService` 即可收到 IPC 端点。

## ModuleService · 权限校验与 API

```kotlin
private fun ensureModule(): Int
```

`ensureModule` 校验 `Binder.getCallingUid() % PER_USER_RANGE == loadedModule.appId`，不匹配抛 `RemoteException`，通过后返回 `userId`。

```kotlin
override fun getApiVersion() = ensureModule().let { IXposedService.LIB_API }
override fun getFrameworkName() = ensureModule().let { BuildConfig.FRAMEWORK_NAME }
override fun getFrameworkVersion() = ensureModule().let { BuildConfig.VERSION_NAME }
override fun getFrameworkVersionCode() = ensureModule().let { BuildConfig.VERSION_CODE }
override fun getFrameworkProperties(): Long   // PROP_CAP_SYSTEM|PROP_CAP_REMOTE，混淆开启追加 PROP_RT_API_PROTECTION
override fun getScope(): List<String>
override fun requestScope(packages: List<String>, callback: IXposedScopeCallback)
override fun removeScope(packages: List<String>)
override fun requestRemotePreferences(group: String): Bundle
override fun updateRemotePreferences(group: String, diff: Bundle)
override fun deleteRemotePreferences(group: String)
override fun listRemoteFiles(): Array<String>
override fun openRemoteFile(path: String): ParcelFileDescriptor
override fun deleteRemoteFile(path: String): Boolean
```

`requestScope` 在未被 `scope_request_blocked` 时逐包 `NotificationManager.requestModuleScope`，否则直接 `onScopeRequestFailed`。`updateRemotePreferences` 解析 `diff` 里的 `delete`(`Set`) 与 `put`(`Map`) 合并为 `values: Map<String, Any?>`，写 `PreferenceStore` 后调 `(loadedModule.service as? InjectedModuleService)?.onUpdateRemotePreferences(group, diff)` 触发回调推送。文件操作经 `FileSystem.ensureModuleFilePath` 防穿越，目录由 `resolveModuleDir(pkg, "files", userId, callingUid)` 解析。

## InjectedModuleService · 回调注册中心

```kotlin
class InjectedModuleService(private val packageName: String) : ILSPInjectedModuleService.Stub() {
    private val callbacks = ConcurrentHashMap<String, MutableSet<IRemotePreferenceCallback>>()
    override fun getFrameworkProperties(): Long
    override fun requestRemotePreferences(group: String, callback: IRemotePreferenceCallback?): Bundle
    override fun openRemoteFile(path: String): ParcelFileDescriptor
    override fun getRemoteFileList(): Array<String>
    fun onUpdateRemotePreferences(group: String, diff: Bundle)
}
```

`requestRemotePreferences` 返回当前快照 `Bundle(putSerializable "map")`，并把 `callback` 加入该 group 的回调集，`linkToDeath` 自动移除。`onUpdateRemotePreferences` 由 `ModuleService.updateRemotePreferences` 调用，遍历该 group 的所有 callback `onUpdate(diff)`，失败则移除失效回调。

## 推模式与回调流转

```mermaid
flowchart TD
    A["system IUidObserver"] --> B["VectorService"]
    B --> C["ModuleService.uidStarts(uid)"]
    C --> D["sendBinder via ContentProvider"]
    D --> E["模块进程收到 binder"]
    E --> F["IXposedService 调用"]
    F --> G{"动作"}
    G -->|requestRemotePreferences| H["InjectedModuleService<br/>注册 callback"]
    G -->|updateRemotePreferences| I["PreferenceStore 差分写"]
    I --> J["onUpdateRemotePreferences"]
    J --> K["遍历 callback.onUpdate(diff)"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,D,H,I,J,K class vec
    class G class hot
    class A,B,E,F class plain
```

## 相关

- [PreferenceStore · 偏好差分](./preference-store)
- [ConfigCache · Module.service 创建](./config-cache)
- [ManagerService · 模块写操作](./manager-service)
- libxposed API 见 [xposed · services](../xposed-hookers)
