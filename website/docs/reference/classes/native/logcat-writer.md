# 🧩 Logcat Writer（C++）

> 📂 `daemon/src/main/jni/logcat.cpp`
> 📂 `daemon/src/main/jni/logcat.h`
> 🟦 daemon 模块 · native logcat 零拷贝采集与 4MB 轮转

## 类职责

`class Logcat`（`daemon/src/main/jni/logcat.cpp`，匿名命名空间内）是 daemon 进程的**原生 logcat 采集引擎**。它通过 liblog 的 `android_logger_list_read` 阻塞读 logd 套接字，用 `writev` scatter-gather 零拷贝把每条日志格式化后写入文件，按 tag 路由到 `modules`/`verbose` 两条流，每条流满 **4MB 自动轮转**换 FD，并监听自身输出实现远程命令反馈环。

入口 `Java_org_matrix_vector_daemon_env_LogcatMonitor_runLogcat` 被 Kotlin `LogcatMonitor` 调起。

## 结构体与常量

```cpp
// logcat.h
#define LOGGER_ENTRY_MAX_LEN (5 * 1024)
constexpr size_t kMaxLogSize = 4 * 1024 * 1024;   // 4MB 每段触发轮转
constexpr long kLogBufferSize = 128 * 1024;       // 内部 logd 缓冲区 128KB

struct logger_entry { uint16_t len, hdr_size; int32_t pid; uint32_t tid, sec, nsec, lid, uid; };
struct log_msg { union alignas(4) { unsigned char buf[LOGGER_ENTRY_MAX_LEN+1]; logger_entry entry; }; };

// 优先级字符表
constexpr std::array<char, ANDROID_LOG_SILENT + 1> kLogChar = {'?','?','V','D','I','W','E','F','S'};
```

`log_msg` 是 `logger_entry` 与原始缓冲的 union，`alignas(4)` 保证 `entry.lid` 对齐。`kLogChar` 把 `android_LogPriority` 枚举转单字符前缀（V/D/I/W/E/F）。

## tag 路由表

```cpp
// 模块流（Xposed 模块日志），二分查找
constexpr auto kModuleTags = std::array{"VectorContext"sv, "VectorLegacyBridge"sv,
                                        "VectorModuleManager"sv, "XSharedPreferences"sv};
// verbose 流精确匹配
constexpr auto kExactTags = std::array{"APatchD"sv, "Dobby"sv, "KernelSU"sv, "LSPlant"sv,
                                       "LSPlt"sv, "Magisk"sv, "SELinux"sv, "TEESimulator"sv};
// verbose 流前缀匹配（动态组件）
constexpr auto kPrefixTags = std::array{"LSPosed"sv, "Vector"sv, "dex2oat"sv, "zygisk"sv};
```

三组 `std::array` 均有序，用 `std::binary_search`/`std::any_of` 做 O(log N)/O(N) 匹配。模块 tag 恒路由 modules 流；verbose 流还纳入当前 pid、CRASH 日志、精确/前缀匹配 tag。

## FastWrite 零拷贝

```cpp
size_t Logcat::FastWrite(const AndroidLogEntry& entry, int fd) {
    char time_buf[32], meta_buf[96];
    struct tm tm_info; time_t sec = entry.tv_sec;
    localtime_r(&sec, &tm_info);
    size_t t_len = strftime(time_buf, sizeof(time_buf), "%Y-%m-%dT%H:%M:%S", &tm_info);
    int m_len = snprintf(meta_buf, sizeof(meta_buf), ".%03ld %8d:%6d:%6d %c/%-15.*s ] ",
                         entry.tv_nsec/1000000, entry.uid, entry.pid, entry.tid,
                         kLogChar[entry.priority], (int)entry.tagLen, entry.tag);
    bool add_nl = (entry.messageLen == 0 || entry.message[entry.messageLen-1] != '\n');
    struct iovec iov[5] = {{(void*)"[ ", 2}, {time_buf, t_len}, {meta_buf, (size_t)m_len},
                           {(void*)entry.message, entry.messageLen},
                           {(void*)"\n", add_nl ? 1U : 0U}};
    ssize_t n = writev(fd, iov, 5);
    return (n <= 0) ? kMaxLogSize : (size_t)n;   // 失败返回 max 触发轮转
}
```

时间戳与元数据分别格式化到栈缓冲，再用 `writev` 一次系统调用 5 段 iovec——`[ ` + 时间 + `.ms pid:tid:uid P/tag ] ` + 消息 + 可选换行。**不拼接字符串、不拷贝 message**，直接以 `entry.message` 指针入 iovec。返回写入字节数累加到流的 `*_written_`；写失败返回 `kMaxLogSize` 强制轮转。

## 轮转 RefreshFd

```cpp
void Logcat::RefreshFd(bool is_verbose) {
    auto& fd_obj = is_verbose ? verbose_fd_ : modules_fd_;
    auto& part   = is_verbose ? verbose_part_ : modules_part_;
    if (fd_obj >= 0) write(fd_obj, "-----part %zu end----\n", part);  // 旧段收尾
    int new_fd = env_->CallIntMethod(thiz_, refresh_fd_method_, is_verbose);  // Kotlin 给新 FD
    fd_obj.reset(new_fd);   // UniqueFd 关旧 FD
    part++;
    write(fd_obj, "----part %zu start----\n", part);  // 新段开头
    // 重置 written 计数
}
```

满 4MB 或远程命令触发时换 FD。通过 JNI 回调 Kotlin `LogcatMonitor.refreshFd(boolean)` 拿新的 detached FD（Kotlin 侧管理文件命名/路径），`UniqueFd` RAII 关闭旧 FD。每段写收尾/开头标记便于分段阅读。

## ProcessBuffer 与反馈环

```cpp
void Logcat::ProcessBuffer(struct log_msg* buf) {
    AndroidLogEntry entry;
    if (android_log_processLogBuffer(&buf->entry, &entry) < 0) return;
    std::string_view tag(entry.tag, entry.tagLen > 0 ? entry.tagLen - 1 : 0);  // 零拷贝 tag
    bool is_module = std::binary_search(kModuleTags.begin(), kModuleTags.end(), tag);
    if (is_module) modules_written_ += FastWrite(entry, modules_fd_);
    // verbose 流过滤...
    if (verbose_enabled_) verbose_written_ += FastWrite(entry, verbose_fd_);

    // 监听自身输出做远程命令
    if (entry.pid == my_pid_ && tag == "VectorLogcat"sv) {
        std::string_view msg(entry.message, entry.messageLen);
        if (msg == "!!start_verbose!!") verbose_enabled_ = true;
        else if (msg == "!!stop_verbose!!") verbose_enabled_ = false;
        else if (msg == "!!refresh_modules!!") RefreshFd(false);
        else if (msg == "!!refresh_verbose!!") RefreshFd(true);
    }
}
```

tag 用 `string_view` 直接指向 `entry.tag`（去掉 null 终止），零拷贝。**反馈环**：daemon 监听自己 pid 输出、tag 为 `VectorLogcat` 的消息，作为远程控制通道——外部往 logcat 写特定咒语即可开关 verbose 流或强制轮转。

## Run 主循环与崩溃恢复

```cpp
[[noreturn]] void Logcat::Run() {
    size_t tail = 0;
    RefreshFd(true); RefreshFd(false);
    while (true) {
        auto* list = android_logger_list_alloc(0, tail, 0);  tail = 10;
        for (log_id_t id : {LOG_ID_MAIN, LOG_ID_CRASH}) {
            auto* logger = android_logger_open(list, id);
            if (logger && android_logger_get_log_size(logger) < kLogBufferSize)
                android_logger_set_log_size(logger, kLogBufferSize);  // 扩到 128KB
        }
        struct log_msg msg;
        while (android_logger_list_read(list, &msg) > 0) {  // 阻塞读
            ProcessBuffer(&msg);
            if (modules_written_ >= kMaxLogSize) [[unlikely]] RefreshFd(false);
            if (verbose_written_  >= kMaxLogSize) [[unlikely]] RefreshFd(true);
        }
        android_logger_list_free(list);
        OnCrash(errno);   // logd 崩溃：重试/ctl.restart logd
    }
}
```

`android_logger_list_read` 阻塞等新日志。读返回 ≤0 视为 logd 异常，`OnCrash` 计数累加，达阈值 `__system_property_set("ctl.restart","logd")` 重启 logd，指数退避（`restart_wait <<= 1`，上限 1024）。重连时 `tail=10` 带 10 行历史便于排查崩溃本身。

## 采集与轮转流程

```mermaid
flowchart TD
    A["runLogcat 入口"] --> B["RefreshFd 初始化双流 FD"]
    B --> C["android_logger_list_alloc<br/>开 MAIN+CRASH 流"]
    C --> D["android_logger_list_read 阻塞"]
    D --> E["ProcessBuffer"]
    E --> F["binary_search tag 路由"]
    F --> G["FastWrite writev 5 段"]
    G --> H{"written >= 4MB?"}
    H -- 是 --> I["RefreshFd 换段"]
    H -- 否 --> J{"VectorLogcat 咒语?"}
    J -- 是 --> K["开关 verbose / 强制轮转"]
    I --> D
    K --> D
    J -- 否 --> D
    D -- 读失败 --> L["OnCrash<br/>ctl.restart logd"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class F,G,I,K class vec
    class H,J class hot
    class A,B,C,D,E,L class plain
```

## 相关

- [daemon-jni.md · daemon JNI 层](../daemon-jni) — `LogcatMonitor` 的 JNI 总览
- [logcat-monitor.md · Kotlin 侧](../daemon/logcat-monitor) — `refreshFd` 的 Java 宿主
- [daemon-socket.md · dex2oat socket](./daemon-socket) — 同属 daemon 原生 IPC
- [native-core · native 总览](../native-core)
