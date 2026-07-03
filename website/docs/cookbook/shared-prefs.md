# 🔗 跨进程共享配置

> 难度 ⭐⭐ · 让被 Hook 的应用读到模块写的配置。

## 场景

模块 UI 里用户设了开关，目标应用里的 Hook 逻辑要读到这个开关决定行为。

## 问题

Android 7.0 起的 SELinux 隔离让目标应用**读不到模块的 `/data/data` 目录**。原版 Xposed 的 `MODE_WORLD_READABLE` 直接抛 `SecurityException`。

## Vector 的解法

不用 IPC，用 Daemon 预配的 **`xposed_data` SELinux 安全区**：

```mermaid
graph LR
    UI["模块 UI 进程<br/>写配置"]:::write
    SAFE["Daemon 预配 xposed_data 安全区<br/>SELinux 宽松"]:::safe
    APP["目标应用进程<br/>XSharedPreferences 直读"]:::read
    UI -->|PreferenceManager 写<br/>框架重定向 getPreferencesDir| SAFE
    APP -->|FileInputStream 直读<br/>无 IPC| SAFE
    SAFE -.inotify ENTRY_MODIFY.-> WD["sWatcherDaemon 线程"]
    WD -->|校验哈希+派发回调| APP
    classDef write fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef safe fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef read fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
```

## 模块侧（写）

1. 在 `AndroidManifest.xml` 声明：

```xml
<meta-data android:name="xposedsharedprefs" android:value="true" />
```

或声明 `xposedminversion` 大于 92。

2. 照常写配置：

```kotlin
val prefs = PreferenceManager.getDefaultSharedPreferences(context)
prefs.edit().putBoolean("enable_feature", true).apply()
// 框架透明地把文件写到安全区，你不用管
```

## 目标应用侧（读）

```kotlin
val prefs = XSharedPreferences("com.example.mymodule", "my_prefs")
prefs.makeWorldReadable()   // 空操作，仅兼容
prefs.reload()
val enabled = prefs.getBoolean("enable_feature", false)
```

## 实时监听变更

```kotlin
prefs.registerOnSharedPreferenceChangeListener { _, key ->
    if (key == "enable_feature") {
        // 重新读取并调整 Hook 行为
    }
}
```

底层 `sWatcherDaemon` 线程用 `inotify` 监视安全区，文件变化时校验哈希并派发回调，你无需自己实现文件监视。

## 相关

- [资源与偏好](../developer/resources)
- [legacy · XSharedPreferences](../reference/classes/legacy-api)
- [架构 · legacy · SharedPreferences](../architecture/legacy#sharedpreferences-与-selinux-边界)
