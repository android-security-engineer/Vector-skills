# ⚙️ Dex2OatServer

> 📂 `daemon/src/main/kotlin/org/matrix/vector/daemon/env/Dex2OatServer.kt`
> 🟦 daemon 模块 · dex2oat 包装器与 SELinux 自愈

## 类职责

`object Dex2OatServer` 负责**接管系统的 dex2oat 调用**，让 Vector 的 `liboat_hook` 在编译期注入 ART，从而保证 hook 在方法被 AOT 内联前生效。它探测真实 dex2oat 二进制、打开其 FD、通过 native mount 把 wrapper 绑定到 apex 路径、监听 SELinux 状态变化自愈挂载，并用 abstract socket 向 C++ wrapper 进程派发 FD。

## 兼容状态常量

```kotlin
const val DEX2OAT_OK = 0
const val DEX2OAT_MOUNT_FAILED = 1
const val DEX2OAT_SEPOLICY_INCORRECT = 2
const val DEX2OAT_SELINUX_PERMISSIVE = 3
const val DEX2OAT_CRASHED = 4
```

`@Volatile var compatibility = DEX2OAT_OK` 由 `ManagerService.getDex2OatWrapperCompatibility` 暴露（Q 以下返回 0）。

## 路径与 FD 探测

```kotlin
private const val WRAPPER32 = "bin/dex2oat32"
private const val WRAPPER64 = "bin/dex2oat64"
private const val HOOKER32 = "bin/liboat_hook32.so"
private const val HOOKER64 = "bin/liboat_hook64.so"

private val dex2oatArray = arrayOfNulls<String>(6)  // 0:32 1:32d 2:64 3:64d 4:hook32 5:hook64
private val fdArray = arrayOfNulls<FileDescriptor>(6)
```

`init` 按 SDK 选路径：Q 用 `/apex/com.android.runtime/bin/dex2oat{,d,64,d64}`，11+ 用 `/apex/com.android.art/bin/dex2oat{32,d32,64,d64}`；hook 固定从 `/data/adb/modules/zygisk_vector/bin/liboat_hook{32,64}.so`。

`checkAndAddDex2Oat(path)` 读 ELF magic（`0x7F 'E' 'L' 'F'`），第 5 字节 `1`/`2` 区分 32/64 位，路径含 `dex2oatd` 为 debug 变体，映射到 index `0..3`，`Os.open(O_RDONLY)` 持有 FD。

## SELinux 观察与自愈

```kotlin
private val selinuxObserver = object : FileObserver(
    listOf(File("/sys/fs/selinux/enforce"), File("/sys/fs/selinux/policy")), CLOSE_WRITE) { ... }
```

`onEvent` 在 `compatibility != CRASHED` 时读 `enforce`：

- 非强制（permissive）→ 若当前 OK 则 `doMount(false)` 卸载，置 `SELINUX_PERMISSIVE`；
- `hasSePolicyErrors()`（untrusted_app 对 dex2oat_exec 的 execute/execute_no_trans 检查）→ 卸载并置 `SEPOLICY_INCORRECT`；
- 之前非 OK 现在恢复 → `doMount(true)` 重挂，仍 `notMounted()` 则 `doMount(false)` 置 `MOUNT_FAILED` 并停止观察，否则回 `OK`。

## 挂载与 socket 派发

```kotlin
private external fun doMountNative(enabled: Boolean, r32: String?, d32: String?, r64: String?, d64: String?)
private external fun setSockCreateContext(context: String?): Boolean
private external fun getSockPath(): String

private fun doMount(enabled: Boolean) = doMountNative(enabled, dex2oatArray[0], dex2oatArray[1], dex2oatArray[2], dex2oatArray[3])
private fun notMounted(): Boolean  // 比较 /proc/1/root$bin 与 wrapper 的 st_dev/st_ino
```

`start()`：先 `doMount(true)`，仍 `notMounted` 则 `doMount(false)` 置 `MOUNT_FAILED` 返回；否则启动 `selinuxObserver` 并触发一次 `onEvent`，然后协程跑 `runSocketLoop()`。

`runSocketLoop()`：

1. 按 `dex2oat:s0` 对 `dex2oat_exec` 的 `execute_no_trans` 检查决定 wrapper 与 socket 的创建上下文（`u:r:dex2oat:s0` 或 `u:r:installd:s0`）；
2. `setFileContext` 给 wrapper/hooker 设标签；
3. `LocalServerSocket(sockPath)` 接受 C++ wrapper 连接：读 `id`，若 `fdArray[id] != null` 则 `setFileDescriptorsForSend(arrayOf(fd))` + `write(1)` 把对应 dex2oat 二进制的 FD 经 SCM_RIGHTS 传给 wrapper；
4. `setSockCreateContext(null)` 复位；
5. 崩溃时若曾 OK 则 `doMount(false)` 卸载并置 `CRASHED`。

## 挂载与 FD 派发

```mermaid
flowchart TD
    Init["init: 探测 dex2oat/hook FD"] --> Start["start"]
    Start --> Mnt{"doMount + notMounted?"}
    Mnt -->|失败| MF["MOUNT_FAILED"]
    Mnt ->|成功| Obs["selinuxObserver"]
    Obs --> Loop["runSocketLoop"]
    Loop --> Wait["accept C++ wrapper"]
    Wait --> Send["setFileDescriptorsForSend + write(1)"]
    Send --> Wrapper["wrapper exec 真实 dex2oat + liboat_hook"]
    Obs -.->|enforce/policy 变更| Heal{"自愈挂载"}

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class Init,Start,Obs,Loop,Wait,Send,Wrapper class vec
    class Mnt,Heal class hot
    class MF class plain
```

## dex2oatArray 与 fdArray 布局

| index | 内容 |
| :--- | :--- |
| 0 | 32 位 release dex2oat |
| 1 | 32 位 debug dex2oatd |
| 2 | 64 位 release dex2oat |
| 3 | 64 位 debug dex2oatd |
| 4 | liboat_hook32.so |
| 5 | liboat_hook64.so |

`checkAndAddDex2Oat` 保证同位只保留首次发现的真实二进制（`dex2oatArray[index] == null` 才赋值），避免 debug/release 互相覆盖。socket 派发时 `id` 直接索引 `fdArray[id]`，C++ wrapper 据此选择对应架构的 dex2oat FD 与 hook 库。

## 相关

- [VectorDaemon · 拉起 Dex2OatServer](./vector-daemon)
- [ManagerService · getDex2OatWrapperCompatibility](./manager-service)
- [LogcatMonitor · 同属 env 守护](./logcat-monitor)
- dex2oat hook 实现见 [native · dex2oat](../dex2oat-hooker)
