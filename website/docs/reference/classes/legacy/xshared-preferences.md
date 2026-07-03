# 📋 XSharedPreferences

> 📂 `legacy/src/main/java/de/robv/android/xposed/XSharedPreferences.java`
> 🟦 legacy 模块 · 跨进程只读偏好读取

## 类职责

`public final class XSharedPreferences implements SharedPreferences` 是 Xposed 生态的**跨进程偏好读取器**。它复刻了 AOSP `SharedPreferencesImpl` 的语义但只读、不写，且针对 SELinux 受限环境做了三件事：通过 `SELinuxHelper` 服务安全区直读、用 inotify/`WatchService` 监听文件变更触发回调、对新模块（`xposedminversion>92` 或声明 `xposedsharedprefs`）走 Vector 的统一 prefs 路径而非旧的数据目录路径。

## 构造与路径解析

```java
public XSharedPreferences(File prefFile)                                     // 直接指定文件
public XSharedPreferences(String packageName)                                // 默认 _preferences 文件
public XSharedPreferences(String packageName, String prefFileName)           // 指定文件名（不带 .xml）
```

三参构造的路径决策是核心：从 `XposedInit.getLoadedModules()` 取该包是否为 legacy 模块及 apk 路径，再用 `VectorMetaDataReader` 读 manifest 的 `xposedminversion` 与 `xposedsharedprefs`。

| 条件 | 路径 |
| :--- | :--- |
| 新模块（`xposedminversion>92` 或 `xposedsharedprefs`） | `VectorServiceClient.getPrefsPath(packageName)/<file>.xml` |
| 旧模块或非模块 | `Environment.getDataDirectory()/data/<pkg>/shared_prefs/<file>.xml` |

新模块路径走 Vector Daemon 提供的安全区，避免应用私有目录 SELinux 拒绝。

## 安全区读取

```java
private void loadFromDiskLocked()                    // 异步线程加载
public synchronized void reload()                    // 文件变更时重载
public synchronized boolean hasFileChanged()         // statFile 比较 mtime/size
```

`loadFromDiskLocked` 通过 `SELinuxHelper.getAppDataFileService().getFileInputStream(filename, mFileSize, mLastModified)` 取 `FileResult`：服务端会比较客户端传入的 `mFileSize`/`mLastModified`，若未变化则返回 `stream==null`，客户端保留旧 `mMap`，避免无谓重解析。XML 解析走反射拿到的 `com.android.internal.util.XmlUtils.readMapXml`（`sReadMapXmlMethod`，类初始化时反射获取并 `setAccessible`），`performReadMapXml` 解包 `InvocationTargetException` 的真实 cause。

## inotify 监听

```java
private void tryRegisterWatcher()                    // 注册 WatchService
private void tryUnregisterWatcher()                  // 注销并按需关闭 WatchService
public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener)
public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener)
```

`tryRegisterWatcher` 在 prefs 文件**父目录**上注册 `ENTRY_CREATE/MODIFY/DELETE` 事件。监听由静态 daemon 线程 `XSharedPreferences-Daemon` 驱动：

- 同时处理真实文件与 `.bak` 备份文件（应对罕见的写-改名竞态）：`.bak` 只在 `ENTRY_DELETE` 时触发，普通文件在存在 `.bak` 时被跳过
- 触发时用 `PrefsData.hasChanged()` 二次校验（先比 size 再比 MD5 hash），避免误报
- 校验通过后对每个 listener 调 `onSharedPreferenceChanged(prefs, null)`（key 恒为 null，无法定位具体变更项）

最后一个 listener 注销时关闭 `WatchService`（仅当没有任何有效 key 时）。

## PrefsData 变更检测

```java
private static class PrefsData {
    public final XSharedPreferences mPrefs;
    public boolean hasChanged();   // size 变 → 重算 hash；size 同 → 比 hash
}
```

| 检测阶段 | 方法 | 判定 |
| :--- | :--- | :--- |
| 1 | `tryGetFileSize` | size<1 视为空文件，忽略 |
| 2 | size 比较 | 变化则重算 hash 并返回 true |
| 3 | `tryGetFileHash`（MD5） | hash 不同返回 true |

## makeWorldReadable 与权限

```java
@SuppressLint("SetWorldReadable")
public boolean makeWorldReadable()
public File getFile()
```

`makeWorldReadable` 仅在 `SELinuxHelper.getAppDataFileService().hasDirectFileAccess()` 为真时有效：对文件和父目录 `setReadable(true, false)`，并在有 listener 时注册 watcher。文档明确警告这只是对部分 recovery "权限修复"的兜底，不能替代模块 UI 用 `MODE_WORLD_READABLE` 打开。

## SharedPreferences 实现

只读实现所有 getter：`getAll/getString/getStringSet/getInt/getLong/getFloat/getBoolean/contains`，每个都先 `awaitLoadedLocked()`（`wait()` 直到 `mLoaded=true`）再从 `mMap` 取值。`edit()` 抛 `UnsupportedOperationException("read-only implementation")`。

## 读取与监听流程

```mermaid
flowchart TD
    A["模块构造 XSharedPreferences"] --> B{"新模块?<br/>xposedminversion>92"}
    B -->|"是"| C["路径=VectorServiceClient.getPrefsPath"]
    B -->|"否"| D["路径=data/.../shared_prefs"]
    C --> E["startLoadFromDisk 异步线程"]
    D --> E
    E --> F["SELinuxHelper.getFileInputStream<br/>(size+mtime 增量判断)"]
    F --> G{"stream==null?<br/>未变化"}
    G -->|"是"| H["保留旧 mMap"]
    G -->|"否"| I["XmlUtils.readMapXml 解析"]
    I --> J["更新 mMap/mLastModified/mFileSize"]
    H --> K["mLoaded=true, notifyAll"]
    J --> K
    K --> L["getter 调用 awaitLoadedLocked"]
    M["registerOnSharedPreferenceChangeListener"] --> N["tryRegisterWatcher<br/>监听父目录"]
    N --> O["daemon 线程 take 事件"]
    O --> P["PrefsData.hasChanged<br/>size+MD5 二次校验"]
    P -->|"已变"| Q["触发 listener.onSharedPreferenceChanged<br/>(key=null)"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class F,I,N,P class vec
    class B,G class hot
    class A,C,D,E,H,J,K,L,M,O,Q class plain
```

## 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `sReadMapXmlMethod` | `static Method` | 反射缓存的 `XmlUtils.readMapXml` |
| `sWatcherKeyInstances` | `HashMap<WatchKey,PrefsData>` | 全局 watch key → PrefsData |
| `sWatcher` / `sWatcherDaemon` | `WatchService` / `Thread` | 单例监听服务与守护线程 |
| `mMap` | `Map<String,Object>` | 内存中的偏好快照 |
| `mLastModified` / `mFileSize` | `long` | 上次加载的 stat，增量判断依据 |

## 相关

- [XposedInit · 模块加载](./xposed-init) — `loadedModules` 是路径决策依据
- [XposedHelpers · 工具集](./xposed-helpers) — `VectorMetaDataReader` 萃取 manifest
- [legacy-resources · 资源 hook](../legacy-resources)
