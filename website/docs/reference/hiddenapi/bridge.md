# 🌉 bridge 子模块

运行时桥接层：把编译期桩方法调用转发到真实的 Android hidden API。两个类，职责清晰。

> 📂 [`hiddenapi/bridge/src/main/java/hidden/`](https://github.com/android-security-engineer/Vector-skills/blob/master/hiddenapi/bridge/src/main/java/hidden/)
> 🏛️ hiddenapi · bridge · 包：`hidden`

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`HiddenApiBridge`](#hiddenapibridge) | 桥接总入口：静态方法转发到真实 hidden API |
| [`ByteBufferDexClassLoader`](#bytebufferdexclassloader) | 直接从 `ByteBuffer` 加载 DEX 的隐藏类加载器 |

---

## HiddenApiBridge

`public class HiddenApiBridge` — 一组**静态方法**，每个方法对应一个 hidden API 调用。方法名采用 `类_方法` 命名约定（如 `AssetManager_addAssetPath`），把对隐藏方法/字段的访问集中收口。

### 方法签名

```java
// 资源
public static int AssetManager_addAssetPath(AssetManager am, String path)
public static void Resources_setImpl(Resources resources, ResourcesImpl impl)
public static CompatibilityInfo Resources_getCompatibilityInfo(Resources res)

// Binder
public static IBinder Binder_allowBlocking(IBinder binder)

// Context / 环境
public static IBinder Context_getActivityToken(Context ctx)
public static Intent Context_registerReceiverAsUser(Context ctx, BroadcastReceiver receiver,
        UserHandle user, IntentFilter filter, String broadcastPermission, Handler scheduler)
public static File Environment_getDataProfilesDePackageDirectory(int userId, String packageName)

// UserHandle
public static UserHandle UserHandle_ALL()
public static UserHandle UserHandle(int h)

// ApplicationInfo 字段访问
public static String ApplicationInfo_credentialProtectedDataDir(ApplicationInfo applicationInfo)
public static void ApplicationInfo_credentialProtectedDataDir(ApplicationInfo applicationInfo, String dir)
public static String[] ApplicationInfo_resourceDirs(ApplicationInfo applicationInfo)
public static void ApplicationInfo_resourceDirs(ApplicationInfo applicationInfo, String[] resourceDirs)
@RequiresApi(31) public static String[] ApplicationInfo_overlayPaths(ApplicationInfo applicationInfo)
@RequiresApi(31) public static void ApplicationInfo_overlayPaths(ApplicationInfo applicationInfo, String[] overlayPaths)

// PackageInstaller
public static int PackageInstaller_SessionParams_installFlags(PackageInstaller.SessionParams params)
public static void PackageInstaller_SessionParams_installFlags(PackageInstaller.SessionParams params, int flags)

// Os（ioctl，多版本分支）
public static int Os_ioctlInt(FileDescriptor fd, int cmd, int arg) throws ErrnoException

// ActivityManager 常量
public static int ActivityManager_UID_OBSERVER_GONE()
public static int ActivityManager_UID_OBSERVER_ACTIVE()
public static int ActivityManager_UID_OBSERVER_IDLE()
public static int ActivityManager_UID_OBSERVER_CACHED()
public static int ActivityManager_PROCESS_STATE_UNKNOWN()
```

### 关键设计

#### 字段访问的 getter/setter 对

`ApplicationInfo` 的 `credentialProtectedDataDir`、`resourceDirs`、`overlayPaths` 字段是包级可见的 hidden 字段。bridge 为每个字段提供同名的**重载 getter/setter**——读时返回字段值，写时赋值。`overlayPaths` 标 `@RequiresApi(31)`，Android 12+ 才存在。

#### Os_ioctlInt 的版本分支

```java
if (Build.VERSION.SDK_INT == Build.VERSION_CODES.O_MR1) {
    return Os.ioctlInt(fd, cmd, new MutableInt(arg));      // 8.1
} else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
    return Os.ioctlInt(fd, cmd, new Int32Ref(arg));        // 9~11
} else {
    return Os.ioctlInt(fd, cmd);                           // 12+（签名简化）
}
```

`ioctlInt` 的参数类型在不同版本是 `MutableInt`、`Int32Ref`、或裸 `int`，bridge 据版本选择正确重载——这是 hidden API 跨版本兼容的典型样例。

#### 常量访问方法

`ActivityManager_UID_OBSERVER_*`、`PROCESS_STATE_UNKNOWN` 把 hidden 常量包装成方法返回，避免调用方直接引用未导出的常量。

---

## ByteBufferDexClassLoader

`public class ByteBufferDexClassLoader extends BaseDexClassLoader` — 直接从内存中的 `ByteBuffer` 加载 DEX，无需落盘。

### 构造与方法

```java
public ByteBufferDexClassLoader(ByteBuffer[] dexFiles, ClassLoader parent)

public ByteBufferDexClassLoader(ByteBuffer[] dexFiles, String librarySearchPath, ClassLoader parent)

public String getLdLibraryPath()
```

### 说明

继承 hidden 的 `BaseDexClassLoader`（其构造接受 `ByteBuffer[]`，是 SDK 未暴露的重载）。Vector 用它把 Daemon 预加载到 `SharedMemory` 的 DEX 直接从内存装载，避免临时文件与解密开销。`getLdLibraryPath` 透传父类方法，用于查询 native 库搜索路径。

## 相关

- [stubs 总览](./stubs) — 编译期桩
- [hiddenapi 模块总览](../modules/hiddenapi)
