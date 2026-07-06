# 📦 android.content 桩

`android.content.*` 桩覆盖三大块：`content`（Context/Intent/广播）、`content.pm`（包管理与安装）、`content.res`（资源）。这些桩是 Vector 查询/安装应用、注入资源的基础。

> 📂 [`hiddenapi/stubs/src/main/java/android/content/`](https://github.com/android-security-engineer/Vector-skills/blob/master/hiddenapi/stubs/src/main/java/android/content/) · [`content/pm/`](https://github.com/android-security-engineer/Vector-skills/blob/master/content/pm/) · [`content/res/`](https://github.com/android-security-engineer/Vector-skills/blob/master/content/res/)
> 🏛️ hiddenapi · [stubs 总览](.) · [bridge](../bridge)

## android.content — 上下文与 Intent

| 桩类 | 作用 |
| :--- | :--- |
| `Context` | `Context` 基类，bridge 调 `getActivityToken`/`registerReceiverAsUser` |
| `AttributionSource` | Android 11+ 权限归因对象 |
| `Intent` · `IntentFilter` · `ComponentName` · `IntentSender` | Intent 体系 |
| `BroadcastReceiver` | 广播接收基类 |
| `IContentProvider` | ContentProvider 的 Binder 接口（多版本 `call`） |
| `IIntentReceiver` · `IIntentSender` | 广播/Intent 的 Binder 回调接口 |

`Context` 桩声明了 bridge 需要的隐藏方法：

```java
public class Context {
    public IBinder getActivityToken() { ... }
    public Intent registerReceiverAsUser(BroadcastReceiver, UserHandle,
                                         IntentFilter, String, Handler) { ... }
}
```

`IContentProvider.call` 有四个重载，对应 SDK 29/30/31 渐进的归因参数演进——`@RequiresApi` 标注让 bridge 按版本选重载。`AttributionSource` 在 API 31 重载中取代 `String callingPkg`。

## android.content.pm — 包管理

| 桩类 | 作用 |
| :--- | :--- |
| `PackageManager` | 包查询客户端封装（`getInstalledPackagesAsUser`） |
| `IPackageManager` | PMS 的 Binder 接口 |
| `PackageInfo` · `ApplicationInfo` | 包/应用信息数据类 |
| `PackageInstaller` · `IPackageInstaller` | 包安装会话 |
| `VersionedPackage` | 带版本号的包引用 |
| `PackageParser` · `PackageParser.PackageLite` | 离线解析 APK 包结构 |
| `ParceledListSlice` · `BaseParceledListSlice` | 跨进程大列表传递 |
| `ResolveInfo` · `UserInfo` | 解析结果/用户信息 |

`IPackageManager` 是 Vector 查包、判断隐藏、取 `ApplicationInfo` 的核心 Binder。`getApplicationInfo` 在 API 33 起把 `int flags` 扩成 `long flags`——桩用 `@RequiresApi(33)` 提供新签名。

`PackageParser` 桩保留了新旧两种 `parsePackageLite` 签名（SDK 21 前用 `String` 路径，之后用 `File`），bridge 据此做兼容。

`ParceledListSlice<T>` 继承 `BaseParceledListSlice<T>`，是 `ILSPManagerService` 等接口跨进程返回 `List<ModuleInfo>` 的标准容器——大列表会被自动拆成多个 Parcel 分批传递，避免单次 Binder 事务超限。

## android.content.res — 资源

| 桩类 | 作用 |
| :--- | :--- |
| `Resources` | 资源入口，`setImpl`/`getCompatibilityInfo` |
| `ResourcesImpl` | 资源实现，bridge `setImpl` 的目标 |
| `AssetManager` | 资产管理，`addAssetPath` 注入模块资源 |
| `CompatibilityInfo` | 资源兼容性信息 |
| `Configuration` · `ResourcesKey` | 资源配置与缓存键 |
| `TypedArray` | 类型化属性数组（`XTypedArraySuperClass` 的父类） |

`AssetManager.addAssetPath` 是资源注入的关键——Vector 把模块 APK 路径加入 `AssetManager`，使模块资源可被宿主进程加载。`Resources.setImpl` 让 bridge 能在运行时把一个 `ResourcesImpl` 替换/接管到现有 `Resources` 上（`XResources` 的底层机制）。

`Resources` 桩同时声明了新旧两种构造：

```java
public Resources(AssetManager, DisplayMetrics, Configuration) { ... }   // 旧
public Resources(ClassLoader) { ... }                                     // 新
```

后者被 `XResourcesSuperClass` 用作动态父类的构造路径。

## 资源注入链路

`AssetManager.addAssetPath` → `Resources.setImpl` → `ResourcesManager` 缓存构成了资源注入的完整链路：bridge 把模块 APK 路径加入 `AssetManager`，构造/替换 `ResourcesImpl`，再经 `ResourcesManager` 让进程内 `Resources` 实例引用新实现。`CompatibilityInfo` 控制资源在不同显示配置下的兼容性映射，`ResourcesKey` 是 `ResourcesManager` 缓存 `Resources` 实例的键（由路径、配置、兼容性信息组合）。

## 工作方式

```mermaid
graph LR
    Q["框架需查应用列表"]:::code
    Q --> SM["ServiceManager.getService(\"package\")"]:::os
    SM --> PM["asInterface → IPackageManager"]:::stub
    PM --> RT["getInstalledPackagesAsUser(flags, userId)"]:::real
    RT --> OUT["ParceledListSlice&lt;PackageInfo&gt;"]:::out
    classDef code fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef os fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef stub fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef real fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

桩保证 `IPackageManager`、`ParceledListSlice`、`PackageInfo` 等类型在编译期可见，运行期 ART 真实实现接管调用。

`TypedArray` 桩的 protected 构造 `TypedArray(Resources)` 是 `XTypedArraySuperClass` 动态父类的落点（见 [server/杂项桩](./stubs-android-server)）。`PackageInstaller.SessionParams.installFlags` 字段桩用于在桥接安装时设置安装标志。`ResolveInfo`、`UserInfo` 桩则是 `IPackageManager` 查询返回的数据载体。

## 相关

- [stubs 总览](.) — 全部桩按包总览
- [android.app 桩](./stubs-android-app) — ActivityThread/LoadedApk
- [android.os 桩](./stubs-android-os) — ServiceManager/Binder
- [hiddenapi 模块总览](../../modules/hiddenapi) — bridge 与 stubs 关系
