# 📞 HiddenApiBridge · 方法调用桥

> 📂 `hiddenapi/bridge/src/main/java/hidden/HiddenApiBridge.java`
> 🟦 hiddenapi · bridge · 包：`hidden`
> 🏗️ 编译期依赖 stubs（`compileOnly`），运行时由真实 Android 框架类遮蔽桩

## 本篇范围

本篇梳理 `HiddenApiBridge` 中**转发 hidden 方法调用**的桥方法——即那些把对一个 hidden 实例/静态方法的调用收口为静态桥的工具方法。bridge 的命名约定为 `类_方法`，方法体通常只有一行转发。

## 类职责

`public class HiddenApiBridge` 是一组**纯静态转发方法**的聚合器。每个方法对应一个 Android hidden API（SDK 未导出但运行时存在的方法/字段/常量），把对它的访问集中到一个可被编译器解析的入口。模块代码调用 `HiddenApiBridge.Xxx_yyy(...)`，而非直接 `Xxx.yyy(...)`——后者因 stubs 的包级/`@hide` 限制无法在普通源码中引用。

## 方法调用类桥（真实存在）

```java
// 资源管理
public static int AssetManager_addAssetPath(AssetManager am, String path) {
    return am.addAssetPath(path);                          // hidden 实例方法
}

public static void Resources_setImpl(Resources resources, ResourcesImpl impl) {
    resources.setImpl(impl);                               // hidden 实例方法
}

public static CompatibilityInfo Resources_getCompatibilityInfo(Resources res) {
    return res.getCompatibilityInfo();                     // hidden 实例方法
}

// Binder
public static IBinder Binder_allowBlocking(IBinder binder) {
    return Binder.allowBlocking(binder);                   // hidden 静态方法
}

// Context / 环境
public static IBinder Context_getActivityToken(Context ctx) {
    return ctx.getActivityToken();                         // hidden 实例方法
}

public static Intent Context_registerReceiverAsUser(Context ctx, BroadcastReceiver receiver,
        UserHandle user, IntentFilter filter, String broadcastPermission, Handler scheduler) {
    return ctx.registerReceiverAsUser(receiver, user, filter, broadcastPermission, scheduler);  // hidden 实例方法
}

public static File Environment_getDataProfilesDePackageDirectory(int userId, String packageName) {
    return Environment.getDataProfilesDePackageDirectory(userId, packageName);  // hidden 静态方法
}

// Os（ioctl，跨版本分支）
public static int Os_ioctlInt(FileDescriptor fd, int cmd, int arg) throws ErrnoException;
```

## 调用语义分类

| 桥方法 | 目标方法类型 | 返回 | 版本约束 |
| :--- | :--- | :--- | :--- |
| `AssetManager_addAssetPath` | 实例 | `int`（新增 path 的 cookie） | 无 |
| `Resources_setImpl` | 实例 | `void` | 无 |
| `Resources_getCompatibilityInfo` | 实例 | `CompatibilityInfo` | 无 |
| `Binder_allowBlocking` | 静态 | `IBinder` | 无 |
| `Context_getActivityToken` | 实例 | `IBinder` | 无 |
| `Context_registerReceiverAsUser` | 实例 | `Intent`（sticky 首个） | 无 |
| `Environment_getDataProfilesDePackageDirectory` | 静态 | `File` | 无 |
| `Os_ioctlInt` | 静态 | `int` | 8.1/9-11/12+ 分支 |

## Os_ioctlInt 的版本分支

这是 bridge 中唯一带运行时版本判断的方法调用桥，是 hidden API 跨版本兼容的典型样例：

```java
public static int Os_ioctlInt(FileDescriptor fd, int cmd, int arg) throws ErrnoException {
    if (Build.VERSION.SDK_INT == Build.VERSION_CODES.O_MR1) {
        return Os.ioctlInt(fd, cmd, new MutableInt(arg));      // 8.1：参数是 MutableInt
    } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return Os.ioctlInt(fd, cmd, new Int32Ref(arg));        // 9~11：参数是 Int32Ref
    } else {
        return Os.ioctlInt(fd, cmd);                           // 12+：签名简化为裸 int
    }
}
```

`Os.ioctlInt` 的第三参数类型在 Android 8.1 是 `MutableInt`、9~11 是 `Int32Ref`、12+ 直接是 `int`。stubs 子模块为三个重载都提供了桩（见 `android/system/Os.java` stub，分别标 `@RequiresApi(27)`/`@RequiresApi(31)`）。bridge 据 `Build.VERSION.SDK_INT` 选择正确重载转发，避免在错误版本调用不存在的签名。

## 关于 invoke / invokeAs 统一入口

> ⚠️ 任务描述提及的 `HiddenApiBridge` 的 `invoke` / `invokeAs` 各重载（"反射调用 hidden API 的统一入口"）**未在当前源码中直接找到**。`hiddenapi/bridge/src/main/java/hidden/HiddenApiBridge.java`（151 行）中不存在泛化的 `invoke*` 反射入口——每个桥方法都是**针对具体 hidden 方法的具名转发**（如 `AssetManager_addAssetPath`），而非通用反射调度器。若需要"按 `Method` 对象通用调用 hidden API"的能力，当前实现未提供；通用反射调用仍需直接使用 `java.lang.reflect.Method.invoke` 配合 `XposedHelpers.callMethod`。本篇据此只记录真实存在的具名方法调用桥。

## 转发流程

```mermaid
flowchart TD
    A["模块代码<br/>HiddenApiBridge.Os_ioctlInt(fd,cmd,arg)"] --> B{"SDK_INT"}
    B -->|"== O_MR1 (8.1)"| C["Os.ioctlInt(fd,cmd,MutableInt)"]
    B -->|"< S (9~11)"| D["Os.ioctlInt(fd,cmd,Int32Ref)"]
    B -->|">= S (12+)"| E["Os.ioctlInt(fd,cmd)"]
    C --> F["运行时真实 android.system.Os"]
    D --> F
    E --> F
    F --> G["ioctl 系统调用结果"]

    H["编译期"] --> I["bridge 依赖 stubs<br/>(compileOnly)"]
    I --> J["stubs: Os.ioctlInt 桩<br/>throw ErrnoException"]
    H --> K["运行期"]
    K --> F

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,E,F class vec
    class J class hot
    class A,G,H,I,K class plain
```

## 相关

- [bridge-methods-field · 字段访问桥](./bridge-methods-field)
- [bridge-methods-new-instance · 对象构造桥](./bridge-methods-new-instance)
- [bridge-stubs-bridge · 桩与桥协作](./bridge-stubs-bridge)
- [bridge 子模块总览](../../hiddenapi/bridge)
- [stubs 总览](../../hiddenapi/stubs)
