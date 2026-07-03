# 🧬 DaemonState · Database · ModuleDatabase

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/data/DaemonState.kt`
> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/data/Database.kt`
> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/data/ModuleDatabase.kt`
> 🟦 daemon 模块 · 状态容器与 SQLite schema

## 类职责

这三个类共同构成 daemon 的**状态与持久化层**：

- `DaemonState`：不可变快照数据类，承载运行时状态；
- `Database`：`SQLiteOpenHelper`，定义 schema、WAL、外键、LSPosed 迁移；
- `ModuleDatabase`：模块写操作门面，所有变更后触发 `ConfigCache.requestCacheUpdate`。

## DaemonState

```kotlin
data class ProcessScope(val processName: String, val uid: Int)

data class DaemonState(
    val isDexObfuscateEnabled: Boolean = !BuildConfig.DEBUG,
    val isCacheReady: Boolean = false,
    val managerUid: Int = -1,
    val miscPath: Path? = null,
    val modules: Map<String, Module> = emptyMap(),
    val scopes: Map<ProcessScope, List<Module>> = emptyMap(),
)
```

注释明确：**任何更新都生成新副本并原子替换引用**。`ProcessScope` 作为 `scopes` 的键，以 `(进程名, uid)` 唯一标识一个注入目标。`isDexObfuscateEnabled` 默认与 `BuildConfig.DEBUG` 反相，release 构建默认开启类名随机化。

## Database · schema

```kotlin
class Database(context: Context? = FakeContext()) :
    SQLiteOpenHelper(context, FileSystem.dbPath.absolutePath, null, DB_VERSION)  // DB_VERSION = 4
```

`onConfigure`：`setForeignKeyConstraintsEnabled(true)` + `enableWriteAheadLogging()` + `PRAGMA synchronous=NORMAL`。

`onCreate` 建三张表并插入自引用行：

| 表 | 主键 | 关键列 |
| :--- | :--- | :--- |
| `modules` | `mid AUTOINCREMENT` | `module_pkg_name UNIQUE`、`apk_path`、`enabled`、`auto_include`（均带 `CHECK IN (0,1)`） |
| `scope` | `(mid, app_pkg_name, user_id)` | `mid` 外键 `ON DELETE CASCADE` 关联 `modules` |
| `configs` | `(module_pkg_name, user_id, group, key)` | `data blob`，外键 `ON DELETE CASCADE`；附加索引 `configs_idx` |

自引用行：`INSERT OR IGNORE INTO modules (module_pkg_name, apk_path) VALUES ('lspd', managerApkPath)`。

## Database · 升级与降级迁移

`onUpgrade`：

- `oldVersion < 2`：重建 `scope`/`configs` 表加严格约束，迁移旧数据后删 `old_*`；
- `oldVersion < 3`：`scope` 中 `app_pkg_name` 由 `'android'` 改为 `'system'`；
- `oldVersion < 4`：`modules` 增加 `auto_include` 列。

`onDowngrade` 区分两种来源：

- `oldVersion < 101`：未知高版本，`wipeDatabase` 后重建；
- 否则视为 LSPosed 数据库（v101+）：先备份为 `modules_config_lsposed.db`，把 LSPosed 表重命名为 `lsp_*` 避免冲突，重建 Vector schema，再用 `INSERT OR IGNORE ... SELECT` 迁移 `modules`（合并 `modules_state.enabled`）、`scope`（按新 `mid` 重映射）、`configs`（`group_name`/`key_name` 重命名）；失败则回退到清空重建；最后 `DROP` 残留的 `lsp_*`、`android_metadata`、`app_configs`、`lspd_configs`。

## ModuleDatabase · 写操作门面

```kotlin
object ModuleDatabase {
    fun enableModule(packageName: String): Boolean
    fun disableModule(packageName: String): Boolean
    fun setModuleScope(packageName: String, scope: MutableList<Application>): Boolean
    fun removeModuleScope(packageName: String, scopePackageName: String, userId: Int): Boolean
    fun updateModuleApkPath(packageName: String, apkPath: String?, force: Boolean): Boolean
    fun removeModule(packageName: String): Boolean
    fun setAutoInclude(packageName: String, enabled: Boolean): Boolean
}
```

- 全部拒绝 `"lspd"`（自引用行不可改）；
- `enableModule`：不存在则 `INSERT`（`apk_path=""` 延迟到缓存更新补全），存在则 `UPDATE enabled=1`；
- `setModuleScope`：先 `enableModule`，再事务内 `DELETE scope WHERE mid=?` 后批量 `INSERT CONFLICT_IGNORE`，跳过 `system && userId!=0`；
- `updateModuleApkPath`：`INSERT CONFLICT_IGNORE`，已存在则按 `force`/缓存比对决定是否 `UPDATE`；
- 所有变更成功后 `ConfigCache.requestCacheUpdate()`。

## 写入到快照流转

```mermaid
flowchart TD
    A["ManagerService / CLI"] --> B["ModuleDatabase.*"]
    B --> C["SQLite 写入"]
    C --> D["requestCacheUpdate"]
    D --> E["performCacheUpdate"]
    E --> F["DaemonState 原子替换"]
    F --> G["ApplicationService 读取"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,D,E,F class vec
    class B class hot
    class A,G class plain
```

## 相关

- [ConfigCache · 不可变快照](./config-cache)
- [PreferenceStore · 偏好差分](./preference-store)
- [ManagerService · 管理器服务](./manager-service)
- daemon 数据层见 [modules · daemon](../../modules/daemon)
