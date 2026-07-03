# app · ui/fragment 包

> 📂 `app/src/main/java/org/lsposed/manager/ui/fragment/`
> 🟦 管理器的各功能页面（Fragment）

## 包职责

实现管理器的全部功能页面：首页、模块、日志、仓库、设置、作用域列表，以及模块详情、编译对话框、安装选模块对话框。采用 Navigation Component 单 Activity + 多 Fragment 架构，由 `MainActivity` 的 `NavHostFragment` 托管。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`BaseFragment`](#basefragment) | Fragment 抽象基类：导航、工具栏、异步、提示 |
| [`HomeFragment`](#homefragment) | 首页：状态卡片、设备信息、关于对话框 |
| [`ModulesFragment`](#modulesfragment) | 模块列表页：按用户分页、启用/卸载/编译 |
| [`LogsFragment`](#logsfragment) | 日志页：verbose/module 两 Tab、保存/清空 |
| [`RepoFragment`](#repofragment) | 在线仓库列表页 |
| [`SettingsFragment`](#settingsfragment) | 设置页（含 `PreferenceFragment` 内部类） |
| [`AppListFragment`](#applistfragment) | 作用域列表页：为模块勾选生效应用 |
| [`CompileDialogFragment`](#compiledialogfragment) | 触发 dex 优化的对话框 |
| [`RecyclerViewDialogFragment`](#recyclerviewdialogfragment) | "安装模块到其他用户"的选模块对话框 |
| [`RepoItemFragment`](#repoitemfragment) | 模块详情页：README/Releases/Information 三 Tab |

```mermaid
graph TD
    BASE["BaseFragment<br/>(抽象基类)"]:::ui
    HOME["HomeFragment"]:::ui
    MOD["ModulesFragment"]:::ui
    LOG["LogsFragment"]:::ui
    REPO["RepoFragment"]:::ui
    SET["SettingsFragment"]:::ui
    APP["AppListFragment"]:::ui
    RI["RepoItemFragment"]:::ui
    CD["CompileDialogFragment"]:::ui
    RV["RecyclerViewDialogFragment"]:::ui

    BASE <|-- HOME
    BASE <|-- MOD
    BASE <|-- LOG
    BASE <|-- REPO
    BASE <|-- SET
    BASE <|-- APP
    BASE <|-- RI
    MOD -- "show" --> CD
    MOD -- "show" --> RV
    MOD -- "navigate" --> APP
    REPO -- "navigate" --> RI

    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
```

---

## BaseFragment

`public abstract class BaseFragment extends Fragment` — **Fragment 抽象基类**。封装导航跳转、工具栏装配、异步执行、Snackbar/Toast 提示等通用能力，所有功能页继承它。

### 导航

```java
public void navigateUp()
public NavController getNavController()                                  // NavHostFragment.findNavController(this)

// 安全导航：IllegalArgumentException 时返回 false；动画关闭时用空 NavOptions
public boolean safeNavigate(@IdRes int resId)
public boolean safeNavigate(NavDirections direction)
```

`safeNavigate` 先查 `AccessibilityUtils.isAnimationEnabled`，关闭动画时构造无动画 `NavOptions`。

### 工具栏

```java
// 多个重载，最终汇聚到：
public void setupToolbar(Toolbar toolbar, View tipsView, String title, int menu, View.OnClickListener navigationOnClickListener)
```

设返回按钮（`navigateUp` 或自定义）、标题、tooltip；`menu != -1` 时 inflate 菜单，若 Fragment 实现 `MenuProvider` 则绑定 `onMenuItemSelected` 并调 `onPrepareMenu`。

### 异步与 UI 线程

```java
public void runAsync(Runnable runnable)                                  // App.getExecutorService()
public <T> Future<T> runAsync(Callable<T> callable)
public void runOnUiThread(Runnable runnable)                             // App.getMainHandler()
public <T> Future<T> runOnUiThread(Callable<T> callable)
```

### 提示 showHint

```java
public void showHint(@StringRes int res, boolean lengthShort)
public void showHint(CharSequence str, boolean lengthShort, CharSequence actionStr, View.OnClickListener action)
// ...多个重载
```

已 resume 且有容器时弹 `Snackbar`（FAB 可见时设为 anchor）；否则回退 `Toast`。支持带动作按钮。

---

## HomeFragment

`public class HomeFragment extends BaseFragment implements MenuProvider` — **首页**。展示框架激活状态、设备/系统信息、更新提示、SEPolicy/dex2oat 异常警告，并提供"关于"对话框。

### 关键流程

- `onCreate`：`WelcomeDialog.showIfNeed(getChildFragmentManager())`。
- `onCreateView`：绑定 `FragmentHomeBinding`，设工具栏（点击工具栏/标题区弹关于），调 `updateStates(...)`。
- `updateStates(activity, binderAlive, needUpdate)`：

| 状态 | 显示 |
| :--- | :--- |
| Binder 活 + 需更新 | 更新卡片 + "请更新"按钮 |
| Binder 活 + SEPolicy/系统注入/dex2oat 异常 | "部分激活" + 警告卡片 |
| Binder 活 + 一切正常 | "已激活" + 勾选图标 |
| Binder 死 + Magisk 已装 | "安装"卡片 |
| Binder 死 + 无 Magisk | "未安装" |

信息区填 API 版本、框架版本、管理器包名、dex2oat 兼容性（按 `DEX2OAT_OK/CRASHED/MOUNT_FAILED/...` 分支）、系统版本、设备、ABI。`copyInfo` 按钮把全部信息复制到剪贴板。

### 关于对话框 AboutDialog

静态内部类 `AboutDialog extends DialogFragment`，用 `DialogAboutBinding` 渲染版本号与 GitHub/Telegram 链接（经 `LinkTransformationMethod` 让链接走 Custom Tabs），用 `BlurBehindDialogBuilder` 构建。

### isDeveloper

`isDeveloper()` 检查 `/data/local/tmp/.studio/ipids` 目录下是否有存活进程（Android Studio 调试器留下的 PID 文件），据此显示开发者警告卡片。

---

## ModulesFragment

`public class ModulesFragment extends BaseFragment implements ModuleUtil.ModuleListener, RepoLoader.RepoListener, MenuProvider` — **模块列表页**。按用户分 ViewPager2（多用户时显示 Tab，单用户隐藏），每页一个 `ModuleListFragment`，FAB 弹"安装到其他用户"对话框。

### 主要方法

```java
@Override public void onModulesReloaded()            // 按用户列表重建 adapters
@Override public void onSingleModuleReloaded(ModuleUtil.InstalledModule module)
@Override public void onRepoLoaded()                 // 刷新可升级提示
void installModuleToUser(ModuleUtil.InstalledModule module, UserInfo user)  // 调 ConfigManager.installExistingPackageAsUser
@Override public boolean onContextItemSelected(@NonNull MenuItem item)
```

### 上下文菜单 `onContextItemSelected`

| 菜单项 | 行为 |
| :--- | :--- |
| `menu_launch` | `AppHelper.getSettingsIntent` 启动模块设置 Activity |
| `menu_other_app` | `ACTION_SHOW_APP_INFO` |
| `menu_app_info` | 应用详情页 |
| `menu_uninstall` | `ConfigManager.uninstallPackage` |
| `menu_repo` | 导航到仓库详情（`lsposed://repo?modulePackageName=...`） |
| `menu_compile_speed` | `CompileDialogFragment.speed(...)` |

### 内部类

- **`ModuleListFragment`**：单用户列表页，绑定 `SwiperefreshRecyclerviewBinding`，从父 Fragment 取对应 userId 的 `ModuleAdapter`，下拉刷新调 `fullRefresh`。attach/detach 时与父级 SearchView/RecyclerView 联动。
- **`PagerAdapter extends FragmentStateAdapter`**：按 `adapters` 的 key（userId）创建 `ModuleListFragment`，`getItemId`/`containsItem` 用 userId 保证多用户增删时稳定。
- **`ModuleAdapter extends EmptyStateRecyclerView.EmptyStateAdapter<ViewHolder> implements Filterable`**：模块列表适配器。`reloadModules` 后台并行排序（启用优先、按名称、同包同用户优先），`ApplicationFilter` 按应用名/包名/描述过滤；`onBindViewHolder` 用 Glide 加载图标，按 `minVersion/targetVersion` 显示版本警告，按 `repoLoader.getModuleLatestVersion(...).upgradable(...)` 显示升级提示。`isPick=true` 时作为"选模块"适配器（去重 + 只列其他用户）。

---

## LogsFragment

`public class LogsFragment extends BaseFragment implements MenuProvider` — **日志页**。ViewPager2 两个 Tab：verbose 日志、模块日志。支持保存为 zip、清空、自动换行开关。

### 关键设计

- `saveLogsLauncher`：`CreateDocument("application/zip")`，回调里 `LSPManagerServiceHolder.getService().getLogs(zipFd)` 把日志 FD 写入 zip。
- `menu_word_wrap`：勾选后 ViewPager 禁止左右滑动（单列换行），`adapter.refresh()` 重建。
- `setOptionsItemSelectListener`：子 `LogFragment` 借此把"滚到顶/底/清空"菜单委托回自身处理。

### 内部类

- **`LogFragment extends BaseFragment`**：单类日志页。`LogAdaptor.fullRefresh` 后台 `ConfigManager.getLog(verbose)` 取 FD，逐行读入列表；`SCROLL_THRESHOLD = 500`，超过则用 `scrollToPosition` 否则 `smoothScrollToPosition`。固定 LTR（日志格式）。
- **`UnwrapLogFragment extends LogFragment`**：不换行模式，用 `HorizontalScrollView` 包裹 RecyclerView，`onBindViewHolder` 时测量并设宽度实现横向滚动。
- **`LogAdaptor extends EmptyStateAdapter`**：日志行适配器，`refresh(List<CharSequence>)` 切回主线程 `notifyDataSetChanged`。
- **`LogPageAdapter extends FragmentStateAdapter`**：2 项（verbose/module），`getItemViewType` 按 wordWrap 决定用 `LogFragment`（0）还是 `UnwrapLogFragment`（1）。

```java
public void save()                    // 拼时间戳文件名，launch saveLogsLauncher
```

---

## RepoFragment

`public class RepoFragment extends BaseFragment implements RepoLoader.RepoListener, ModuleUtil.ModuleListener, MenuProvider` — **在线仓库列表页**。

### 主要方法

```java
@Override public void onRepoLoaded()           // adapter.refresh() + updateRepoSummary()
@Override public void onThrowable(Throwable t) // 提示 + updateRepoSummary()
@Override public void onModulesReloaded()      // updateRepoSummary()
@Override public boolean onMenuItemSelected(MenuItem item)  // 排序：按名/按更新时间/可升级优先
private void updateRepoSummary()               // 统计可升级数，设工具栏副标题
```

### 内部类 RepoAdapter

`extends EmptyStateRecyclerView.EmptyStateAdapter<ViewHolder> implements Filterable`。

- `setData(Collection<OnlineModule>)`：后台并行过滤（`isHide()` 或无 release 的剔除）+ 排序（可升级优先、按名/按更新时间）+ 重新过滤搜索词。
- `onBindViewHolder`：显示模块名、包名、更新时间（按通道 `getLatestReleaseTime`）、摘要、可升级/已安装提示。
- `ModuleFilter`：按 description/name/summary 小写包含过滤。
- 点击条目 `safeNavigate(RepoFragmentDirections.actionRepoFragmentToRepoItemFragment(module.getName()))`。
- `onResume` 时延迟 500ms 预创建一个 `WebView`（预热 WebView 进程，优化后续 RepoItemFragment 渲染速度）。

---

## SettingsFragment

`public class SettingsFragment extends BaseFragment` — **设置页外壳**。工具栏显示框架版本（Binder 死时显示管理器版本 + 未安装），内容区托管 `PreferenceFragment`。

### 内部类 PreferenceFragment

`public static class PreferenceFragment extends PreferenceFragmentCompat` — 真正的偏好设置。`onCreatePreferences` 从 `R.xml.prefs` 加载，逐项配置：

| 偏好键 | 行为 |
| :--- | :--- |
| `disable_verbose_log` | `ConfigManager.setVerboseLogEnabled`（debug 构建强制关） |
| `enable_status_notification` | `ConfigManager.setEnableStatusNotification` |
| `add_shortcut` | 仅寄生可见，`ShortcutUtil.requestPinLaunchShortcut` |
| `backup` / `restore` | `BackupUtils.backup/restore`（经 SAF launcher） |
| `dark_theme` | `AppCompatDelegate.setDefaultNightMode(ThemeUtil.getDarkTheme(...))` |
| `black_dark_theme` / `theme_color` / `follow_system_accent` | `activity.restart()` 重建应用主题 |
| `show_hidden_icon_apps_enabled` | `ConfigManager.setHiddenIcon`（Q+） |
| `doh` | 改 `CloudflareDNS.DoH`（无代理时才可见） |
| `language` | 设 locale + `LocaleDelegate.setDefaultLocale` + restart |
| `translation` | 跳 Crowdin |
| `update_channel` | `repoLoader.updateLatestVersion(...)` |

`backupLauncher` / `restoreLauncher`：SAF `CreateDocument("application/gzip")` / `OpenDocument`，回调里 `runAsync` 执行 `BackupUtils`。

`onCreateRecyclerView`：返回 `BorderRecyclerView`，设边框监听联动父级 appBar，工具栏点击滚到顶。

---

## AppListFragment

`public class AppListFragment extends BaseFragment implements MenuProvider` — **作用域列表页**。为指定模块勾选生效应用。

### 关键流程

- `onCreate`：从 `AppListFragmentArgs` 取 `modulePackageName` / `moduleUserId`，`ModuleUtil.getInstance().getModule(...)` 取模块；为空则 `safeNavigate` 回模块页。注册 `backupLauncher` / `restoreLauncher`（按单模块备份/恢复）。注册 `OnBackPressedCallback` 调 `scopeAdapter.onBackPressed()`。
- `onCreateView`：绑定 `FragmentAppListBinding`，构造 `ScopeAdapter(this, module)`，用 `ConcatAdapter` 合并 `switchAdaptor`（全选/反选行）与 `scopeAdapter`。FAB 在模块有设置 Activity 时可见，点击启动。
- `onPrepareMenu`：绑定 SearchView 到 `scopeAdapter.getSearchListener()`。
- `onMenuItemSelected` / `onContextItemSelected`：委托给 `scopeAdapter`。

---

## CompileDialogFragment

`@SuppressWarnings("deprecation") public class CompileDialogFragment extends AppCompatDialogFragment` — **dex 优化对话框**。

```java
public static void speed(FragmentManager fragmentManager, ApplicationInfo info)
```

`onCreateDialog` 绑定 `FragmentCompileDialogBinding`（带图标/标题/进度），启动 `CompileTask`。

### 内部类 CompileTask

`private static class CompileTask extends AsyncTask<String, Void, Throwable>`，`WeakReference` 持有 Fragment 防泄漏。

```java
// doInBackground: clearApplicationProfileData + performDexOptMode
// onPostExecute: 按 result 显示 compile_done / compile_failed / compile_failed_with_info，dismiss + 父 BaseFragment.showHint
```

---

## RecyclerViewDialogFragment

`public class RecyclerViewDialogFragment extends AppCompatDialogFragment` — **安装模块到其他用户的选模块对话框**。

`onCreateDialog`：从父 `ModulesFragment` 取 `createPickModuleAdapter(user)`（一个 `isPick=true` 的 `ModuleAdapter`），绑定 `SwiperefreshRecyclerviewBinding`，用 `BlurBehindDialogBuilder` 构建带列表的对话框。`pickAdaptor.setOnPickListener` 点击后调 `modulesFragment.installModuleToUser(module, user)` 并 dismiss。

---

## RepoItemFragment

`public class RepoItemFragment extends BaseFragment implements RepoLoader.RepoListener, MenuProvider` — **模块详情页**。三 Tab：README / Releases / Information。

### 关键流程

- `onCreate`：`RepoLoader.getOnlineModule(modulePackageName)` 取模块，为空则回仓库页。
- `onCreateView`：`PagerAdapter` 三个页：ReadmeFragment / RecyclerviewFragment(releases) / RecyclerviewFragment(information)。
- `renderGithubMarkdown(WebView, text)`：用 `App.HTML_TEMPLATE` / `HTML_TEMPLATE_DARK`（按夜间模式）+ `@dir@`（ltr/rtl）+ `@body@` 拼模板；`WebViewClient.shouldInterceptRequest` 用 OkHttp 拦截 http(s) 请求转发图片等资源（绕过 WebView 自带网络栈）；`shouldOverrideUrlLoading` 走 `NavUtil`。
- `onModuleReleasesLoaded`：远程发布列表加载完回调，`releaseAdapter.loadItems()`；仅 1 条 release 时提示"无更多"。

### 内部类

- **`InformationAdapter extends SimpleStatefulAdaptor`**：动态计算行数（homepage/collaborators/sourceUrl 各可能占一行），协作者渲染成 `CustomTabsURLSpan` 链接，点击经 `LinkifyTextView.getCurrentSpan()` 取当前 span。
- **`ReleaseAdapter extends EmptyStateRecyclerView.EmptyStateAdapter`**：发布列表。`loadItems` 按通道过滤（stable 排除 prerelease/snapshot/nightly；beta 排除 snapshot/nightly；snapshot 全留）。末尾若 `!module.releasesLoaded` 多一个"加载更多"项，点击 `RepoLoader.loadRemoteReleases(module.getName())`。每项用 `renderGithubMarkdown` 渲染 `descriptionHTML`，`viewAssets` 弹 `DownloadDialog`。
- **`DownloadDialog extends DialogFragment`**：发布附件选择对话框。`create(activity, fm, assets)` 把每个 `ReleaseAsset` 拼成"文件名 + 大小 + 下载次数"显示名，点击 `NavUtil.startURL(...)` 跳浏览器下载。
- **`PagerAdapter extends FragmentStateAdapter`**：3 项，`getItemViewType` position 0 为 0（readme），其余 1（recyclerview）。
- **`BorderFragment extends BaseFragment`（静态抽象）**：README/Releases 共同基类，attach 时与父级 appBar/toolbar 联动，定义抽象 `scrollToTop()`。
- **`ReadmeFragment extends BorderFragment`**：渲染 `module.getReadmeHTML()`，`borderView = scrollView`。
- **`RecyclerviewFragment extends BorderFragment`**：按 `position` 取 releaseAdapter（1）或 informationAdapter（2）。

## 相关

- [app 模块总览](../modules/app)
- [app · adapters 包](./app-adapters)（`ScopeAdapter` 是 `AppListFragment` 的核心）
- [app · repo 包](./app-repo)（`RepoFragment` / `RepoItemFragment` 消费的数据）
- [app · widget 包](./app-widget)（`EmptyStateRecyclerView`、`LinkifyTextView`、`ScrollWebView`）
- [app · util 包](./app-util)（`ModuleUtil`、`NavUtil`、`BackupUtils`、`SimpleStatefulAdaptor`、chrome 子包）
- [app · dialog 包](./app-dialog)（`BlurBehindDialogBuilder`、`WelcomeDialog`）
