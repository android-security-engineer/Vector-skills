# 资源与偏好

模块常常需要两件事：**改应用的资源**（替换图标、字符串、布局），以及**和目标应用共享配置**（让被 Hook 的应用读到模块的设置）。Vector 都提供了机制，但实现路径截然不同。

## 资源替换

资源 Hook 的底层原理见 [资源 Hook 子系统](../architecture/resources)。这里只讲模块开发者怎么用。

### 经典 API

实现 `IXposedHookInitPackageResources`：

```kotlin
class ResHook : IXposedHookInitPackageResources {
    override fun handleInitPackageResources(resparam: XC_InitPackageResources.InitPackageResourcesParam) {
        if (resparam.packageName != "com.target.app") return

        // 替换字符串
        resparam.res.setReplacement(
            "com.target.app", "string", "app_name", "Hacked App"
        )

        // 替换图片
        resparam.res.setReplacement(
            "com.target.app", "drawable", "icon", R.drawable.my_icon
        )

        // 替换布局
        resparam.res.setReplacement(
            "com.target.app", "layout", "main_activity", R.layout.my_layout
        )
    }
}
```

`setReplacement` 注册后，框架用**无锁 bitmask 缓存**做 O(1) 快速判断，命中才查 `sReplacements` map，高频资源请求不会拖慢 UI 线程。

### 布局替换的代价

布局替换会触发 native 层的**二进制 XML 突变**——`ResXMLParser` 遍历时原地改写属性 ID。这是首次膨胀某布局时发生的，之后会被缓存。所以布局替换的性能开销主要在首次加载，不会持续。

## SharedPreferences 跨进程共享

### 问题

模块的 UI 进程写了配置，被 Hook 的目标应用进程要读它。但 Android 7.0 起的 SELinux 隔离让目标应用**读不到模块的 `/data/data` 目录**。

### Vector 的解法

Vector 不用 IPC 实时传配置，而是用一个 Daemon 预配的 **SELinux 宽松安全区**目录。模块写、应用读，都指向这个目录。

### 模块侧要做什么

要让你的模块用上这个机制，在 `AndroidManifest.xml` 的 Xposed meta-data 里声明：

```xml
<meta-data android:name="xposedsharedprefs" android:value="true" />
```

或者声明 `xposedminversion` 大于 92。满足任一条件，框架就会自动：

1. **hook 掉 `checkMode`**：抑制 `MODE_WORLD_READABLE` 的 `SecurityException`。
2. **hook 掉 `getPreferencesDir`**：把偏好目录重定向到安全区。

你的模块代码照常用 `PreferenceManager.getDefaultSharedPreferences(context)` 读写即可，**框架透明地把它写到安全区**。

### 目标应用侧读取

目标应用里用 `XSharedPreferences` 读：

```kotlin
val prefs = XSharedPreferences("com.example.mymodule", "my_prefs")
prefs.makeWorldReadable()  // 实际是空操作，仅兼容
prefs.reload()
val value = prefs.getString("key", "default")
```

`XSharedPreferences` 在 Vector 上直接走 `FileInputStream` 读安全区文件，**无 IPC 开销**。

### 实时更新监听

如果你想让目标应用在模块改了配置后**实时**收到通知，注册监听器：

```kotlin
prefs.registerOnSharedPreferenceChangeListener { _, key ->
    // 配置变了
}
```

底层框架会启动一个 `sWatcherDaemon` 线程，用 `inotify` 监视安全区目录，文件变化时校验哈希并派发回调。你不用自己实现文件监视。

```mermaid
graph LR
    UI["模块 UI 进程<br/>写配置"]:::write
    SAFE["Daemon 预配的 xposed_data 安全区<br/>（SELinux 宽松）"]:::safe
    APP["目标应用进程<br/>XSharedPreferences 直读"]:::read
    UI -->|PreferenceManager 写<br/>框架重定向 getPreferencesDir| SAFE
    APP -->|FileInputStream 直读<br/>无 IPC| SAFE
    SAFE -.inotify ENTRY_MODIFY.-> WD["sWatcherDaemon 线程"]
    WD -->|校验哈希 + 派发回调| APP
    classDef write fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef safe fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef read fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
```

## 小结

| 需求 | 机制 | 开发者要做的 |
| :--- | :--- | :--- |
| 改字符串/图片 | `setReplacement` + bitmask 缓存 | 调 `setReplacement` |
| 改布局 | `setReplacement` + 二进制 XML 突变 | 调 `setReplacement` |
| 写模块配置 | 重定向到 `xposed_data` 安全区 | 声明 `xposedsharedprefs` |
| 目标应用读配置 | `XSharedPreferences` 直读安全区 | 照常 `XSharedPreferences` |
| 实时通知 | inotify 监视 + 回调派发 | 注册 listener |
