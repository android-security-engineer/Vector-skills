# app · adapters 包

> 📂 `app/src/main/java/org/lsposed/manager/adapters/`
> 🟦 管理器 UI 的列表适配层

## 包职责

为管理器的列表界面提供 `RecyclerView` 适配器：应用列表、作用域列表。负责数据装配、视图绑定、过滤、菜单与上下文操作。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`AppHelper`](#apphelper) | 应用列表的工具门面：获取应用列表、启动 Intent、比较器 |
| [`ScopeAdapter`](#scopeadapter) | 作用域列表适配器：为模块勾选生效应用 |

---

## AppHelper

`public class AppHelper` — 应用列表相关操作的**静态工具集**，UI 层获取应用列表、打开模块设置、构造启动 Intent都经此。

### 关键常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `SETTINGS_CATEGORY` | `"de.robv.android.xposed.category.MODULE_SETTINGS"` | Xposed 模块设置 Activity 的 Intent category |
| `FLAG_SHOW_FOR_ALL_USERS` | `0x0400` | 标记某条目对所有用户可见 |

### 主要方法

```java
// 获取某模块的设置 Activity Intent
public static Intent getSettingsIntent(String packageName, int userId)

// 获取应用启动 Intent
public static Intent getLaunchIntentForPackage(String packageName, int userId)

// 菜单项点击处理（搜索、排序、刷新）
public static boolean onOptionsItemSelected(MenuItem item, SharedPreferences preferences)

// 应用列表比较器（按名称/安装时间等排序）
public static Comparator<PackageInfo> getAppListComparator(int sort, PackageManager pm)

// 获取应用列表（带缓存，force=true 强制刷新）
synchronized public static List<PackageInfo> getAppList(boolean force)

// 应用显示名（带图标缓存）
public static CharSequence getAppLabel(PackageInfo info, PackageManager pm)
```

`getAppList` 内部带缓存——首次查询后列表常驻，`force` 参数强制重查。多用户场景下会跨用户枚举。

---

## ScopeAdapter

`public class ScopeAdapter extends EmptyStateRecyclerView.EmptyStateAdapter<ScopeAdapter.ViewHolder> implements Filterable`

**作用域列表适配器**——管理器里"为模块勾选哪些应用生效"那个界面的核心。每个条目是一个应用，带开关；开关状态经 `ConfigManager.setModuleScope` 持久化到 Daemon。

### 关键设计

- **嵌套 switchAdaptor**：内部持有一个独立的 `RecyclerView.Adapter` 负责顶部"全选/反向选择"开关行，与下方应用列表分离渲染。
- **`onSwitchChanged` 回调**：条目开关切换时触发，批量收集变更后一次性写回，避免每勾选一次就 IPC 一次。
- **Filterable**：实现 `getFilter()` 支持搜索框过滤应用名/包名。
- **Glide 图标加载**：`onBindViewHolder` 里用 Glide 异步加载应用图标，`onResourceReady`/`onLoadFailed` 处理回调。

### 构造与生命周期

```java
public ScopeAdapter(AppListFragment fragment, ModuleUtil.InstalledModule module)
```

绑定一个 Fragment 和目标模块。`onViewRecycled` 时清理 Glide 请求防内存泄漏。

### 菜单与上下文菜单

- `onOptionsItemSelected`：处理"推荐作用域""重置"等菜单。
- `onContextItemSelected`：长按条目的"强制停止""卸载""应用详情"等操作。
- `onPrepareOptionsMenu`：根据当前选择动态启用/禁用菜单项。

## 相关

- [app 模块总览](../modules/app)
- [app · util 包](./app-util)（`ModuleUtil` 等工具）
- 作用域概念见 [guide · 模块机制](../../guide/modules#作用域)
