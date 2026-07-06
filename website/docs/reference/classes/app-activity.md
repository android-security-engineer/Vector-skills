# app · ui/activity 包

> 📂 [`app/src/main/java/org/lsposed/manager/ui/activity/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/activity/)（含 [`ui/activity/base/`](https://github.com/android-security-engineer/Vector-skills/blob/master/ui/activity/base/)）
> 🟦 管理器的 Activity 层：单 Activity 入口 + 主题基类

## 包职责

承载管理器的单 Activity + 多 Fragment 架构。`MainActivity` 是唯一入口，内部用 Navigation Component 在多个 Fragment 间切换；`BaseActivity`（在 `base` 子包）提供主题应用、状态栏透明、寄生模式下的任务描述等通用能力。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`MainActivity`](#mainactivity) | 单 Activity 入口，托管导航图，处理深链与角标 |
| [`BaseActivity`](#baseactivity) | Activity 基类：主题、状态栏、寄生任务描述 |

```mermaid
graph TD
    BASE["BaseActivity<br/>(主题/状态栏/TaskDescription)"]:::ui
    MAIN["MainActivity<br/>NavHost + 底部导航"]:::entry
    NAV["NavController<br/>(nav_host_fragment)"]:::ui
    FRAG["各 Fragment<br/>Home/Modules/Logs/Repo/Settings/..."]:::ui

    BASE <|-- MAIN
    MAIN --> NAV
    NAV --> FRAG
    MAIN -. "RepoListener/ModuleListener" .-> REPO["RepoLoader / ModuleUtil"]:::core

    classDef entry fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef core fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
```

---

## MainActivity

`public class MainActivity extends BaseActivity implements RepoLoader.RepoListener, ModuleUtil.ModuleListener`

**管理器唯一 Activity**。用 `ActivityMainBinding` 绑定布局，内含一个 `NavHostFragment` 和底部 `NavigationBarView`。同时注册为 `RepoLoader` 与 `ModuleUtil` 的监听者，据此在底部导航栏打"可升级模块数""已启用模块数"角标。

### Intent 与深链

`handleIntent(Intent)` 解析传入 Intent，按 action / data 路由到对应导航项：

| Intent 内容 | 行为 |
| :--- | :--- |
| action = `APPLICATION_PREFERENCES` | 跳到设置页 |
| data = `modules` | 跳到模块页 |
| data = `logs` | 跳到日志页 |
| data = `repo` | 跳到仓库页（需 Magisk 已安装） |
| data = `settings` | 跳到设置页 |
| scheme = `module`、host = 包名、port = userId | 构造 `lsposed://module?modulePackageName=...&moduleUserId=...` 深链导航到模块详情 |

### 主要方法

```java
// 构造启动 Intent
@NonNull public static Intent newIntent(@NonNull Context context)

// 带 savedInstanceState 的启动 Intent（用于 restart() 重建）
@NonNull private static Intent newIntent(@NonNull Bundle savedInstanceState, @NonNull Context context)

// 处理深链/动作路由
private void handleIntent(Intent intent)

// 兼容旧版的重启：保存状态 → finish → 重开（带动画）
public void restart()

// RepoListener：统计可升级模块数，在 repo 导航项打角标
@Override public void onRepoLoaded()

// RepoListener：清掉 repo 角标
@Override public void onThrowable(Throwable t)

// ModuleListener：刷新角标 + 设置已启用模块数角标
@Override public void onModulesReloaded()
```

### 重启策略 `restart()`

- Android S（API 31+）或寄生模式：直接 `recreate()`。
- 旧版非寄生：手动 `onSaveInstanceState` → `finish()` → `startActivity(newIntent(savedInstanceState, this))` + 淡入淡出动画，并把 `restarting` 标志置 true。
- `restarting` 期间所有 `dispatchKeyEvent/KeyShortcutEvent/TouchEvent/TrackballEvent/GenericMotionEvent` 都被吞掉（返回 true），避免重建过程中误操作。

### 角标逻辑

- `onRepoLoaded`：遍历已安装模块，用 `repoLoader.getModuleLatestVersion(...).upgradable(...)` 统计可升级数，在 `R.id.repo_nav` 打数字角标。
- `setModulesSummary(count)`：在 `R.id.modules_nav` 打已启用模块数角标。
- `onResume`：若 `UpdateUtil.needUpdate()` 为真，在 `R.id.main_fragment`（首页）打角标；若 Binder 未存活，从导航菜单移除 logs/modules（必要时含 repo）项；寄生模式下调用 `ShortcutUtil.updateShortcut()` 刷新桌面快捷方式图标。

---

## BaseActivity

`public class BaseActivity extends MaterialActivity`（`ui.activity.base` 子包）— **Activity 基类**，继承自 rikka 的 `MaterialActivity`，提供主题与窗口处理。

### 主要方法

```java
// 设 AppTheme 后调 super
@Override public void onCreate(@Nullable Bundle savedInstanceState)

// 寄生模式下：把任务移出 recent 黑名单 + 设置 TaskDescription（标题/图标/背景色）
@Override protected void onStart()

// 应用颜色主题 overlay + 夜间主题 overlay + Material3 偏好 overlay
@Override public void onApplyUserThemeResource(@NonNull Resources.Theme theme, boolean isDecorView)

// 主题键 = 颜色主题 + 夜间主题，用于 rikka 的主题缓存
@Override public String computeUserThemeKey()

// 透明状态栏/导航栏
@Override public void onApplyTranslucentSystemBars()
```

### 寄生任务描述

`onStart()` 中若 `App.isParasitic` 为真：

1. 调 `getSystemService(ActivityManager.class).getAppTasks()` 逐个 `setExcludeFromRecents(false)`——让寄生管理器在最近任务里正常显示（默认寄生进程会被排除）。
2. 把宿主的应用图标渲染成 `Bitmap`（处理 `BitmapDrawable` 与 `AdaptiveIconDrawable` 两种情况），缓存到静态 `icon` 字段。
3. `setTaskDescription(...)` 设置最近任务里显示的标题、图标、背景色（`R.color.ic_launcher_background`）。

### 主题应用

`onApplyUserThemeResource` 按顺序 apply 三个 overlay：

- 非"跟随系统强调色"时：`ThemeUtil.getColorThemeStyleRes()`（19 种 Material 颜色之一）。
- 始终：`ThemeUtil.getNightThemeStyleRes(this)`（默认或纯黑夜间）。
- 始终：`ThemeOverlay_Rikka_Material3_Preference`（偏好设置页的 Material3 风格）。

`computeUserThemeKey` 返回 `颜色主题 + 夜间主题` 字符串，rikka 据此缓存已 apply 的主题，避免重复 inflate。

## 相关

- [app 模块总览](../modules/app)
- [app · fragment 包](./app-fragment)（被本 Activity 托管的各页面）
- [app · util 包](./app-util)（`ThemeUtil` 提供主题资源、`ShortcutUtil` 提供快捷方式、`UpdateUtil` 提供更新判断）
- 寄生模式见 [Zygisk 模块 · 寄生式管理器](../../architecture/zygisk#寄生式管理器与身份移植)
