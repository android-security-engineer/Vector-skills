# 🌐 RepoLoader

> 📂 `app/src/main/java/org/lsposed/manager/repo/RepoLoader.java`
> 🟦 app 模块 · 在线模块仓库拉取

## 类职责

`public class RepoLoader` 是在线模块仓库的**单例加载器**。它从远端 `modules.json`（模块索引）与 `module/<pkg>.json`（单模块发布列表）拉取数据，GSON 反序列化为 `OnlineModule`，本地缓存到 `filesDir/repo.json`，并按用户选择的更新通道（稳定 / Beta / Snapshot）计算每个模块的 `ModuleVersion`。UI 通过 `RepoListener` 监听加载完成，通过 `getModuleLatestVersion` 判定可升级。

仓库有三个 URL，按顺序故障转移：`origin` → `backup` → `secondBackup`。

## 关键字段与常量

| 字段 | 含义 |
| :--- | :--- |
| `instance` | 单例，`getInstance()` 同步创建并后台 `loadLocalData(true)` |
| `onlineModules` | `Map<String, OnlineModule>`，包名 → 在线模块 |
| `latestVersion` | `ConcurrentHashMap<String, ModuleVersion>`，按通道算出的最新版 |
| `repoFile` | `filesDir/repo.json`，本地缓存路径 |
| `listeners` | `Set<RepoListener>`，`ConHashMap.newKeySet()` |
| `repoLoaded` | 是否加载完成 |
| `originRepoUrl` / `backupRepoUrl` / `secondBackupRepoUrl` | 三级故障转移 URL |

## ModuleVersion

```java
public static class ModuleVersion {
    public String versionName;
    public long versionCode;
    public boolean upgradable(long versionCode, String versionName)
}
```

`upgradable` 判定：仓库 `versionCode` 更高，或 `versionCode` 相同但 `versionName`（空格转下划线后）不同即视为可升级。

## 主要方法

```java
public static synchronized RepoLoader getInstance()
synchronized public void loadRemoteData()                          // 拉 modules.json → 写本地 → loadLocalData(false)
synchronized public void loadLocalData(boolean updateRemoteRepo)   // 读本地缓存 → updateLatestVersion → 通知监听
synchronized private void updateLatestVersion(OnlineModule[], String channel)
public void updateLatestVersion(String channel)
public void loadRemoteReleases(String packageName)                 // 异步拉单模块发布列表
public boolean isRepoLoaded()
@Nullable public ModuleVersion getModuleLatestVersion(String packageName)
@Nullable public List<Release> getReleases(String packageName)
@Nullable public String getLatestReleaseTime(String packageName, String channel)
@Nullable public OnlineModule getOnlineModule(String packageName)
@Nullable public Collection<OnlineModule> getOnlineModules()
public void addListener(RepoListener listener)
public void removeListener(RepoListener listener)
```

`loadRemoteData` 失败时按 URL 链递归重试；`loadLocalData` 缓存不存在则触发远端拉取。`updateLatestVersion` 解析 `getLatestRelease()` 形如 `"<versionCode>-<versionName>"` 的字符串，按通道选 stable/Beta/Snapshot。

`loadRemoteReleases(String packageName)` 是异步 `enqueue`：成功时 GSON 解析 `OnlineModule`，标 `releasesLoaded=true` 后 `onlineModules.replace`，再 `onModuleReleasesLoaded` 通知监听；失败同样按 URL 链重试，三级都失败才 `onThrowable`。

`getReleases(packageName)` 据通道返回稳定/Beta/Snapshot 发布列表；`releasesLoaded=false` 时从索引里的概要发布列表取，已加载则用完整发布列表。`getLatestReleaseTime` 同理按通道取最新发布时间。

## 通道与版本解析

| 通道 | 选择规则 |
| :--- | :--- |
| `channels[0]`（稳定） | `getLatestRelease()` |
| `channels[1]`（Beta） | 有 Beta 则取 `getLatestBetaRelease()`，否则回退稳定 |
| `channels[2]`（Snapshot） | 优先 Snapshot，次 Beta，再稳定 |

发布字符串形如 `"<versionCode>-<versionName>"`，按 `-` 分两段：前段 `Long.parseLong` 为 versionCode，后段为 versionName；解析失败则跳过该模块。

## RepoListener

```java
public interface RepoListener {
    default void onRepoLoaded() {}
    default void onModuleReleasesLoaded(OnlineModule module) {}
    default void onThrowable(Throwable t) { Log.e(...); }
}
```

## 加载与故障转移流程

```mermaid
flowchart TD
    A["getInstance()"] --> B["loadLocalData(true)"]
    B --> C{"repo.json 存在?"}
    C -->|否| D["loadRemoteData()"]
    C -->|是| E["GSON 解析 → onlineModules"]
    E --> F["updateLatestVersion(channel)"]
    F --> G["repoLoaded=true<br/>notify onRepoLoaded"]
    D --> H["OkHttp GET modules.json"]
    H --> I{"成功?"}
    I -->|是| J["写本地缓存 → loadLocalData(false)"]
    I -->|否| K{"切换 URL"}
    K -->|origin→backup| H
    K -->|backup→secondBackup| H
    K -->|都失败| L["notify onThrowable"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef net fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,E,F,G,J class core
    class D,H class net
    class I,K class branch
    class L class net
```

## 相关

- [ModuleUtil · 本地模块侧](./module-util) — 与仓库联合判定可升级
- [MainActivity · 仓库角标监听](./main-activity)
- [ModulesFragment · 可升级提示](./modules-fragment)
- [SettingsFragment · update_channel 联动](./settings-fragment)
