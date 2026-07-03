# daemon · system 包

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/system/`
> 🛰️ 系统 binder 代理·通知 UI·跨版本兼容扩展

## 包职责

封装 Daemon 与 Android 系统服务的交互：`SystemBinders.kt` 提供线程安全、带死亡回收的 binder 代理委托；`SystemExtensions.kt` 提供跨 Android 版本兼容的 IPackageManager/IActivityManager/IUserManager 扩展函数与常量；`NotificationManager.kt` 负责状态/模块更新/作用域请求三类通知 UI。

## 类清单

| 类/文件 | 说明 |
| :--- | :--- |
| [`SystemService`](#systemservice) | 线程安全、带死亡回收的系统服务 binder 代理委托 |
| [`SystemContext`](#systemcontext) | 持有 system_server 注入阶段的全局上下文 |
| [`SystemBinders.kt`](#systembinderskt) | 顶层系统 binder 属性（activityManager 等）与 getServiceManager |
| [`SystemExtensions.kt`](#systemextensionskt) | 跨版本兼容扩展函数与常量 |
| [`NotificationManager`](#notificationmanager) | 三类系统通知的构建与发送 |

---

## SystemService

`class SystemService<T>(private val name: String, private val asInterface: (IBinder) -> T) : ReadOnlyProperty<Any?, T?>` — 一个**线程安全、懒加载、带死亡回收**的系统服务 binder 代理，作为 Kotlin 属性委托使用。

### 机制

```kotlin
@Volatile private var instance: T? = null
private val deathRecipient = IBinder.DeathRecipient { instance = null }

override fun getValue(thisRef: Any?, property: KProperty<*>): T?
```

`getValue` 双重检查锁：若 `instance` 为空，`ServiceManager.getService(name)` 获取 binder，`linkToDeath` 注册回收，`asInterface` 包装后缓存。服务死亡时 `DeathRecipient` 把 `instance` 置空，下次访问重新获取。`RemoteException` 时返回 `null`。

---

## SystemContext

`object SystemContext` — 持有从 system_server **后注入阶段**收到的全局状态，供后续伪造 `IActivityManager` 调用（这些调用需要合法的调用者上下文）。

```kotlin
object SystemContext {
    @Volatile var appThread: IApplicationThread? = null
    @Volatile var token: IBinder? = null
}
```

由 `VectorService.dispatchSystemServerContext(appThread, activityToken)` 在 system_server 回调时填充。`registerReceiverCompat` / `broadcastIntentCompat` / `applyXspaceWorkaround` 等扩展函数均依赖这两个字段。

---

## SystemBinders.kt

顶层系统 binder 属性，均以 `SystemService` 委托实现：

```kotlin
val activityManager: IActivityManager? by SystemService(Context.ACTIVITY_SERVICE, IActivityManager.Stub::asInterface)
val packageManager: IPackageManager?  by SystemService("package", IPackageManager.Stub::asInterface)
val userManager: IUserManager?        by SystemService(Context.USER_SERVICE, IUserManager.Stub::asInterface)
val powerManager: IPowerManager?      by SystemService(Context.POWER_SERVICE, IPowerManager.Stub::asInterface)
```

`fun getSystemServiceManager(): IServiceManager` — 经 `HiddenApiBridge.Binder_allowBlocking(BinderInternal.getContextObject())` 获取 IServiceManager，用于 `registerForNotifications` 等。

---

## SystemExtensions.kt

跨 Android 版本兼容的扩展函数与常量。`private const val TAG = "VectorSystem"`。

### 常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `PER_USER_RANGE` | `100000` | 用户 uid 范围（appId = uid % PER_USER_RANGE） |
| `MATCH_ANY_USER` | `0x00400000` | `PackageManager.MATCH_ANY_USER` |
| `MATCH_ALL_FLAGS` | `DISABLED_COMPONENTS \| DIRECT_BOOT_AWARE \| DIRECT_BOOT_UNAWARE \| UNINSTALLED_PACKAGES \| MATCH_ANY_USER` | 缓存模块时的全量查询 flags |

### PackageInfo 查询

```kotlin
// Tiramisu+ 用 Long flags，以下用 Int flags
fun IPackageManager.getPackageInfoCompat(packageName, flags, userId): PackageInfo?

// 含组件的完整查询；binder 缓冲溢出时降级为分组件逐个查询
fun IPackageManager.getPackageInfoWithComponents(packageName, flags, userId): PackageInfo?

// 提取包所有唯一进程名（activities/receivers/providers/services），跳过 isolated process
fun PackageInfo.fetchProcesses(): Set<String>

// 跨用户枚举已安装包；filterNoProcess=true 时再过滤出有进程的包
fun IPackageManager.getInstalledPackagesFromAllUsers(flags, filterNoProcess): List<PackageInfo>

// Intent 查询兼容（Tiramisu+ 用 Long flags）
fun IPackageManager.queryIntentActivitiesCompat(intent, resolvedType, flags, userId): List<ResolveInfo>
```

`getPackageInfoWithComponents` 的降级策略：先尝试 `flags | GET_ACTIVITIES|SERVICES|RECEIVERS|PROVIDERS` 全量查询，若抛异常（binder 缓冲溢出）则分别按单 flag 逐组件查询再拼装；并校验 `sourceDir` 存在且 `isPackageAvailable`（含 hidden 应用兜底）。

`getInstalledPackagesFromAllUsers` 跨用户枚举，反射选择 `getInstalledPackages` 的 `Long`/`Int` 重载，用 `parallelStream` 过滤 uid 所属用户与可用性。

`isPackageAvailable(packageName, userId, ignoreHidden)` — 真正可用，或 `ignoreHidden` 时即便被 profile owner 隐藏也视为可用。

### Intent / 广播兼容

```kotlin
// S+: registerReceiverWithFeature(appThread, "android", null, "null", receiver, ...)
// R : registerReceiverWithFeature(appThread, "android", null, receiver, ...)
// 以下: registerReceiver(appThread, "android", receiver, ...)
fun IActivityManager.registerReceiverCompat(receiver, filter, requiredPermission, userId, flags): Intent?

fun IActivityManager.broadcastIntentCompat(intent)   // 同样按 S+/R/更早分支
fun IUserManager.getUserName(userId): String          // 失败回退为 userId 字符串
```

---

## NotificationManager

`object NotificationManager` — Daemon 的系统通知管理。直接经 `INotificationManager`（通过 `SystemService` 委托获取）以 `opPkg = "android"`（Q+）或 `"com.android.settings"` 发送，绕过普通应用通知权限。

### 通道与 Action

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `STATUS_CHANNEL_ID` | `"vector_status"` | 框架运行状态（IMPORTANCE_MIN） |
| `UPDATED_CHANNEL_ID` | `"vector_module_updated"` | 模块更新（IMPORTANCE_HIGH） |
| `SCOPE_CHANNEL_ID` | `"vector_module_scope"` | 作用域请求（IMPORTANCE_HIGH，public） |
| `STATUS_NOTIF_ID` | `BuildConfig.MANAGER_INJECTED_UID` | 状态通知 ID |

`openManagerAction` 与 `moduleScopeAction` 是每次启动随机生成的 UUID 字符串，作为广播 action，防止被外部应用伪造触发。

### 通道创建

`private fun createChannels()` — 用 `FakeContext` 取字符串资源，构造三个 `NotificationChannel`（均 `setShowBadge(false)`），经 `createNotificationChannelsForPackage("android", 1000, ParceledListSlice(list))` 注册。

### 图标

`getNotificationIcon()` → `Icon.createWithBitmap(getBitmap(R.drawable.ic_notification))`。`getBitmap` 支持 `BitmapDrawable` 直接取与 `AdaptiveIconDrawable` 经 `LayerDrawable` 合成后 `Canvas` 绘制两种路径。

### 状态通知

```kotlin
fun notifyStatusNotification()   // 常驻通知，PendingIntent 触发 openManagerAction
fun cancelStatusNotification()   // R+ 用五参 cancelNotificationWithTag
```

通知 `extras` 写入 `android.substName = BuildConfig.FRAMEWORK_NAME`，`setVisibility(VISIBILITY_SECRET)`，`setOngoing(true)`。

### 模块更新通知

```kotlin
fun notifyModuleUpdated(modulePackageName, moduleUserId, enabled: Boolean, systemModule: Boolean)
```

按 `enabled` × `systemModule` 选择不同标题/正文字符串（含 system 模块专用文案）；未启用时区分主用户/多用户文案。通知 ID = `modulePackageName.hashCode()`，点击触发 `openManagerAction` + `module:` URI。

### 作用域请求通知

```kotlin
fun requestModuleScope(modulePkg, moduleUserId, scopePkg, callback: IXposedScopeCallback)
```

三个 action 按钮：`approve`（requestCode 4）/ `deny`（5）/ `block`（6）。Intent data 用 `module:` scheme + `modulePkg:moduleUserId` authority + `scopePkg` path + `action` query，并把 `callback.asBinder()` 放进 `Bundle("callback")` 随广播传递。通知 ID 同样为 `modulePkg.hashCode()`，`setAutoCancel(true)`，`BigTextStyle`。

```kotlin
fun cancelNotification(channel: String, modulePkg: String, moduleUserId: Int)
```

按 `modulePkg.hashCode()` 取消对应通知，R+ 用五参重载。

## 相关

- [daemon 模块总览](../modules/daemon)
- [daemon · utils 包](./daemon-utils)（FakeContext、Workarounds 中的设备兼容）
- [daemon · ipc · ManagerService](./daemon-ipc#managerservice)（调用本包通知 API）
- [daemon · entry · VectorService](./daemon-entry#vectorservice)（接收广播并触发通知）
