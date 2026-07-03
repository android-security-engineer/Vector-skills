# 📋 VectorMetaDataReader · APK 元数据

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/utils/VectorMetaDataReader.kt`
> 🟦 xposed 模块 · 直接解析 AndroidManifest 的 meta-data

## 类职责

`class VectorMetaDataReader private constructor(apk: File)` 用 `pxb.android.axml.AxmlReader` **直接解析 APK 内的 `AndroidManifest.xml` 二进制 AXML**，仅提取 `<application><meta-data>` 的 `name`/`value` 对，装入 `metaData` map。无需解压整包或走 `PackageManager`，用于在装载前读取 `xposedminversion`、`xposeddescription` 等运行时约束。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `metaData` | `MutableMap<String, Any>` | 解析结果，key=meta-data name，value 原始值 |

## 访问者结构

`init` 块打开 `JarFile(apk)` 取 `AndroidManifest.xml` entry，`AxmlReader` 驱动一个 `AxmlVisitor`，按嵌套 visitor 逐层下钻：

| Visitor | 处理的标签 | 下钻条件 |
| :--- | :--- | :--- |
| `AxmlVisitor`（顶层） | 根 | 仅返回 `ManifestTagVisitor` |
| `ManifestTagVisitor` | `<manifest>` 子节点 | `name=="application"` → `ApplicationTagVisitor`，其余返回 null 跳过 |
| `ApplicationTagVisitor` | `<application>` 子节点 | `name=="meta-data"` → `MetaDataVisitor`，其余跳过 |
| `MetaDataVisitor` | 单个 `<meta-data>` | `attr` 收集 name(type==3)/value，`end()` 时写入 map |

## 方法签名

```kotlin
// 公开入口：解析 apk 返回 meta-data map
companion object {
    @JvmStatic
    @Throws(IOException::class)
    fun getMetaData(apk: File): Map<String, Any>

    // 从字符串前缀提取连续数字（如 "93" 从 "93-beta"）
    @JvmStatic
    fun extractIntPart(str: String): Int

    @Throws(IOException::class)
    private fun getBytesFromInputStream(inputStream: InputStream): ByteArray
}
```

`MetaDataVisitor.attr`：`type == 3 && name == "name"` 取字符串名为 `attrName`；`name == "value"` 取任意类型为 `attrValue`。`end()` 时两者皆非空才写入。

## 访问者跳过策略

AXML 的 `<manifest>` 下有 `<uses-permission>`/`<application>`/`<activity>` 等多种子节点，本解析器**只关心 `meta-data`**，其余一律返回 `null` 跳过，避免无意义遍历。层级与下钻规则：

| 层级 | visitor | 下钻目标 | 其他子节点 |
| :--- | :--- | :--- | :--- |
| 根 | `AxmlVisitor` | `<manifest>` | — |
| `<manifest>` | `ManifestTagVisitor` | `<application>` | `<permission>`/`<activity>` 等返回 null |
| `<application>` | `ApplicationTagVisitor` | `<meta-data>` | 其他返回 null |
| `<meta-data>` | `MetaDataVisitor` | — | 收集 name/value |

## AXML type 编码

`attr` 的 `type` 参数来自 AXML 二进制格式：`3` 表示字符串（`TYPE_STRING`）。本类据此区分 `android:name`（必为字符串）与 `android:value`（可为字符串/整数/布尔/资源 id 等），`value` 不限定 type，原样存入 `metaData`。

## 与 PackageManager 的取舍

- **为何不走 `PackageManager.getApplicationInfo`**：模块 APK 在装载期可能尚未被 PMS 完整索引（尤其 parasitic 场景），且 PMS 调用走 binder 开销大；
- **AXML 直读**：`JarFile` + `AxmlReader` 纯本地、零 IPC，适合装载前的快速约束检查（如 `xposedminversion`）；
- **`extractIntPart`**：meta-data 的 `xposedminversion` 常带后缀（如 `"93-beta"`），本方法取前导连续数字段得到 `93`。

## 解析链路

```mermaid
flowchart TD
    A["getMetaData(apk)"] --> B["JarFile(apk)"]
    B --> C["entry: AndroidManifest.xml"]
    C --> D["AxmlReader"]
    D --> E["AxmlVisitor"]
    E -->|child| F["ManifestTagVisitor"]
    F -->|application| G["ApplicationTagVisitor"]
    G -->|meta-data| H["MetaDataVisitor"]
    H --> I["attr: name + value"]
    I --> J["end → metaData map"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,E,F,G,H,I class vec
    class A,J class plain
```

## 相关

- [VectorModuleManager · 模块管理](./vector-module-manager)（装载前读 minversion 等约束）
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
