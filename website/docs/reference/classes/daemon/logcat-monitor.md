# 📜 LogcatMonitor

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/env/LogcatMonitor.kt`
> 📂 `daemon/src/main/jni/logcat.cpp`（native `runLogcat`/`refreshFd` 回调）
> 🟦 daemon 模块 · native logcat 进程托管与日志文件复活

## 类职责

`object LogcatMonitor` 是 daemon 的**日志收集子系统**。它加载 native `daemon` 库，在后台协程里运行 native `runLogcat`（持续 `logcat` 子进程），管理 modules 与 verbose 两路日志文件 FD，提供 LRU 滚动、被外部删除后的 `/proc/self/fd` 复活、verbose 启停与刷新命令，以及启动期的 getprop/dmesg 转储。

## 关键字段

| 字段 | 含义 |
| :--- | :--- |
| `modulesFd` / `verboseFd` | 当前两路日志的 detached FD，`-1` 表示无 |
| `isRunning` | `@Volatile`，`runLogcat` 是否在跑 |
| `moduleLogs` / `verboseLogs` | `ThreadSafeLRU(10)`，滚动删除最旧日志 |
| `FD_MODE` | `WRITE_ONLY or CREATE or TRUNCATE or APPEND` |

## native 桥与初始化

```kotlin
private external fun runLogcat()
@Suppress("unused") private fun refreshFd(isVerboseLog: Boolean): Int
```

`init` 块：`loadNativeLibrary()`（从 `java.class.path!/lib/$abi/libdaemon.so` 加载）、`FileSystem.moveLogDir()`、Meizu `log_reject_level` workaround、`dumpPropsAndDmesg()`。`refreshFd` 由 native 端通过 JNI 回调，用于在 logcat 进程需要新文件时分配 FD。

## ThreadSafeLRU

```kotlin
private class ThreadSafeLRU(private val maxEntries: Int = 10) {
    private val map = LinkedHashMap<File, Unit>(maxEntries, 1f, false)  // 访问序=false → 插入序 LRU
    @Synchronized fun add(file: File)
}
```

`add` 超容量时删 `map.keys.first()`（最旧）并删文件。

## 启动与启停

```kotlin
fun start()
fun startVerbose() = Log.i(TAG, "!!start_verbose!!")
fun stopVerbose() = Log.i(TAG, "!!stop_verbose!!")
fun refresh(isVerboseLog: Boolean)  // "!!refresh_verbose!!" / "!!refresh_modules!!"
fun checkLogFile()
```

`start` 在 `VectorDaemon.scope` 协程里 `runLogcat()` 阻塞直到 native logcat 进程死亡。verbose 启停/刷新通过向 logcat 写特殊标记字符串实现（native 端识别）。

## FD 复活机制

```kotlin
private fun checkFd(fd: Int)
private fun fdToPath(fd: Int) = if (fd == -1) null else Paths.get("/proc/self/fd", fd.toString())
```

`checkFd` 用反射 `FileDescriptor.setInt$(fd)` 构造 `jfd`，`Os.fstat` 检查 `st_nlink == 0`（文件被删但 FD 仍打开）：读符号链接拿到原路径，必要时 `chattr0` 清不可变属性后重建父目录，把原文件名（去掉空格后的部分）复制回原位置，使外部进程（如管理器 UI）能再次通过路径访问。`refreshFd` 在分配新 FD 前先 `checkFd` 旧 FD 做复活。

## getprop/dmesg 转储

```kotlin
private fun dumpPropsAndDmesg()
```

`getprop` 转储前临时 `setFSCreateContext("u:object_r:app_data_file:s0")` 并把线程 SELinux 上下文切到 `u:r:untrusted_app:s0`，以过滤隐私属性；完成后复位。`dmesg` 直接重定向到 `FileSystem.getKmsgPath()`。

## 日志读取接口

```kotlin
fun getVerboseLog(): File? = fdToPath(verboseFd)?.toFile()
fun getModulesLog(): File? = fdToPath(modulesFd)?.toFile()
```

供 `ManagerService.getVerboseLog/getModulesLog` 返回 PFD，也供 `CliSocketServer` 的 `log/stream` 直接传 FD。

## 日志流转

```mermaid
flowchart TD
    Start["start"] --> NL["native runLogcat"]
    NL -->|需要新文件| Ref["refreshFd(isVerbose)"]
    Ref --> Chk["checkFd 旧 FD"]
    Chk -->|st_nlink==0| Rez["从 /proc/self/fd 复活文件"]
    Ref --> New["新 LRU 文件 + detachFd"]
    New --> Store["modulesFd/verboseFd"]
    NL -->|logcat 输出| Store
    UI["ManagerService / CLI"] -->|读路径| Store

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class NL,Ref,Chk,Rez,New,Store class vec
    class Start class plain
    class UI class plain
```

## 相关

- [VectorDaemon · 拉起 LogcatMonitor / stopVerbose](./vector-daemon)
- [ManagerService · 日志 API](./manager-service)
- [CliSocketServer · log/stream](./cli-socket-server)
- native logcat 实现见 [native · dex2oat/env](../native-framework)
