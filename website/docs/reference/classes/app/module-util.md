# 🧰 ModuleUtil

> 📂 [`app/src/main/java/org/lsposed/manager/util/ModuleUtil.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/ModuleUtil.java)
> 🟦 app 模块 · 本地模块工具与 InstalledModule

## 类职责

`public final class ModuleUtil` 是已安装模块的**单例注册表**。它扫描全用户已安装包，识别 Xposed 模块（现代 `META-INF/xposed/java_init.list` 或 legacy `xposedminversion` meta-data），构建 `InstalledModule` 缓存，并维护启用模块集合（来自 `ConfigManager.getEnabledModules()`）。UI 通过 `ModuleListener` 监听重载，`ModulesFragment`/`ScopeAdapter` 都依赖它。

模块识别靠 `getModernModuleApk`（遍历 split APK 找 `java_init.list`）和 `isLegacyModule`（meta-data 含 `xposedminversion`）。

## 关键常量与字段

| 字段 | 含义 |
| :--- | :--- |
| `MIN_MODULE_VERSION` | `2`，最低允许的 xposedminversion |
| `MATCH_ANY_USER` | `0x00400000` |
| `MATCH_ALL_FLAGS` | `DISABLED|DIRECT_BOOT_AWARE|UNAWARE|UNINSTALLED|MATCH_ANY_USER` |
| `installedModules` | `Map<Pair<String,Integer>, InstalledModule>`，(包名,userId)→模块 |
| `enabledModules` | `HashSet<String>`，已启用模块包名 |
| `users` | `List<UserInfo>` |
| `listeners` | `Set<ModuleListener>` |

## 静态工具方法

```java
public static synchronized ModuleUtil getInstance()
public static int extractIntPart(String str)                    // 从字符串开头提取连续数字
public static ZipFile getModernModuleApk(ApplicationInfo info)  // 找含 java_init.list 的 split APK
public static boolean isLegacyModule(ApplicationInfo info)      // metaData 含 xposedminversion
```

## 实例方法

```java
public boolean isModulesLoaded()
synchronized public void reloadInstalledModules()               // 全量扫描，识别现代/legacy 模块
public InstalledModule reloadSingleModule(String packageName, int userId)                    // 不带移除标志
public InstalledModule reloadSingleModule(String packageName, int userId, boolean packageFullyRemoved)
@Nullable public List<UserInfo> getUsers()
@Nullable public InstalledModule getModule(String packageName, int userId)
@Nullable public InstalledModule getModule(String packageName)                                // userId=0
@Nullable synchronized public Map<Pair<String,Integer>, InstalledModule> getModules()
public boolean setModuleEnabled(String packageName, boolean enabled)   // 委托 ConfigManager + 同步本地集合
public boolean isModuleEnabled(String packageName)
public int getEnabledModulesCount()                                   // 未加载返回 -1
public void addListener(ModuleListener listener)
public void removeListener(ModuleListener listener)
```

`reloadSingleModule` 在包不存在时从缓存移除并通知；`packageFullyRemoved` 且模块启用中则从启用集合剔除。

## 内部类 InstalledModule

`public class InstalledModule`（非 static，依赖外类 `pm`）。构造时解析模块元数据：

- **legacy 模块**：从 `app.metaData` 取 `xposedminversion`（Integer/String，`extractIntPart` 兜底）、`xposeddescription`、`xposedscope`；`targetVersion=minVersion`、`staticScope=false`。
- **现代模块**：从 APK `META-INF/xposed/module.prop`（Properties）读 `minApiVersion`/`targetApiVersion`/`staticScope`；从 `scope.list` 读静态作用域。

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `userId` / `packageName` / `versionName` / `versionCode` | — | 身份与版本 |
| `legacy` | `boolean` | 是否 legacy 模块 |
| `minVersion` / `targetVersion` | `int` | 最低/目标 Xposed API 版本 |
| `staticScope` | `boolean` | 是否声明静态作用域 |
| `installTime` / `updateTime` | `long` | 来自 PackageInfo |
| `app` / `pkg` | `ApplicationInfo` / `PackageInfo` | |
| `appName` / `description` / `scopeList` | — | 懒加载 |

`getScopeList()` 历史兼容：把 `android`↔`system` 互换（rovo89 旧约定），并回退到仓库 `OnlineModule.getScope()`。

## ModuleListener

```java
public interface ModuleListener {
    default void onSingleModuleReloaded(InstalledModule module) {}
    default void onModulesReloaded() {}
}
```

## 扫描与识别流程

```mermaid
flowchart TD
    A["reloadInstalledModules"] --> B["ConfigManager.getInstalledPackagesFromAllUsers"]
    B --> C["遍历 PackageInfo"]
    C --> D{"getModernModuleApk<br/>或 isLegacyModule?"}
    D -->|是| E["new InstalledModule<br/>put (pkg,uid/RANGE)"]
    D -->|否| F["跳过"]
    E --> G["installedModules 替换"]
    G --> H["enabledModules = getEnabledModules()"]
    H --> I["notify onModulesReloaded"]
    J["reloadSingleModule"] --> K{"PackageInfo 存在?"}
    K -->|否| L["缓存移除 + onSingleModuleReloaded(old)"]
    K -->|是| D

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,E,F,G,H,I class core
    class J,K class branch
    class D class branch
    class L class core
```

## 相关

- [ConfigManager · 包/启用模块 IPC](./config-manager)
- [RepoLoader · 在线模块侧](./repo-loader) — `getScopeList` 回退源
- [ModulesFragment · 模块列表消费者](./modules-fragment)
- [BackupUtils · 备份模块数据](./backup-utils)
