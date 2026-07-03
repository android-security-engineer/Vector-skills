# legacy · services 包

> 📂 `legacy/src/main/java/de/robv/android/xposed/services/`
> 🟦 文件访问服务抽象

## 包职责

定义 Xposed 框架提供的**文件访问服务**抽象。在 SELinux enforcing 环境下，模块不能直接读取 `/data/data/*` 下其他应用的文件，需要经服务中转。`BaseService` 定义接口，`DirectAccessService` 是直接文件访问实现，`FileResult` 是读取结果容器。具体实例应从 [`SELinuxHelper.getAppDataFileService()`](./legacy-api#selinuxhelper) 获取。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`BaseService`](#baseservice) | 文件访问服务抽象基类 |
| [`DirectAccessService`](#directaccessservice) | 直接文件访问实现（不经 IPC） |
| [`FileResult`](#fileresult) | 文件读取/stat 结果容器 |

---

## BaseService

`public abstract class BaseService` — 文件访问服务的抽象定义。具体子类引用应从 `SELinuxHelper` 获取。

### 访问模式常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `R_OK` | `4` | 读权限 |
| `W_OK` | `2` | 写权限 |
| `X_OK` | `1` | 执行权限 |
| `F_OK` | `0` | 文件/目录存在 |

### 抽象方法

```java
public boolean checkFileAccess(String filename, int mode)   // 检查访问权限（POSIX access 语义）
public boolean checkFileExists(String filename)             // 检查存在（= checkFileAccess(F_OK)）
public FileResult statFile(String filename) throws IOException              // 取 size + mtime
public byte[] readFile(String filename) throws IOException                 // 整文件读入内存
public FileResult readFile(String filename, long previousSize, long previousTime) throws IOException
public FileResult readFile(String filename, int offset, int length, long previousSize, long previousTime) throws IOException
```

带 `previousSize`/`previousTime` 的重载仅在文件变更时返回内容，未变更时 `content`/`stream` 为 null（仅返回新 size/mtime）。`offset`/`length` 控制读取范围，0 表示读到末尾。

### 默认实现（基于 readFile）

```java
public boolean hasDirectFileAccess()                                  // 默认 false
public long getFileSize(String filename) throws IOException           // = statFile().size
public long getFileModificationTime(String filename) throws IOException  // = statFile().mtime
public InputStream getFileInputStream(String filename) throws IOException  // 包成 ByteArrayInputStream
public FileResult getFileInputStream(String filename, long previousSize, long previousTime) throws IOException
```

`getFileInputStream` 默认把 `readFile` 的字节数组包成 `ByteArrayInputStream`，即整文件入内存；子类可覆写为真正的流式读取。

### 包级工具方法

```java
static void ensureAbsolutePath(String filename)  // 必须以 / 开头
static void throwCommonIOException(int errno, String errorMsg, String filename, String defaultText)
```

`throwCommonIOException` 把 errno 映射为 Java 异常：`EPERM/EACCES → FileNotFoundException`、`ENOENT → FileNotFoundException`、`ENOMEM → OutOfMemoryError`、`EISDIR → FileNotFoundException`、其他 → `IOException`。构造函数为包级私有。

---

## DirectAccessService

`public final class DirectAccessService extends BaseService` — **直接文件访问实现**（不经 IPC）。Vector 在该环境下直接以文件系统 API 访问，无 IPC 开销。`@hide`。

### 覆写要点

```java
public boolean hasDirectFileAccess()  // 恒 true
public boolean checkFileAccess(String filename, int mode)   // File.exists/canRead/canWrite/canExecute
public boolean checkFileExists(String filename)             // new File(filename).exists()
public FileResult statFile(String filename)                 // File.length + lastModified
public byte[] readFile(String filename)                     // 按文件长度一次性读
public FileResult readFile(String filename, long previousSize, long previousTime)
public FileResult readFile(String filename, int offset, int length, long previousSize, long previousTime)
```

带 `previousSize`/`previousTime` 的实现先比较 `File.length()` 与 `lastModified()`，相同则返回无内容的结果避免重读。`offset`/`length` 版本做边界校验（offset 越界抛 `IllegalArgumentException`），用 `FileInputStream.skip` + `read` 读指定范围。

### 流式读取

```java
public InputStream getFileInputStream(String filename) throws IOException
public FileResult getFileInputStream(String filename, long previousSize, long previousTime) throws IOException
```

覆写基类，返回 `BufferedInputStream(new FileInputStream(filename), 16 * 1024)`，**不把文件全量载入内存**，适合大偏好文件。

## FileResult

`public final class FileResult` — `readFile` / `statFile` 调用的结果持有者。

### 字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `content` | `byte[]` | 文件内容，未读取时为 null |
| `stream` | `InputStream` | 文件输入流，未读取时为 null |
| `size` | `long` | 文件大小 |
| `mtime` | `long` | 最后修改时间 |

### 构造（包级私有）

```java
FileResult(long size, long mtime)                            // 仅 stat，无内容
FileResult(byte[] content, long size, long mtime)           // 内容版本
FileResult(InputStream stream, long size, long mtime)       // 流版本
```

`content` 与 `stream` 互斥：前者对应 `readFile`，后者对应 `getFileInputStream`，未变更时两者都为 null。`toString()` 输出可读摘要。

## 相关

- [legacy 模块总览](../modules/legacy)
- [legacy · API 根包](./legacy-api)（`SELinuxHelper`、`XSharedPreferences`）
- 架构背景见 [架构 · Legacy 兼容层](../../architecture/legacy)
