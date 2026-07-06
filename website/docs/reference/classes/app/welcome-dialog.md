# 🚀 WelcomeDialog · 模糊背景对话框

> 📂 [`app/src/main/java/org/lsposed/manager/ui/dialog/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/dialog/)
> 🟦 app 模块 · 首次进入欢迎弹窗与模糊背景构建器

## 包职责

提供管理器首次启动的欢迎对话框，以及一个让所有 Material 对话框获得系统级背景模糊（blur behind）能力的 `MaterialAlertDialogBuilder` 子类。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`WelcomeDialog`](#welcomedialog) | 首次进入弹窗，区分寄生/独立模式与快捷方式引导 |
| [`BlurBehindDialogBuilder`](#blurbehinddialogbuilder) | 在 Android R/S 上为对话框加背景模糊的 Builder |

---

## WelcomeDialog

`public class WelcomeDialog extends DialogFragment` —— 通过 `showIfNeed` 静态入口决定是否弹出。寄生模式下提示用户创建桌面快捷方式（因为寄生管理器没有独立启动入口），独立模式则只是欢迎语。

### 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `shown` | `static boolean` | 进程内去重标志，避免重复弹出 |

### 方法签名

```java
// 构造欢迎对话框（寄生模式：引导创建快捷方式）
private Dialog parasiticDialog(BlurBehindDialogBuilder builder)

// 构造欢迎对话框（独立 app 模式）
private Dialog appDialog(BlurBehindDialogBuilder builder)

@NonNull
@Override
public Dialog onCreateDialog(@Nullable Bundle savedInstanceState)

// 按需展示：Binder 存活 + 未选"不再提示" + （寄生模式）快捷方式未固定时才弹
public static void showIfNeed(FragmentManager fm)
```

`showIfNeed` 三重门控：`ConfigManager.isBinderAlive()`、偏好 `never_show_welcome`、寄生模式下 `ShortcutUtil.isLaunchShortcutPinned()`。寄生分支的"创建快捷方式"中性按钮调用 `ShortcutUtil.requestPinLaunchShortcut`，成功后写入 `never_show_welcome` 并提示。

### 弹窗流程

```mermaid
flowchart TD
    A["showIfNeed(fm)"] --> B{"shown?"}
    B -->|是| Z["return"]
    B -->|否| C{"Binder 存活?"}
    C -->|否| Z
    C -->|是| D{"never_show_welcome?"}
    D -->|是| Z
    D -->|否| E{"寄生且快捷方式已固定?"}
    E -->|是| Z
    E -->|否| F["new WelcomeDialog().show"]
    F --> G["onCreateDialog"]
    G --> H{"App.isParasitic"}
    H -->|是| I["parasiticDialog"]
    H -->|否| J["appDialog"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class F,G,I,J class vec
    class B,C,D,E,H class hot
    class A,Z class plain
```

---

## BlurBehindDialogBuilder

`public class BlurBehindDialogBuilder extends MaterialAlertDialogBuilder` —— 重写 `create()`，给生成的 `AlertDialog` 窗口注册跨窗口模糊监听，按系统是否启用模糊动态调整 dim 量。

### 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `supportBlur` | `static boolean` | R 上是否支持模糊：`ro.surface_flinger.supports_background_blur` 且未设 `persist.sys.sf.disable_blurs` |
| `mDimAmountWithBlur` | `float` | `0.1f`，模糊时低 dim |
| `mDimAmountNoBlur` | `float` | `0.32f`，无模糊时高 dim |

### 方法签名

```java
public BlurBehindDialogBuilder(@NonNull Context context)
public BlurBehindDialogBuilder(@NonNull Context context, int overrideThemeResId)

@NonNull
@Override
public AlertDialog create()

private void setupWindowBlurListener(AlertDialog dialog)
private void updateWindowForBlurs(Window window, boolean blursEnabled)
public static boolean getSystemProperty(String key, boolean defaultValue)
```

Android S+ 走 `FLAG_BLUR_BEHIND` + `addCrossWindowBlurEnabledListener`，`setBlurBehindRadius(20)`。Android R 走反射：从 `ViewRootImpl` 取 `SurfaceControl`，用 `SurfaceControl.Transaction.setBackgroundBlurRadius` 配合 `ValueAnimator(1→53)` 做淡入动画。

## 相关

- [app 模块总览](../../modules/app)
- [app · nav 与快捷方式](./nav-util)（`ShortcutUtil`）
