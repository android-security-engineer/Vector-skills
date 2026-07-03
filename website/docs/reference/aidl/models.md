# 📦 AIDL 数据模型

> 📂 `services/daemon-service/src/main/aidl/org/lsposed/lspd/models/`
> 📂 `services/manager-service/src/main/aidl/org/lsposed/lspd/models/`
> 🟦 parcelable · 跨进程序列化数据结构

## 概述

Vector 的 AIDL 接口在跨进程序列化时使用四个 `parcelable` 数据模型。它们是**纯数据载体**（AIDL 自动生成 Parcelable 实现），无方法逻辑，仅声明字段。`Module`/`PreLoadedApk` 属于 daemon-service（注入侧，Zygote↔Daemon 传递模块加载信息），`Application`/`UserInfo` 属于 manager-service（管理侧，管理器↔Daemon 传递作用域与用户信息）。

## 模型清单

| parcelable | 所属子模块 | 跨进程用途 |
| :--- | :--- | :--- |
| [`Module`](#module) | daemon-service | 注入时描述一个模块（包名/APK 路径/预加载 DEX/服务句柄） |
| [`PreLoadedApk`](#preloadedapk) | daemon-service | 模块 APK 的预加载产物（DEX 内存映射/类名/库名/legacy 标志） |
| [`Application`](#application) | manager-service | 作用域中的一个目标应用（包名 + userId） |
| [`UserInfo`](#userinfo) | manager-service | 一个 Android 用户（id + name） |

---

## Module

> 📂 `services/daemon-service/src/main/aidl/org/lsposed/lspd/models/Module.aidl`

注入流程中描述一个待加载的 Xposed 模块，由 Daemon 在 Zygote fork 后传给被注入进程。

```aidl
package org.lsposed.lspd.models;
import org.lsposed.lspd.models.PreLoadedApk;
import org.lsposed.lspd.service.ILSPInjectedModuleService;

parcelable Module {
    String packageName;
    int appId;
    String apkPath;
    PreLoadedApk file;
    ApplicationInfo applicationInfo;
    ILSPInjectedModuleService service;
}
```

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `packageName` | `String` | 模块包名 |
| `appId` | `int` | 模块的应用 id（uid 基础） |
| `apkPath` | `String` | 模块 APK 在文件系统中的路径 |
| `file` | `PreLoadedApk` | 预加载产物（DEX/类名/库名） |
| `applicationInfo` | `ApplicationInfo` | 系统 `ApplicationInfo`（含元数据） |
| `service` | `ILSPInjectedModuleService` | 注入到模块进程的远程服务句柄 |

`applicationInfo` 与 `service` 是 Android 框架/其它 AIDL 类型，AIDL 会按对应 Parcelable 规则序列化。

---

## PreLoadedApk

> 📂 `services/daemon-service/src/main/aidl/org/lsposed/lspd/models/PreLoadedApk.aidl`

Daemon 在注入前预解析模块 APK，把 dex 提前映射进 `SharedMemory`（Ashmem）以避免每进程重复解析，结果用此结构传递。

```aidl
package org.lsposed.lspd.models;

parcelable PreLoadedApk {
    List<SharedMemory> preLoadedDexes;
    List<String> moduleClassNames;
    List<String> moduleLibraryNames;
    boolean legacy;
}
```

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `preLoadedDexes` | `List<SharedMemory>` | 预加载到共享内存的 DEX 列表 |
| `moduleClassNames` | `List<String>` | 模块入口类名（来自 `java_init.list`/`xposed_init`） |
| `moduleLibraryNames` | `List<String>` | 模块 native 库名（`System.loadLibrary` 目标） |
| `legacy` | `boolean` | 是否为 legacy（rovo89 式）模块，影响加载路径 |

`preLoadedDexes` 用 `SharedMemory` 跨进程共享只读 DEX 映射，避免每个被注入进程重复读盘与验证。

---

## Application

> 📂 `services/manager-service/src/main/aidl/org/lsposed/lspd/models/Application.aidl`

作用域（scope）中的一个目标应用条目。管理器把「模块在哪些应用里生效」编码为 `List<Application>` 传给 Daemon。

```aidl
package org.lsposed.lspd.models;

parcelable Application {
    String packageName;
    int userId;
}
```

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `packageName` | `String` | 目标应用包名（`system`/`android` 约定见 ModuleUtil.getScopeList） |
| `userId` | `int` | Android 用户 id（uid / PER_USER_RANGE） |

管理器 UI 层在 `ScopeAdapter.ApplicationWithEquals` 中继承此类并补充 `equals`/`hashCode`，以便放进 Set 做作用域集合运算；写回 IPC 时转回 `Application` 列表（见 `ConfigManager.setModuleScope`）。

---

## UserInfo

> 📂 `services/manager-service/src/main/aidl/org/lsposed/lspd/models/UserInfo.aidl`

一个 Android 用户的精简表示，用于多用户场景下列出可用用户、按用户分 tab 展示模块。

```aidl
package org.lsposed.lspd.models;

parcelable UserInfo {
    int id;
    String name;
}
```

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `id` | `int` | Android 用户 id |
| `name` | `String` | 用户显示名 |

由 `ConfigManager.getUsers()` 返回，被 `ModuleUtil` 缓存、`ModulesFragment` 用作 tab 标签与「安装到其他用户」菜单项。

## 数据流全景

```mermaid
flowchart LR
    subgraph 管理侧
        APP["管理器 UI"]
        APP -->|"List<Application>"| MS["ILSPManagerService"]
        APP -->|"List<UserInfo>"| MS
    end
    subgraph 注入侧
        DAEMON["Daemon"]
        DAEMON -->|"Module (含 PreLoadedApk)"| ZG["Zygote/被注入进程"]
        ZG -.SharedMemory DEX.-> APP2["被注入应用"]
    end
    MS -.持久化作用域.-> DAEMON
    DAEMON -.读取作用域决定注入哪些模块.-> DAEMON

    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef ipc fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef proc fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    class APP class ui
    class MS,DAEMON class ipc
    class ZG,APP2 class proc
```

## 相关

- [AIDL 接口索引](./index) — 使用这些模型的接口契约
- [ILSPManagerService](./ilspmanagerservice) — `Application`/`UserInfo` 的载体接口
- [ILSPApplicationService](./ilspapplicationservice) — `Module`/`PreLoadedApk` 的载体接口
- [app · ConfigManager](../classes/app/config-manager) — 管理侧使用 `Application`/`UserInfo`
- [app · ScopeAdapter](../classes/app/scope-adapter) — `ApplicationWithEquals` 继承 `Application`
