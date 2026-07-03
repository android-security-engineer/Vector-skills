# 🧩 ModulesFragment

> 📂 `app/src/main/java/org/lsposed/manager/ui/fragment/ModulesFragment.java`
> 🟦 app 模块 · 模块列表（多用户分页）

## 类职责

`public class ModulesFragment extends BaseFragment implements ModuleUtil.ModuleListener, RepoLoader.RepoListener, MenuProvider` 是「已安装模块」页。按 Android 用户分 tab（`ViewPager2` + `TabLayout`），每个用户一个 `ModuleAdapter`，列出该用户下所有已安装的 Xposed 模块，展示图标/名称/描述/版本/启用开关/兼容性警告/可升级提示，并提供启动设置、应用详情、卸载、仓库页、安装到其他用户、编译加速等上下文操作。

模块来源是 `ModuleUtil.getModules()`（全用户 `Pair<包名,userId> → InstalledModule`），`ModuleAdapter` 按 `userId` 过滤后渲染。监听 `ModuleUtil`/`RepoLoader` 变更自动刷新。

## 多用户分页

`onModulesReloaded` 重建 `SparseArray<ModuleAdapter>`：单用户时隐藏 tab、禁用 ViewPager 滑动；多用户时显示 tab 与「安装到其他用户」FAB。`PagerAdapter extends FragmentStateAdapter` 为每个用户创建 `ModuleListFragment`，用 `getItemId`/`containsItem` 以 `userId` 为稳定 id。

## 内部类 ModuleListFragment

`public static class ModuleListFragment extends Fragment` 是单个用户 tab 的列表宿主。`onCreateView` 从 arguments 取 `user_id`，绑定 `SwiperefreshRecyclerviewBinding`，从父 `ModulesFragment.adapters` 取对应 `ModuleAdapter` 设给 RecyclerView，`swipeRefreshLayout.setOnRefreshListener(adapter::fullRefresh)`。`AdapterDataObserver.onChanged` 据加载状态切换刷新指示器。

`attachListeners`/`detachListeners` 在 `onStart/onResume` 与 `onPause/onStop` 间成对调用，把搜索框展开态联动到 RecyclerView 嵌套滚动开关、边界显隐联动到父 `appBar.setLifted`，工具栏点击时若搜索框收起则滚回顶部并展开 appBar。

## 内部类 ModuleAdapter

```java
class ModuleAdapter extends EmptyStateRecyclerView.EmptyStateAdapter<ModuleAdapter.ViewHolder> implements Filterable
```

| 成员 | 作用 |
| :--- | :--- |
| `searchList` / `showList` | 全量列表 / 过滤后展示列表 |
| `user` / `isPick` | 所属用户 / 是否「挑选模块安装到其他用户」模式 |
| `reloadModules` | 后台排序：已启用优先，再按名称/安装时间，同包名去重 |
| `ApplicationFilter` | 按应用名/包名/描述小写包含过滤 |
| `refresh()` / `fullRefresh()` | 增量刷新 / 强制重载模块后刷新 |

`onBindViewHolder` 的警告判定链：`minVersion==0`（无最低版本）→ 框架版本不足 → target 版本过高 → 低于 `MIN_MODULE_VERSION` → 装在外存。仓库有新版时追加「可更新」提示（`repoLoader.getModuleLatestVersion(...).upgradable(...)`）。未启用模块整行 alpha 降到 0.5。

`reloadModules` 排序逻辑：已启用模块排前，未启用排后；同启用态下按 `AppHelper.getAppListComparator` 比较包信息；再按 `userId` 是否等于当前用户排序；`isPick` 模式下按包名去重只保留其他用户的副本。`getItemId` 用 `(packageName + "!" + userId).hashCode()` 保证跨用户条目 id 唯一。

## 搜索与 FAB

`searchListener`（`SearchView.OnQueryTextListener`）在提交与文本变更时 `forEachAdaptor` 把过滤词广播给所有用户的 `ModuleAdapter.getFilter()`。`forEachAdaptor` 遍历 `SparseArray` 快照逐个执行。FAB 点击弹出 `RecyclerViewDialogFragment`（带 `userInfo` 参数），用于「安装到其他用户」选择目标模块；`onPageSelected` 时 `showFab()` 通过 `HideBottomViewOnScrollBehavior.slideUp` 把 FAB 顶上来。

## 上下文菜单

`onContextItemSelected` 处理选中模块的操作：

| 菜单 | 行为 |
| :--- | :--- |
| `menu_launch` | `AppHelper.getSettingsIntent` → `startActivityAsUserWithFeature` |
| `menu_app_info` / `menu_other_app` | 打开应用详情 / 系统应用信息页 |
| `menu_uninstall` | `ConfigManager.uninstallPackage` 后 `reloadSingleModule` |
| `menu_repo` | `navigate` 到仓库模块详情 |
| `menu_compile_speed` | `CompileDialogFragment.speed(...)` |

userId==0 的模块会额外动态注入「安装到 user N」菜单项（`installModuleToUser`，调 `ConfigManager.installExistingPackageAsUser`）。

## installModuleToUser

```java
void installModuleToUser(ModuleUtil.InstalledModule module, UserInfo user)
```

弹 `BlurBehindDialogBuilder` 确认对话框，确认后在 `runAsync` 里调 `ConfigManager.installExistingPackageAsUser(module.packageName, user.id)`，据成败显示 `module_installed` / `module_install_failed` 提示，成功则 `moduleUtil.reloadSingleModule` 刷新。`onContextItemSelected` 里 `menu_launch` 用 `AppHelper.getSettingsIntent`，`menu_repo` 用 `lsposed://repo?modulePackageName=` deep link navigate。

## 生命周期

```java
@Override public void onCreate(@Nullable Bundle savedInstanceState)   // 建 searchListener
@Override public View onCreateView(...)
@Override public void onPrepareMenu(Menu menu)                        // 绑定 searchView
@Override public void onResume()                                      // forEachAdaptor refresh
@Override public void onSingleModuleReloaded(InstalledModule module) // forEachAdaptor refresh
@Override public void onModulesReloaded()
@Override public void onRepoLoaded()                                  // forEachAdaptor refresh
@Override public void onDestroyView()                                 // 移除监听 + binding=null
```

`onDestroyView` 必须 `moduleUtil.removeListener(this)` 与 `repoLoader.removeListener(this)`，否则 Fragment 销毁后仍收到回调导致 NPE。`updateModuleSummary` 把已启用模块数（`-1` 时显示 loading）写进工具栏副标题。

## 数据流

```mermaid
flowchart LR
    A["ModuleUtil.getModules()"] --> B["reloadModules<br/>排序+过滤用户"]
    B --> C["searchList"]
    C --> D["ApplicationFilter"]
    D --> E["showList → onBindViewHolder"]
    F["RepoLoader"] -->|"onRepoLoaded"| B
    G["ModuleUtil"] -->|"onModulesReloaded<br/>onSingleModuleReloaded"| B
    E --> H{"警告/可升级?"}
    H --> I["hint Spannable"]
    J["上下文菜单"] --> K["ConfigManager<br/>uninstall/install/start"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    class A,B,C,D,E class core
    class F,G class ipc
    class H,I,J,K class ui
```

## 相关

- [ModuleUtil · 模块工具与 InstalledModule](./module-util)
- [RepoLoader · 可升级判定](./repo-loader)
- [ScopeAdapter · 作用域列表](./scope-adapter) — 模块详情页用
- [ConfigManager · 模块/包操作](./config-manager)
