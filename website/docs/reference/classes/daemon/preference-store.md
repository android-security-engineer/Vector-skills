# ⚙️ PreferenceStore

> 📂 [`daemon/src/main/kotlin/org/matrix/vector/daemon/data/PreferenceStore.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/daemon/src/main/kotlin/org/matrix/vector/daemon/data/PreferenceStore.kt)
> 🟦 daemon 模块 · 模块偏好差分更新与 lspd 配置

## 类职责

`object PreferenceStore` 是 daemon 的**模块偏好持久化门面**。它把"模块 + 用户 + group + key → 序列化对象"模型映射到 `configs` 表，提供读全组、差分写、按维度删除，以及一组针对 `lspd` 自身的布尔/集合快捷访问。所有读写复用 `ConfigCache.dbHelper` 的 `readableDatabase`/`writableDatabase`。

## 通用读写

```kotlin
fun getModulePrefs(
    packageName: String, userId: Int, group: String,
    db: SQLiteDatabase = ConfigCache.dbHelper.readableDatabase
): Map<String, Any>

fun updateModulePref(moduleName: String, userId: Int, group: String, key: String, value: Any?)
fun updateModulePrefs(moduleName: String, userId: Int, group: String, diff: Map<String, Any?>)
fun deleteModulePrefs(moduleName: String, userId: Int? = null, group: String? = null)
```

`getModulePrefs` 查 `configs` 表 `key`/`data` 列，用 `SerializationUtilsX.deserialize<Any>(blob)` 反序列化为 `Map<String, Any>`。仅关游标不关 DB 连接。

`updateModulePrefs` 是**差分更新**核心，在单个事务内遍历 `diff`：

- 值 `is Serializable` → `ContentValues` 写 `group`/`key`/`data`/`module_pkg_name`/`user_id`，`INSERT CONFLICT_REPLACE`；
- 值非 `Serializable`（含 `null`）→ `DELETE` 对应行，实现"删除即传 null"语义。

`deleteModulePrefs` 动态拼 `WHERE`：必带 `module_pkg_name=?`，可选追加 `user_id=?` 与 `group=?`，支持按模块/用户/组任意粒度清理。

## lspd 配置快捷方法

```kotlin
fun isStatusNotificationEnabled(): Boolean
fun setStatusNotification(enabled: Boolean)
fun isVerboseLogEnabled(): Boolean
fun setVerboseLog(enabled: Boolean)
fun isScopeRequestBlocked(pkg: String): Boolean
```

| 方法 | key | 默认 | 类型 |
| :--- | :--- | :--- | :--- |
| `isStatusNotificationEnabled` | `enable_status_notification` | `true` | `Boolean` |
| `isVerboseLogEnabled` | `enable_verbose_log` | `true` | `Boolean` |
| `isScopeRequestBlocked` | `scope_request_blocked` | `false` | `Set<String>` 含 `pkg` |

均固定 `packageName="lspd"`、`userId=0`、`group="config"`。`isScopeRequestBlocked` 用于 `ModuleService.requestScope` 与 `VectorService.dispatchModuleScope` 的 `block` 分支，被列入该集合的模块永久拒绝作用域请求。

## 差分写入流程

```mermaid
flowchart TD
    A["模块/ManagerService"] --> B["updateModulePrefs(diff)"]
    B --> C["beginTransaction"]
    C --> D{"value 类型"}
    D -->|Serializable| E["INSERT CONFLICT_REPLACE"]
    D -->|null / 非 Serializable| F["DELETE 对应行"]
    E --> G["setTransactionSuccessful"]
    F --> G
    G --> H["endTransaction"]
    H --> I["InjectedModuleService.onUpdateRemotePreferences<br/>推送回调"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,E,F,G,H,I class vec
    class D class hot
    class A,B class plain
```

## 与远程偏好的协作

`PreferenceStore` 的写入不仅落库，还驱动 `ModuleService`/`InjectedModuleService` 的推模式回调链。模块进程通过 `IXposedService.updateRemotePreferences(group, diff)` 提交差分（`delete` Set + `put` Map），`ModuleService` 合并后调 `updateModulePrefs`，再由 `InjectedModuleService.onUpdateRemotePreferences` 把 `diff` Bundle 推给该 group 下所有注册的 `IRemotePreferenceCallback`。这使模块的多个进程实例能实时同步配置变更，无需各自重新拉取全量偏好。

## 事务边界与失败语义

差分写入在单个 `beginTransaction`/`endTransaction` 内完成，任一 key 失败会回滚整批。`setTransactionSuccessful` 仅在循环正常结束时调用，`finally` 必 `endTransaction`。`SerializationUtilsX.serialize` 对非 `Serializable` 抛异常会被事务捕获并整体回滚——因此调用方应确保 `diff` 内的值均为 `Serializable`，否则用 `null` 触发删除语义。`deleteModulePrefs` 不在事务内，因其通常用于模块卸载后的批量清理，单条 DELETE 失败不影响其余。

## 反序列化与类型安全

`SerializationUtilsX.deserialize<Any>(blob)` 把 blob 还原为对象，调用方需自行做类型断言。`isStatusNotificationEnabled`/`isVerboseLogEnabled` 用 `as? Boolean ?: true` 容错——blob 损坏或类型不符时回退默认值 `true`，保证日志/通知在配置缺失时默认开启。`isScopeRequestBlocked` 同理用 `as? Set<*>`，缺失视为空集。

## lspd 自引用行的特殊地位

`configs` 表的外键约束 `module_pkg_name REFERENCES modules(module_pkg_name) ON DELETE CASCADE`，而 `lspd` 是 `Database.onCreate` 用 `INSERT OR IGNORE` 写入的自引用行，永不被 `ModuleDatabase` 删除（全部写方法拒绝 `"lspd"`）。这保证 daemon 自身的配置（`misc_path`、`enable_verbose_log`、`scope_request_blocked`）有稳定的归属行，不会因模块清理被级联删除。

## 读取的 DB 连接复用

`getModulePrefs` 接受可选 `db: SQLiteDatabase` 参数，默认 `ConfigCache.dbHelper.readableDatabase`。这一设计允许 `ConfigCache.performCacheUpdate` 等已持有 DB 连接的调用方复用同一连接，避免在事务中途重复获取连接造成的锁竞争。`updateModulePrefs`/`deleteModulePrefs` 则硬编码取 `writableDatabase`，因为它们需要写锁并自行管理事务。`readableDatabase`/`writableDatabase` 由 `SQLiteOpenHelper` 内部缓存，重复调用开销极低。`use { cursor -> }` 只关闭游标不关闭连接，连接归还 helper 的连接池，供下次调用立即复用。

## 序列化兼容性

`SerializationUtilsX` 是 Apache Commons Lang `SerializationUtils` 的扩展版本，支持跨 Android 版本的对象序列化。模块通过 `IXposedService.updateRemotePreferences` 提交的值必须实现 `java.io.Serializable`，否则触发删除分支。这要求模块开发者存放自定义类型时注意序列化兼容，特别是跨进程（模块进程与 daemon 进程可能用不同 ClassLoader）场景下，建议只存基本类型与标准集合类型。

## 相关

- [DaemonState · schema](./daemon-state)
- [ConfigCache · 快照构建](./config-cache)
- [ModuleService · 远程偏好与文件](./module-service)
- [ManagerService · verbose/通知开关](./manager-service)
