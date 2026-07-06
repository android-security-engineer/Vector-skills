# 🧭 NavUtil · ShortcutUtil · 导航与快捷方式

> 📂 [`app/src/main/java/org/lsposed/manager/util/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/)
> 🟦 app 模块 · 外链打开与桌面快捷方式

## 包职责

- `NavUtil`：用 Custom Tabs 打开外链，跟随主题色与夜间模式；
- `ShortcutUtil`：为寄生管理器创建/更新/查询桌面快捷方式（寄生模式无独立启动入口，靠快捷方式拉起）。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`NavUtil`](#navutil) | Custom Tabs 打开 URL |
| [`ShortcutUtil`](#shortcututil) | 桌面快捷方式创建/更新/查询 |

---

## NavUtil

`public final class NavUtil` —— 全静态方法，封装 `androidx.browser.customtabs.CustomTabsIntent`。

### 方法签名

```java
// 用 Custom Tabs 打开 Uri，配主题色与夜间方案；无浏览器则 Toast URL
public static void startURL(Activity activity, Uri uri)

// 字符串 URL 重载
public static void startURL(Activity activity, String url)
```

`CustomTabColorSchemeParams` 取 `colorBackground`、`navigationBarColor`；夜间模式按 `ResourceUtils.isNightMode` 选 `COLOR_SCHEME_DARK`/`LIGHT`。`ActivityNotFoundException` 时退化为 `Toast` 显示 URL。

---

## ShortcutUtil

`public class ShortcutUtil` —— 围绕 `ShortcutManager` 管理一个固定 ID 的快捷方式。

### 关键常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `SHORTCUT_ID` | `"org.lsposed.manager.shortcut"` | 快捷方式固定 ID |

### 方法签名

```java
// 是否支持请求固定快捷方式
public static boolean isRequestPinShortcutSupported(Context context) throws RuntimeException

// 请求固定快捷方式到桌面，afterPinned 在系统确认广播后回调
public static boolean requestPinLaunchShortcut(Runnable afterPinned)

// 更新已固定快捷方式（图标/Intent）
public static boolean updateShortcut()

// 是否已固定
public static boolean isLaunchShortcutPinned()
```

`requestPinLaunchShortcut` 仅寄生模式可用（否则抛 `RuntimeException`），通过 `registerReceiver` 注册一个 UUID action 广播接收器（`CREATE_USERS` 权限、`RECEIVER_EXPORTED`），把其 `IntentSender` 作为 `requestPinShortcut` 的回调。`getLaunchIntent` 优先用 `pm.getLaunchIntentForPackage`，失败则遍历 activities 找主进程 Activity，并加 `org.lsposed.manager.LAUNCH_MANAGER` category。

### 关键私有方法

```java
private static Bitmap getBitmap(Context context, int id)        // drawable → bitmap，兼容 AdaptiveIcon
private static Intent getLaunchIntent(Context context)          // 构造启动管理器的 Intent
private static IntentSender registerReceiver(Context context, Runnable task)  // 注册一次性回调广播
private static ShortcutInfo.Builder getShortcutBuilder(Context context)       // 构造 ShortcutInfo
```

## 快捷方式流程

```mermaid
flowchart TD
    A["requestPinLaunchShortcut(afterPinned)"] --> B{"App.isParasitic?"}
    B -->|否| C["throw RuntimeException"]
    B -->|是| D{"isRequestPinShortcutSupported?"}
    D -->|否| E["return false"]
    D -->|是| F["registerReceiver 注册 UUID 广播"]
    F --> G["getShortcutBuilder.build"]
    G --> H["sm.requestPinShortcut(intent, IntentSender)"]
    H --> I["系统弹固定确认"]
    I --> J["用户确认 → 广播 UUID"]
    J --> K["receiver.onReceive: unregister + afterPinned.run"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class F,G,H,K class vec
    class B,D class hot
    class A,C,E,I,J class plain
```

## 相关

- [app 模块总览](../../modules/app)
- [WelcomeDialog · 寄生欢迎弹窗](./welcome-dialog)（调用 `requestPinLaunchShortcut`）
