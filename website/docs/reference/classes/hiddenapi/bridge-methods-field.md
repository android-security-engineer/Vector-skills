# 🔑 HiddenApiBridge · 字段访问桥

> 📂 [`hiddenapi/bridge/src/main/java/hidden/HiddenApiBridge.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/hiddenapi/bridge/src/main/java/hidden/HiddenApiBridge.java)
> 📂 [`hiddenapi/stubs/src/main/java/android/content/pm/ApplicationInfo.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/hiddenapi/stubs/src/main/java/android/content/pm/ApplicationInfo.java)（桩）
> 🟦 hiddenapi · bridge · 包：`hidden`

## 本篇范围

本篇梳理 `HiddenApiBridge` 中**访问 hidden 字段**的桥方法。Android 的 `ApplicationInfo`、`PackageInstaller.SessionParams` 等类包含包级可见或 `@hide` 的字段，SDK 无法直接引用。bridge 为每个字段提供 getter（读）/ setter（写）甚至重载对，把字段访问收口为静态方法调用。

## ApplicationInfo 字段访问

`ApplicationInfo` 有三个 hidden 字段，bridge 为每个提供**同名重载 getter/setter 对**——读时返回字段值，写时赋值。`overlayPaths` 因 Android 12+ 才存在，标 `@RequiresApi(31)`。

```java
// credentialProtectedDataDir：包级可见 hidden 字段
public static String ApplicationInfo_credentialProtectedDataDir(ApplicationInfo applicationInfo) {
    return applicationInfo.credentialProtectedDataDir;
}
public static void ApplicationInfo_credentialProtectedDataDir(ApplicationInfo applicationInfo, String dir) {
    applicationInfo.credentialProtectedDataDir = dir;
}

// resourceDirs
public static String[] ApplicationInfo_resourceDirs(ApplicationInfo applicationInfo) {
    return applicationInfo.resourceDirs;
}
public static void ApplicationInfo_resourceDirs(ApplicationInfo applicationInfo, String[] resourceDirs) {
    applicationInfo.resourceDirs = resourceDirs;
}

// overlayPaths（@RequiresApi(31)）
@RequiresApi(31)
public static String[] ApplicationInfo_overlayPaths(ApplicationInfo applicationInfo) {
    return applicationInfo.overlayPaths;
}
@RequiresApi(31)
public static void ApplicationInfo_overlayPaths(ApplicationInfo applicationInfo, String[] overlayPaths) {
    applicationInfo.overlayPaths = overlayPaths;
}
```

对应的 stub（`ApplicationInfo.java`）只声明字段、不赋初值，纯编译期占位：

```java
public class ApplicationInfo {
    public String credentialProtectedDataDir;
    public String[] resourceDirs;
    @RequiresApi(31) public String[] overlayPaths;
}
```

## PackageInstaller.SessionParams 字段

`installFlags` 是 `SessionParams` 的 hidden `int` 字段，同样提供 getter/setter 对：

```java
public static int PackageInstaller_SessionParams_installFlags(PackageInstaller.SessionParams params) {
    return params.installFlags;
}
public static void PackageInstaller_SessionParams_installFlags(PackageInstaller.SessionParams params, int flags) {
    params.installFlags = flags;
}
```

## UserHandle 字段/构造访问

```java
public static UserHandle UserHandle_ALL() {
    return UserHandle.ALL;                                  // hidden 静态常量字段
}
public static UserHandle UserHandle(int h) {
    return new UserHandle(h);                               // hidden 构造器（详见 new-instance 篇）
}
```

`UserHandle_ALL` 把 hidden 静态常量 `UserHandle.ALL` 包装成方法返回，避免调用方直接引用未导出的常量字段。`UserHandle(int)` 则是构造器桥（归入 [new-instance 篇](./bridge-methods-new-instance) 讨论）。

## 字段访问桥总览

| 桥方法 | 目标字段 | 字段类型 | 读写 | 版本约束 |
| :--- | :--- | :--- | :--- | :--- |
| `ApplicationInfo_credentialProtectedDataDir` | `credentialProtectedDataDir` | `String` | 读+写 | 无 |
| `ApplicationInfo_resourceDirs` | `resourceDirs` | `String[]` | 读+写 | 无 |
| `ApplicationInfo_overlayPaths` | `overlayPaths` | `String[]` | 读+写 | `@RequiresApi(31)` |
| `PackageInstaller_SessionParams_installFlags` | `installFlags` | `int` | 读+写 | 无 |
| `UserHandle_ALL` | `ALL`（静态常量） | `UserHandle` | 读 | 无 |

## 设计要点

### getter/setter 同名重载

字段访问桥用**方法名相同、参数不同**的重载区分读写：getter 形如 `Xxx_fieldName(obj)`（一个参数，返回值），setter 形如 `Xxx_fieldName(obj, value)`（两个参数，void）。这比 `getXxx`/`setXxx` 更贴近"字段即属性"的语义，且调用方一眼能看出操作的 hidden 字段名。

### 字段直接访问，非反射

bridge 的字段访问是**直接字段读写**（`applicationInfo.credentialProtectedDataDir`），不走 `Field.get`/`Field.set`。这要求编译期 stubs 必须声明同名字段（`compileOnly` 依赖保证编译通过）；运行时桩字段被真实 `ApplicationInfo` 的字段遮蔽，直接访问命中真实值。相比反射，少了 `setAccessible` 与拆箱开销。

### @RequiresApi 守卫

`overlayPaths` 在 stubs 与 bridge 两端都标 `@RequiresApi(31)`。stubs 端的 `@RequiresApi` 来自 `androidx.annotation`（桥模块依赖 androidx annotation），运行时 Android 12 以下设备若误调用会因字段不存在而抛 `NoSuchFieldError`——调用方需自行做版本判断。

## 关于 getField / putField / setStaticObjectField 通用入口

> ⚠️ 任务描述提及的 `HiddenApiBridge.getField` / `putField` / `setStaticObjectField` 等**通用字段访问桥**未在当前源码中直接找到。`HiddenApiBridge.java` 中不存在泛化的 `getXxxField(obj, name)` 反射式入口——每个字段访问桥都是**针对具体 hidden 字段的具名方法**（如 `ApplicationInfo_credentialProtectedDataDir`）。通用字段反射访问仍由 `XposedHelpers.getObjectField`/`setObjectField`/`getStaticObjectField`/`setStaticObjectField` 承担（见 legacy 模块）。本篇只记录真实存在的具名字段桥。

## 字段访问流程

```mermaid
flowchart TD
    A["模块调用<br/>ApplicationInfo_overlayPaths(info)"] --> B{"SDK_INT >= 31?"}
    B -->|是| C["info.overlayPaths<br/>直接字段读"]
    B -->|否| D["抛 NoSuchFieldError<br/>(字段不存在)"]
    C --> E["运行时真实 ApplicationInfo<br/>返回 String[]"]

    F["编译期"] --> G["bridge 依赖 stubs"]
    G --> H["stubs: ApplicationInfo<br/>声明 overlayPaths 字段"]
    F --> I["运行期"]
    I --> C

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,E class vec
    class D class hot
    class A,F,G,H,I class plain
```

## 相关

- [bridge-methods-invoke · 方法调用桥](./bridge-methods-invoke)
- [bridge-methods-new-instance · 对象构造桥](./bridge-methods-new-instance)
- [bridge-stubs-bridge · 桩与桥协作](./bridge-stubs-bridge)
- [bridge 子模块总览](../../hiddenapi/bridge)
- [XposedHelpers · 字段工具](../legacy/xposed-helpers-extra)
