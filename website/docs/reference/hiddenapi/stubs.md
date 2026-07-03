# 🧱 stubs 子模块

编译期桩：约 100 个空壳 Java 类，镜像 Android 内部类的方法/字段签名，让 Vector 框架代码能编译通过。运行期这些类被 ART 的真实实现替换。

> 📂 `hiddenapi/stubs/src/main/java/`
> 🏛️ hiddenapi · stubs

## 工作方式

桩类只声明签名（方法空实现、字段占位），编译期满足引用，运行期 JVM/ART 加载系统真实类。每个桩对应一个 AOSP 内部类，按原始包名组织。

## 按包总览

### android.app — 应用进程内部

| 关键桩类 | 用途 |
| :--- | :--- |
| `ActivityThread` | 应用主线程入口，进程上下文与 `Application` 装配 |
| `LoadedApk` | 已加载 APK 的运行时表示，类加载器与资源归属 |
| `ContextImpl` | `Context` 的实现，bridge 调 `getActivityToken` |
| `IActivityManager` · `IApplicationThread` | 与 AMS 的 Binder 接口 |
| `IActivityController` · `IUidObserver` · `INotificationManager` | 系统 watchdog/UID/通知回调 |
| `ResourcesManager` | 进程级资源管理单例 |
| `ContentProviderHolder` · `ProfilerInfo` · `Notification` · `NotificationChannel` · `Application` · `IServiceConnection` | 各类数据/接口桩 |

### android.content / android.content.pm — 内容与包管理

| 关键桩类 | 用途 |
| :--- | :--- |
| `Context` · `Intent` · `IntentFilter` · `ComponentName` · `IntentSender` · `BroadcastReceiver` | Content/Intent 体系 |
| `IContentProvider` · `IIntentReceiver` · `IIntentSender` | 内容/Intent Binder 接口 |
| `AttributionSource` | Android 11+ 权限归因 |
| `PackageManager` · `IPackageManager` · `PackageInfo` · `ApplicationInfo` | 包查询与管理 |
| `PackageInstaller` · `IPackageInstaller` · `VersionedPackage` | 包安装 |
| `ParceledListSlice` · `BaseParceledListSlice` | 跨进程大列表传递（`ILSPManagerService` 返回类型） |
| `PackageParser` · `ResolveInfo` · `UserInfo` | 解析/查询/用户 |

### android.content.res — 资源

| 关键桩类 | 用途 |
| :--- | :--- |
| `ResourcesImpl` · `Resources` · `AssetManager` | 资源实现（bridge 的 `setImpl`/`addAssetPath` 目标） |
| `CompatibilityInfo` · `Configuration` · `ResourcesKey` · `TypedArray` | 资源配置与类型化数组 |

### android.os — 系统

| 关键桩类 | 用途 |
| :--- | :--- |
| `ServiceManager` | `getService`/`addService` 获取系统 Binder |
| `Binder` · `IBinder` · `IInterface` · `Parcel` · `Parcelable` | Binder 基础设施 |
| `SystemProperties` · `SELinux` | 系统属性与 SELinux |
| `UserHandle` · `UserManager` · `IUserManager` | 多用户 |
| `IServiceManager` · `IPowerManager` · `IServiceCallback` | 系统/电源/回调接口 |
| `Build` · `Environment` · `Handler` · `Bundle` · `PersistableBundle` · `ResultReceiver` · `RemoteException` · `ShellCallback` · `ShellCommand` | 各类系统桩 |

### android.system / android.ddm / android.util — 运行时与工具

| 桩类 | 用途 |
| :--- | :--- |
| `Os` · `ErrnoException` · `Int32Ref` | POSIX 包装（bridge 的 `ioctlInt`） |
| `DdmHandleAppName` | DDMS 进程名设置 |
| `DisplayMetrics` · `MutableInt` · `TypedValue` | 度量与值容器（`MutableInt` 见 bridge 版本分支） |

### android.permission / android.view / android.graphics / android.webkit

| 桩类 | 用途 |
| :--- | :--- |
| `IPermissionManager` | 权限管理 Binder |
| `IWindowManager` | 窗口管理 Binder |
| `Drawable` · `Movie` | 图形桩 |
| `WebViewDelegate` · `WebViewFactory` · `WebViewFactoryProvider` | WebView 内部（资源 Hook 需触及） |

### androidx.annotation / android.annotation — 注解

| 桩类 | 用途 |
| :--- | :--- |
| `IntRange` · `RequiresApi` | androidx 注解（bridge 用 `@RequiresApi(31)`） |
| `NonNull` · `Nullable` | 空安全注解 |

### com.android.internal.os — Zygote / Binder 内部

| 关键桩类 | 用途 |
| :--- | :--- |
| `ZygoteInit` | Zygote 启动入口，注入挂钩点 |
| `BinderInternal` | Binder 内部（限制器、对象计数） |

### com.android.server / com.android.server.am — 系统服务

| 关键桩类 | 用途 |
| :--- | :--- |
| `ActivityManagerService` · `ProcessRecord` | AMS 内部，进程记录 |
| `SystemService` · `SystemServiceManager` · `LocalServices` | 系统服务生命周期与本地注册表 |

### dalvik.system — 运行时

| 关键桩类 | 用途 |
| :--- | :--- |
| `BaseDexClassLoader` | `ByteBufferDexClassLoader` 的父类，hidden 的 ByteBuffer 构造 |
| `VMRuntime` | ART 运行时（GC、dexopt、指令集） |

### xposed.dummy — 资源 Hook 动态父类

| 关键桩类 | 用途 |
| :--- | :--- |
| `XResourcesSuperClass` | `XResources` 的动态父类桩，让资源替换可被系统识别 |
| `XTypedArraySuperClass` | `XTypedArray` 的动态父类桩 |

这两个桩是 Xposed 资源 Hook 的特殊设计——运行期框架动态生成子类，需要这些占位父类满足类型层级。

### 其他桩

| 包 · 桩类 | 用途 |
| :--- | :--- |
| `org.xmlpull.v1.XmlPullParserException` | XML 解析异常（资源解析） |
| `sun.misc.CompoundEnumeration` | 类加载器枚举合并（隐藏 native 库查找） |
| `sun.net.www.protocol.jar.Handler` | `jar:` URL 协议处理器 |

## 相关

- [bridge 子模块](./bridge) — 运行时桥接
- [hiddenapi 模块总览](../modules/hiddenapi)
- [legacy 模块](../modules/legacy) — 桩的主要消费方
