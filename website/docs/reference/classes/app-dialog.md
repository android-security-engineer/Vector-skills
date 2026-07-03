# app · ui/dialog 包

> 📂 `app/src/main/java/org/lsposed/manager/ui/dialog/`
> 🟦 管理器的对话框组件

## 包职责

提供管理器里两类对话框：首次启动的欢迎/快捷方式引导对话框，以及一个支持系统级背景模糊（blur behind）的 `MaterialAlertDialogBuilder` 子类——后者是全 app 对话框的统一基座。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`WelcomeDialog`](#welcomedialog) | 首次启动欢迎对话框，寄生模式下引导创建桌面快捷方式 |
| [`BlurBehindDialogBuilder`](#blurbehinddialogbuilder) | 带背景模糊的 `MaterialAlertDialogBuilder` 子类 |

---

## WelcomeDialog

`public class WelcomeDialog extends DialogFragment`

**欢迎对话框**。由 `HomeFragment.onCreate` 调用 `showIfNeed(...)` 触发。根据 `App.isParasitic` 走两条分支：

- **寄生模式**：提示"管理器寄生运行，建议创建桌面快捷方式"，提供"创建快捷方式"中性按钮（调 `ShortcutUtil.requestPinLaunchShortcut`）和"不再显示"负按钮。
- **普通应用模式**：简单展示欢迎信息 + "不再显示"。

### 主要方法

```java
// 静态入口：按需弹出（已显示过 / Binder 未活 / 已选不再显示 / 寄生且已 pin 快捷方式 → 跳过）
public static void showIfNeed(FragmentManager fm)

// 构造对话框，按寄生与否分流
@NonNull @Override public Dialog onCreateDialog(@Nullable Bundle savedInstanceState)
```

### 弹出条件 `showIfNeed`

满足以下任一条件则不弹：

- `shown` 静态标志已为 true（进程内只弹一次）。
- `ConfigManager.isBinderAlive()` 为 false（框架未激活）。
- 偏好 `never_show_welcome` 为 true。
- 寄生模式且 `ShortcutUtil.isLaunchShortcutPinned()` 已 pin。

否则 `new WelcomeDialog().show(fm, "welcome")` 并把 `shown` 置 true。

### 寄生分支的快捷方式回调

"创建快捷方式"按钮点击后调 `ShortcutUtil.requestPinLaunchShortcut(afterPinned)`，回调里：

1. 偏好写 `never_show_welcome = true`。
2. 经父 `BaseFragment` 调 `showHint(R.string.settings_shortcut_pinned_hint, false)` 提示已 pin。

若 `requestPinLaunchShortcut` 返回 false（系统不支持），则提示不支持信息。

---

## BlurBehindDialogBuilder

`public class BlurBehindDialogBuilder extends MaterialAlertDialogBuilder`

**带背景模糊的对话框 Builder**。重写 `create()`，在生成的 `AlertDialog` 上挂窗口模糊监听，跨 Android R/S 版本实现对话框背后的背景模糊效果。全 app 的 `BlurBehindDialogBuilder` 调用点（`HomeFragment`、`ModulesFragment`、`CompileDialogFragment`、`RepoItemFragment` 等）都用它替代原生 Builder。

### 关键常量

| 常量 | 含义 |
| :--- | :--- |
| `supportBlur` | 系统 surface_flinger 是否支持背景模糊（读 `ro.surface_flinger.supports_background_blur` 且 `persist.sys.sf.disable_blurs` 为 false） |

### 构造

```java
public BlurBehindDialogBuilder(@NonNull Context context)
public BlurBehindDialogBuilder(@NonNull Context context, int overrideThemeResId)
```

### 模糊实现（分版本）

`setupWindowBlurListener(dialog)`：

- **Android S（API 31+）**：给窗口加 `FLAG_BLUR_BEHIND`，注册 `addCrossWindowBlurEnabledListener`。监听器在 DecorView attach 时挂载、detach 时移除。模糊启用时 dim=0.1，禁用时 dim=0.32；并设 `setBlurBehindRadius(20)`。
- **Android R（API 30）**：`dialog.setOnShowListener` 直接按 `supportBlur` 更新。启用时通过反射拿到 `ViewRootImpl` 的 `SurfaceControl`，用 `SurfaceControl.Transaction.setBackgroundBlurRadius` 动画到 53（`ValueAnimator` + `DecelerateInterpolator`），DecorView detach 时 cancel 动画。
- **更低版本**：不模糊，仅按 `mDimAmountNoBlur` 调整 dim。

### 主要方法

```java
// 重写：建对话框后挂模糊监听
@NonNull @Override public AlertDialog create()

// 反射读系统属性（ro.* / persist.*）
public static boolean getSystemProperty(String key, boolean defaultValue)
```

### dim 量

```java
float mDimAmountWithBlur = 0.1f;   // 模糊时弱 dim，靠模糊本身做隔离
float mDimAmountNoBlur = 0.32f;    // 无模糊时用更强 dim 弥补
```

## 相关

- [app 模块总览](../modules/app)
- [app · fragment 包](./app-fragment)（各 Fragment 调用此 Builder）
- [app · util 包](./app-util)（`ShortcutUtil` 支持欢迎对话框的快捷方式功能）
