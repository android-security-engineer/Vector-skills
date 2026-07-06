# 🫙 VectorURLStreamHandler · jar: 拦截

> 📂 [`xposed/src/main/kotlin/org/matrix/vector/impl/utils/VectorURLStreamHandler.kt`](https://github.com/android-security-engineer/Vector-skills/blob/master/xposed/src/main/kotlin/org/matrix/vector/impl/utils/VectorURLStreamHandler.kt)
> 🟦 xposed 模块 · 模块 APK 内资源的 jar: URL 处理器

## 类职责

`internal class VectorURLStreamHandler(jarFileName: String) : Handler()` 继承 `sun.net.www.protocol.jar.Handler`，为模块 ClassLoader 提供 `jar:` 协议的 URL 流处理。它直接持有打开的 `JarFile`，按 entry 名构造 `jar:file:...!/entry` URL，连接时从内存中的 `JarFile` 取 entry 流，**无需把 zip 解到磁盘**。`finalize` 时关闭 `JarFile`。

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `fileUri` | `String` | `File(jarFileName).toURI().toString()`，URL host 部分 |
| `jarFile` | `JarFile` | 持续打开的模块 APK 句柄 |

## 方法签名

```kotlin
// 按 entry 名构造 jar: URL，entry 不存在返回 null
fun getEntryUrlOrNull(entryName: String): URL?

@Throws(IOException::class)
override fun openConnection(url: URL): URLConnection

@Suppress("deprecation")
@Throws(IOException::class)
protected fun finalize()   // 关闭 jarFile
```

`getEntryUrlOrNull` 用 `Uri.encode(entryName, "/")` 编码 entry 名（保留 `/`），构造 `URL("jar", null, -1, "$fileUri!/$encodedName", this)`。

## ClassPathURLConnection（内部类）

`private inner class ClassPathURLConnection(url: URL) : JarURLConnection(url)` —— 实际连接实现。

| 字段 | 含义 |
| :--- | :--- |
| `connectionJarFile` | `connect` 时按需新建的独立 JarFile |
| `jarEntry` | 解析出的 ZipEntry |
| `jarInput` | 包装的 FilterInputStream |
| `isClosed` | 关闭标志 |

```kotlin
@Throws(IOException::class)
override fun connect()                    // 取 entry，FileNotFoundException 若缺失
@Throws(IOException::class)
override fun getJarFile(): JarFile        // 返回 connectionJarFile（按需新建）
@Throws(IOException::class)
override fun getInputStream(): InputStream  // FilterInputStream，close 时关闭 jarFile + connectionJarFile
override fun getContentType(): String     // guessContentTypeFromName
override fun getContentLength(): Int      // jarEntry.size，失败 -1
override fun setUseCaches(usecaches: Boolean)  // 强制 false
```

`getInputStream` 返回的 `FilterInputStream` 在 `close()` 时会同时关闭自身流、宿主 `jarFile`、`connectionJarFile`，并置 `isClosed = true`。`useCaches` 强制为 false 避免连接缓存导致句柄泄漏。

## 连接生命周期

```mermaid
flowchart TD
    A["getEntryUrlOrNull(entry)"] --> B{"entry 存在?"}
    B -->|否| C["return null"]
    B -->|是| D["构造 jar: URL"]
    D --> E["openConnection"]
    E --> F["ClassPathURLConnection"]
    F --> G["getInputStream"]
    G --> H["connect → 取 jarEntry"]
    H --> I["FilterInputStream 包装 jarFile 流"]
    I --> J["读取资源"]
    J --> K["close()"]
    K --> L["关 input + jarFile + connectionJarFile"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class D,E,F,H,I class vec
    class B class hot
    class A,C,G,J,K,L class plain
```

## 使用要点

- 本类供 `VectorModuleClassLoader` 的资源/类查找使用，构造时打开一次 `JarFile`，进程生命周期内复用，`finalize` 才关闭；
- `getEntryUrlOrNull` 对 entry 名做 `Uri.encode(entryName, "/")`：保留 `/` 路径分隔符，转义其他特殊字符，确保 `URL` 合法且能正确解析子路径；
- `setUseCaches` 强制 false：连接缓存会持有 `JarFile` 句柄，模块 APK 资源访问频繁，缓存会导致 fd 泄漏；
- `ClassPathURLConnection.getInputStream` 返回的流在 `close` 时连锁关闭宿主 `jarFile`——调用方必须确保流被关闭，否则 fd 泄漏直至 GC 触发 `finalize`。

## 相关

- [VectorModuleManager · 模块管理](./vector-module-manager)（模块 ClassLoader 资源加载经此处理）
- [VectorMetaDataReader · APK 元数据](./vector-meta-data-reader)（同样按 entry 读 APK，但用 JarFile 直接流）
- xposed 模块总览见 [modules · xposed](../../modules/xposed)
