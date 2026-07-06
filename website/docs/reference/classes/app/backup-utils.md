# 💾 BackupUtils

> 📂 [`app/src/main/java/org/lsposed/manager/util/BackupUtils.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/BackupUtils.java)
> 🟦 app 模块 · 模块配置备份/恢复

## 类职责

`public class BackupUtils` 把全部已安装模块的「启用状态 + 作用域」序列化为 JSON 再 GZIP 压缩，落盘到用户通过 SAF 选定的 `.lsp` 文件；恢复时反向解析、逐模块写回 `ConfigManager`。支持单包过滤（`packageName` 参数），用于模块详情页只备份/恢复单个模块。

格式版本 `VERSION = 2`，兼容读取 v1（v1 的 scope 是纯字符串包名数组，userId 固定 0）。

## backup

```java
public static void backup(Uri uri) throws JSONException, IOException
public static void backup(Uri uri, String packageName) throws IOException, JSONException
```

遍历 `ModuleUtil.getModules().values()`（`packageName` 非空时只备份该包），对每个模块：

- `enable` ← `ModuleUtil.isModuleEnabled(packageName)`
- `package` ← 包名
- `scope` ← `ConfigManager.getModuleScope(packageName)`，每项 `{package, userId}`

写 `rootObject{version, modules[]}` → `GZIPOutputStream` → `ContentResolver.openOutputStream(uri)`。

`getModules()` 返回 null 时直接 return（模块未加载完成），避免写空备份。`packageName` 参数用于模块详情页单模块备份：遍历时 `module.packageName.equals(packageName)` 才纳入。scope 每项从 `ApplicationWithEquals` 取 `packageName` 与 `userId` 写入 JSON 对象。

## restore

```java
public static void restore(Uri uri) throws JSONException, IOException
public static void restore(Uri uri, String packageName) throws IOException, JSONException
```

`GZIPInputStream` 解压 → `JSONObject` 解析 → 校验 `version`（1 或 2，否则抛 `IllegalArgumentException("Unknown backup file version")`）。逐模块：

1. `ModuleUtil.getModule(name)` 必须非空（模块需已安装）。
2. `setModuleEnabled(name, enabled)`；未启用则跳过作用域。
3. 按 `version` 构造 `HashSet<ApplicationWithEquals>`（v2 读 `{package,userId}` 对象，v1 读字符串 userId=0）。
4. `ConfigManager.setModuleScope(name, module.legacy, scope)`。

`packageName` 参数同样用于单模块恢复过滤。GZIP 输入用 32 字节缓冲区构造，`FileUtils.copy` 拷贝到 `ByteArrayOutputStream` 后转字符串再 `JSONObject` 解析。`module.legacy` 透传给 `setModuleScope`——legacy 模块需把自身加入作用域。

## 备份文件结构

```json
{
  "version": 2,
  "modules": [
    {
      "enable": true,
      "package": "org.example.mod",
      "scope": [
        {"package": "com.android.system", "userId": 0},
        {"package": "com.android.system", "userId": 10}
      ]
    }
  ]
}
```

## 备份/恢复流程

```mermaid
flowchart TD
    A["backup(uri)"] --> B["ModuleUtil.getModules()"]
    B --> C["遍历模块<br/>packageName 过滤"]
    C --> D["ConfigManager.getModuleScope"]
    D --> E["JSON: enable/package/scope[]"]
    E --> F["GZIPOutputStream → uri"]
    G["restore(uri)"] --> H["GZIPInputStream → JSONObject"]
    H --> I{"version 1/2?"}
    I -->|否| J["throw IllegalArgumentException"]
    I -->|是| K["遍历 modules[]"]
    K --> L["getModule(name) 非空?"]
    L -->|是| M["setModuleEnabled"]
    M --> N["按 version 构 scope Set"]
    N --> O["ConfigManager.setModuleScope"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,E,F,G,H,K,M,N,O class core
    class D class ipc
    class I,L class branch
    class J class core
```

## 版本兼容

| 版本 | scope 编码 | userId |
| :--- | :--- | :--- |
| `VERSION = 2`（当前） | JSON 对象数组 `[{package,userId}]` | 逐条读取 |
| `1`（旧） | 字符串数组 `["pkg1","pkg2"]` | 固定 0 |

读 v1 时每条字符串包名构造 `ApplicationWithEquals(pkg, 0)`。未知版本抛 `IllegalArgumentException("Unknown backup file version")`，由调用方（`SettingsFragment` 的 `runAsync`）捕获后 `showHint(settings_restore_failed2)`。

## 相关

- [ConfigManager · 模块作用域 IPC](./config-manager) — `getModuleScope` / `setModuleScope`
- [ModuleUtil · 模块与启用状态](./module-util)
- [ScopeAdapter · ApplicationWithEquals 定义](./scope-adapter) — 作用域条目的 equals/hashCode
- [SettingsFragment · 备份/恢复入口](./settings-fragment)
