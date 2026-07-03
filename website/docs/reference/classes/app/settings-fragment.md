# ⚙️ SettingsFragment

> 📂 `app/src/main/java/org/lsposed/manager/ui/fragment/SettingsFragment.java`
> 🟦 app 模块 · 设置页

## 类职责

`public class SettingsFragment extends BaseFragment` 是设置页外壳。它只负责工具栏与副标题（激活时显示框架版本，否则显示管理器版本 + 未安装），真正的偏好项由内部类 `PreferenceFragment extends PreferenceFragmentCompat` 从 `R.xml.prefs` 加载并逐项绑定逻辑。

副标题格式：`getXposedVersionName() (getXposedVersionCode())` 或 `BuildConfig.VERSION_NAME (BuildConfig.VERSION_CODE) - 未安装`。

## 内部类 PreferenceFragment

```java
public static class PreferenceFragment extends PreferenceFragmentCompat
```

`onCreatePreferences` 加载 `prefs.xml` 后，逐项 `findPreference` 并按 `ConfigManager.isBinderAlive()`（`installed`）控制可见性/启用态：

| Preference key | 行为 |
| :--- | :--- |
| `disable_verbose_log` | DEBUG 构建强制关闭；否则 `setVerboseLogEnabled(!(boolean)newValue)` |
| `enable_status_notification` | `installed` 时可见，`setEnableStatusNotification` |
| `add_shortcut` | 仅寄生模式可见，`ShortcutUtil.requestPinLaunchShortcut` |
| `backup` / `restore` | `installed` 时启用，分别 `CreateDocument("application/gzip")` / `OpenDocument`，回调 `BackupUtils.backup/restore` |
| `dark_theme` | `AppCompatDelegate.setDefaultNightMode(ThemeUtil.getDarkTheme(newValue))` |
| `black_dark_theme` / `theme_color` / `follow_system_accent` / `language` | 变更后 `MainActivity.restart()` 重建 |
| `show_hidden_icon_apps_enabled` | API≥29，`ConfigManager.setHiddenIcon(!(boolean)newValue)` |
| `doh` | 若 `CloudflareDNS.noProxy` 为 false 则整组隐藏；否则 `dns.DoH = newValue` |
| `update_channel` | `RepoLoader.updateLatestVersion(newValue)` |
| `translation` | 打开 Crowdin 链接 |

备份/恢复用 `ActivityResultLauncher`，文件名格式 `LSPosed_<timestamp>.lsp`，异常时 `showHint` 报错文案。

## 外壳 Fragment

```java
@Nullable @Override
public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState)
@Override public void onDestroyView()
```

`onCreateView` 首次创建时以子 Fragment 形式 add `PreferenceFragment` 到 `R.id.setting_container`。`onDestroyView` 清空 `binding` 引用防泄漏。

## PreferenceFragment 生命周期

```java
@Override public void onAttach(@NonNull Context context)   // 取 parentFragment 引用
@Override public void onDetach()                           // 置空 parentFragment
@NonNull @Override public RecyclerView onCreateRecyclerView(...)  // BorderRecyclerView + 边界监听
```

`onCreateRecyclerView` 把边界显隐回调绑定到外壳 `appBar.setLifted`，并让外壳工具栏/clickView 点击时平滑滚动到顶部。

## 备份/恢复 launcher

```java
ActivityResultLauncher<String> backupLauncher = registerForActivityResult(
    new ActivityResultContracts.CreateDocument("application/gzip"), uri -> {...});
ActivityResultLauncher<String[]> restoreLauncher = registerForActivityResult(
    new ActivityResultContracts.OpenDocument(), uri -> {...});
```

两个 launcher 都在 `parentFragment.runAsync` 里调 `BackupUtils.backup/restore`，异常时 `showHint` 报错（`settings_backup_failed2` / `settings_restore_failed2`）。备份文件名 `LSPosed_<timestamp>.lsp`；恢复接受 `*/*`。

## 主题与语言联动

`dark_theme`、`black_dark_theme`、`theme_color`、`follow_system_accent`、`language` 五项变更后都调用 `((MainActivity)getActivity()).restart()`——因为主题/语言需重建 Activity 才生效。`follow_system_accent` 勾选时隐藏 `theme_color` 项；`language` 变更还会 `LocaleDelegate.setDefaultLocale` + `res.updateConfiguration`。

`show_hidden_icon_apps_enabled` 读取系统 `Settings.Global` 当前值作为初始勾选态（`!= 0`），变更时调 `ConfigManager.setHiddenIcon`（取反，因为偏好语义与系统相反）。

## 偏好与功能映射

```mermaid
flowchart TD
    A["PreferenceFragment.onCreatePreferences"] --> B["installed = isBinderAlive"]
    B --> C["逐项 findPreference"]
    C --> D1["verbose / notification<br/>→ ConfigManager"]
    C --> D2["backup / restore<br/>→ BackupUtils + SAF"]
    C --> D3["dark_theme / theme_color /<br/>language / accent<br/>→ MainActivity.restart()"]
    C --> D4["doh → CloudflareDNS"]
    C --> D5["update_channel<br/>→ RepoLoader.updateLatestVersion"]
    C --> D6["add_shortcut<br/>→ ShortcutUtil"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    class A,B,C class core
    class D1,D2,D3,D4,D5,D6 class ipc
```

## doh 与翻译项

`doh` 偏好：先从 `App.getOkHttpClient().dns()` 取 `CloudflareDNS` 实例，若 `noProxy` 为 false（用户设了代理，DoH 无法生效）则禁用并隐藏该偏好项及其所在组；否则 `dns.DoH = newValue`。`translation` 点击打开 `https://crowdin.com/project/lsposed_jingmatrix`，副标题用 `settings_translation_summary` 拼接 app 名；`translation_contributors` 用 `translators` 字符串渲染，为 `"null"` 时隐藏。

## update_channel 与 show_hidden_icons

`update_channel`（`SimpleMenuPreference`）变更调 `repoLoader.updateLatestVersion(newValue)` 重新按新通道计算各模块最新版。`show_hidden_icon_apps_enabled` 仅 API≥29 显示，`installed` 时 `setOnPreferenceChangeListener` 调 `ConfigManager.setHiddenIcon(!(boolean)newValue)`（偏好语义与系统设置相反），初始勾选态读 `Settings.Global show_hidden_icon_apps_enabled != 0`。

## 相关

- [BackupUtils · 备份恢复](./backup-utils)
- [ThemeUtil · 主题常量](./theme-util)
- [RepoLoader · update_channel 联动](./repo-loader)
- [ConfigManager · 偏好后端](./config-manager)
