# 🏠 MainActivity

> 📂 `app/src/main/java/org/lsposed/manager/ui/activity/MainActivity.java`
> 🟦 app 模块 · 单 Activity + Fragment 路由

## 类职责

`public class MainActivity extends BaseActivity implements RepoLoader.RepoListener, ModuleUtil.ModuleListener` 是管理器的**唯一 Activity**。它用 Navigation Component + `BottomNavigationView` 承载全部页面（首页/模块/仓库/日志/设置），并负责两件跨页面协调工作：把外部 Intent（deep link `lsposed://` 或 `module:` scheme）路由到目标 Fragment，以及在底部导航项上维护「可升级模块数」「已启用模块数」「管理器可更新」三类角标。

同时实现 `RepoLoader.RepoListener` 与 `ModuleUtil.ModuleListener`，作为模块/仓库变更的中枢：仓库重载后统计可升级模块数刷新仓库角标，模块重载后刷新模块角标。

## 关键字段

| 字段 | 含义 |
| :--- | :--- |
| `repoLoader` / `moduleUtil` | 静态持有的单例，构造时即取 |
| `restarting` | `restart()` 期间为 true，拦截所有触摸/按键事件避免重启中误操作 |
| `binding` | `ActivityMainBinding`，ViewBinding |

## Intent 构造与路由

```java
public static Intent newIntent(@NonNull Context context)
private static Intent newIntent(@NonNull Bundle savedInstanceState, @NonNull Context context)  // 带 saved state
```

`handleIntent(Intent)` 是路由核心，依据 `Intent` 的 action 与 data 决定选中哪个底部 tab：

| data / action | 行为 |
| :--- | :--- |
| `ACTION_APPLICATION_PREFERENCES` | 选中 settings |
| data `"modules"` / `"logs"` / `"repo"` / `"settings"` | 选中对应 tab（`repo` 仅当 Magisk 已装） |
| scheme `"module"` | `navigate` 到模块详情，host=包名 port=userId |
| Binder 未存活 | 不做路由（导航项已被移除） |

## 重启与事件拦截

```java
public void restart()
```

Android 12+ 或寄生模式下用 `recreate()`；否则保存状态、`finish()`、`startActivity` 带状态的新 Intent 并加淡入淡出动画。重启期间 `restarting=true`，`dispatchKeyEvent` / `dispatchKeyShortcutEvent` / `dispatchTouchEvent` / `dispatchTrackballEvent` / `dispatchGenericMotionEvent` 全部吞掉事件。

`restart` 用 `EXTRA_SAVED_INSTANCE_STATE` 把 `onSaveInstanceState` 的 Bundle 通过 Intent extra 传给新实例，新实例 `onCreate` 优先从 `getIntent().getBundleExtra(EXTRA_SAVED_INSTANCE_STATE)` 取回状态，实现无缝重建。`@SuppressLint("RestrictedApi")` 标注 `dispatchKeyShortcutEvent` 因调用了受限 API。

## 导航与事件分发

```java
@Override public boolean onSupportNavigateUp()   // navController.navigateUp() || super
@Override public boolean dispatchKeyEvent(@NonNull KeyEvent event)
@Override public boolean dispatchKeyShortcutEvent(@NonNull KeyEvent event)
@Override public boolean dispatchTouchEvent(@NonNull MotionEvent event)
@Override public boolean dispatchTrackballEvent(@NonNull MotionEvent event)
@Override public boolean dispatchGenericMotionEvent(@NonNull MotionEvent event)
```

`onSupportNavigateUp` 让 NavController 处理返回栈，失败再回退到父类。所有 `dispatch*` 在 `restarting` 期间直接返回 true 吞掉输入，避免重启过程中用户触发的操作落在已销毁的视图上。

## 监听器回调

```java
@Override public void onRepoLoaded()           // 统计可升级模块数 → 仓库角标
@Override public void onThrowable(Throwable t) // 清除仓库角标
@Override public void onModulesReloaded()      // 触发 onRepoLoaded + setModulesSummary
```

`onResume` 里还会按 `UpdateUtil.needUpdate()` 给首页 tab 加角标，并在 Binder 未存活时从导航移除 logs/modules/repo 项；寄生模式下调用 `ShortcutUtil.updateShortcut()`。

## 导航与角标流程

```mermaid
flowchart TD
    A["onCreate"] --> B["绑定 binding + setupWithNavController"]
    B --> C["addListener(this) ×2"]
    C --> D["handleIntent(getIntent)"]
    D --> E{"action / data?"}
    E -->|"module: scheme"| F["navigate 模块详情"]
    E -->|其他| G["setSelectedItemId 目标 tab"]
    H["onResume"] --> I["isBinderAlive?"]
    I -->|否| J["移除 logs/modules/repo 菜单项"]
    I -->|是| K["刷新模块角标<br/>+ needUpdate 角标"]
    L["onRepoLoaded"] --> M["统计可升级模块数"]
    M --> N["仓库角标 setNumber"]
    O["onModulesReloaded"] --> P["setModulesSummary"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,C,D,H,L,O class core
    class E,I,M class branch
    class F,G,J,K,N,P class ui
```

## 相关

- [HomeFragment · 首页](./home-fragment)
- [ModulesFragment · 模块列表](./modules-fragment)
- [LogsFragment · 日志](./logs-fragment)
- [SettingsFragment · 设置](./settings-fragment)
- [RepoLoader · 仓库监听源](./repo-loader)
- [ModuleUtil · 模块监听源](./module-util)
