# 🎯 ScopeAdapter

> 📂 `app/src/main/java/org/lsposed/manager/adapters/ScopeAdapter.java`
> 🟦 app 模块 · 作用域列表适配器

## 类职责

`public class ScopeAdapter extends EmptyStateRecyclerView.EmptyStateAdapter<ScopeAdapter.ViewHolder> implements Filterable` 是模块详情页「勾选哪些应用生效」界面的核心适配器。每个条目是一个已安装应用，带复选框；勾选状态经 `ConfigManager.setModuleScope` 实时持久化到 Daemon。顶部独立的「主开关」行控制模块启用/禁用（`switchAdaptor`），与下方应用列表分离渲染。

承担：作用域读取与回填、推荐作用域（来自模块 `scope.list`/meta-data）高亮、应用过滤（系统/游戏/模块）、排序（已勾选优先 → 推荐 → 框架 → 名称）、搜索过滤、上下文菜单（启动/强停/卸载/编译/应用详情）、批量操作（全选/全不选/使用推荐/备份/恢复/auto-include）。

## 关键设计

- **嵌套 switchAdaptor**：`RecyclerView.Adapter` 渲染单行 `MainSwitchBar`，勾选联动 `moduleUtil.setModuleEnabled` + 首次开启时回写作用域。
- **onCheckedChange**：每次勾选即时 `setModuleScope`，失败则回滚开关并提示；勾选 `system` 时提示需重启。
- **ApplicationFilter**：按应用名/包名小写包含过滤。
- **Glide 图标**：`onBindViewHolder` 异步加载，`onLoadFailed` 回退默认图标；`onViewRecycled` 解绑 checkbox 监听防误触。

## 构造与字段

```java
public ScopeAdapter(AppListFragment fragment, ModuleUtil.InstalledModule module)
```

| 字段 | 含义 |
| :--- | :--- |
| `module` | 目标模块 |
| `recommendedList` / `checkedList` | 推荐作用域 / 已勾选作用域（`ApplicationWithEquals` Set） |
| `searchList` / `showList` | 全量 / 过滤后展示（`AppInfo` List） |
| `enabled` | 模块启用态，控制整行 alpha |
| `switchAdaptor` | 顶部主开关行适配器 |

## 主要方法

```java
public boolean onOptionsItemSelected(MenuItem item)     // 推荐/过滤/备份/恢复/全选/全不选/auto_include
public boolean onContextItemSelected(@NonNull MenuItem item)  // 启动/编译/应用详情/强停
public void onPrepareOptionsMenu(@NonNull Menu menu)   // 同步过滤/排序/推荐菜单勾选态
public void refresh()
public void refresh(boolean force)                     // force=true 强制 AppHelper.getAppList 重查
protected void onCheckedChange(CompoundButton, boolean, AppInfo)
public void onBackPressed()                            // 已启用但空作用域时弹确认：使用推荐或禁用模块
public SearchView.OnQueryTextListener getSearchListener()
```

`refresh` 后台用 `parallelStream` 遍历 `AppHelper.getAppList`，跳过模块自身/管理器包/跨用户 `system`，按 `module.getScopeList()` 标记推荐，按偏好过滤系统/游戏/模块应用，最后 `sortApps` 排序。

## ApplicationWithEquals

```java
public static class ApplicationWithEquals extends Application {
    public ApplicationWithEquals(String packageName, int userId)
    public ApplicationWithEquals(Application application)
    @Override public boolean equals(@Nullable Object obj)   // packageName + userId
    @Override public int hashCode()
}
```

继承 AIDL `Application`，补 `equals`/`hashCode` 以便放进 `Set` 做集合运算（全选/去重/retainAll）。这是 UI 层与 IPC 层的桥接类型。

## AppInfo

```java
public static class AppInfo {
    public PackageInfo packageInfo;
    public ApplicationWithEquals application;
    public ApplicationInfo applicationInfo;
    public String packageName;
    public CharSequence label = null;
}
```

单条列表项的渲染数据包，`label` 由 `AppHelper.getAppLabel` 填充（带图标缓存）。

## shouldHideApp 与排序

`shouldHideApp(info, app, tmpChkList)` 决定应用是否从列表隐藏：`system` 永不隐藏；已勾选不隐藏；否则按偏好过滤模块（`filter_modules`，避免模块互相 hook）、游戏（`filter_games`，CATEGORY_GAME 或 FLAG_IS_GAME）、系统应用（`filter_system_apps`，FLAG_SYSTEM）。

`sortApps` 三级排序：已勾选优先 → 推荐作用域优先 → `system` 框架优先 → `AppHelper.getAppListComparator` 比较包信息。

## 勾选与回写流程

```mermaid
flowchart TD
    A["onBindViewHolder"] --> B["checkbox.setChecked(checkedList.contains)"]
    B --> C["setOnCheckedChangeListener → onCheckedChange"]
    C --> D["复制 checkedList 修改"]
    D --> E["ConfigManager.setModuleScope"]
    E --> F{"成功?"}
    F -->|是| G["checkedList = tmp"]
    F -->|否| H["回滚开关 + showHint"]
    G --> I{"勾了 system?"}
    I -->|是| J["提示需重启 + 重启按钮"]
    I -->|否| K["结束"]
    L["主开关切换"] --> M["setModuleEnabled"]
    M --> N["首开 + 非空 checkedList → setModuleScope"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,D,G,H,J,K,L,M,N class core
    class E class ipc
    class F,I class branch
```

## 相关

- [ConfigManager · 作用域 IPC](./config-manager)
- [ModuleUtil · InstalledModule.getScopeList](./module-util) — 推荐作用域来源
- [BackupUtils · 作用域备份](./backup-utils) — 用 `ApplicationWithEquals`
- [AIDL 数据模型 · Application](../../aidl/models)
- [app · adapters 总览](../app-adapters)（含 AppHelper）
