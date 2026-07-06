# 🎨 ThemeUtil

> 📂 [`app/src/main/java/org/lsposed/manager/util/ThemeUtil.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/ThemeUtil.java)
> 🟦 app 模块 · 主题色与深色模式

## 类职责

`public class ThemeUtil` 是管理器主题的**静态配置工具**。它根据偏好决定深色模式（跟随系统/始终/从不）、夜间主题（默认/纯黑）、颜色主题（19 种 Material 色或系统动态取色），并提供对应的 `@StyleRes` 资源 id 与 `AppCompatDelegate` 夜间模式常量。所有状态读自 `App.getPreferences()`，无实例字段。

`App.onCreate` 用 `getDarkTheme()` 设置 `AppCompatDelegate.setDefaultNightMode`，主题/语言变更后 `MainActivity.restart()` 重建生效。

## 关键常量

| 常量 | 值 | 含义 |
| :--- | :--- | :--- |
| `MODE_NIGHT_FOLLOW_SYSTEM` | `"MODE_NIGHT_FOLLOW_SYSTEM"` | 跟随系统深色 |
| `MODE_NIGHT_NO` | `"MODE_NIGHT_NO"` | 始终浅色 |
| `MODE_NIGHT_YES` | `"MODE_NIGHT_YES"` | 始终深色 |
| `colorThemeMap` | `Map<String,Integer>` | 19 个色名 → `ThemeOverlay_Material*` style |
| `THEME_DEFAULT` / `THEME_BLACK` | — | 夜间主题两种 |

颜色映射覆盖：SAKURA、MATERIAL_RED/PINK/PURPLE/DEEP_PURPLE/INDIGO/BLUE/LIGHT_BLUE/CYAN/TEAL/GREEN/LIGHT_GREEN/LIME/YELLOW/AMBER/ORANGE/DEEP_ORANGE/BROWN/BLUE_GREY。

## 主要方法

```java
public static boolean isSystemAccent()   // DynamicColors 可用且 follow_system_accent=true
public static String getNightTheme(Context context)          // 黑夜主题+夜间模式 → "BLACK" 否则 "DEFAULT"
@StyleRes public static int getNightThemeStyleRes(Context context)  // ThemeOverlay_Black / ThemeOverlay
public static String getColorTheme()                         // 系统取色 → "SYSTEM"，否则 theme_color 偏好
@StyleRes public static int getColorThemeStyleRes()          // colorThemeMap 查表，默认 MaterialBlue
public static int getDarkTheme(String mode)                  // → AppCompatDelegate.MODE_NIGHT_* 常量
public static int getDarkTheme()                             // 读 dark_theme 偏好后转发
```

`getColorThemeStyleRes` 找不到映射时回退 `R.style.ThemeOverlay_MaterialBlue`。`getNightTheme` 必须同时满足「开启了纯黑夜间主题」与「当前处于夜间模式」才返回 BLACK。

`isBlackNightTheme` 是私有方法，读 `black_dark_theme` 偏好；`isSystemAccent` 要求 `DynamicColors.isDynamicColorAvailable()`（Android 12+ 动态取色）且 `follow_system_accent` 偏好为真。`getColorTheme` 在系统取色开启时直接返回 `"SYSTEM"`，跳过 `theme_color` 偏好。

`colorThemeMap` 在 `static {}` 块中一次性填充 19 个映射，`preferences` 也在静态块里从 `App.getPreferences()` 取——意味着该类首次被访问时 `App` 单例必须已就绪（实际由 `App.onCreate` 先执行保证）。

## 主题决策流程

```mermaid
flowchart TD
    A["getDarkTheme()"] --> B["读 dark_theme 偏好"]
    B --> C{"mode?"}
    C -->|FOLLOW_SYSTEM| D["MODE_NIGHT_FOLLOW_SYSTEM"]
    C -->|YES| E["MODE_NIGHT_YES"]
    C -->|NO| F["MODE_NIGHT_NO"]
    G["getNightThemeStyleRes"] --> H["isBlackNightTheme?"]
    H -->|是 + 夜间| I["ThemeOverlay_Black"]
    H -->|否| J["ThemeOverlay"]
    K["getColorThemeStyleRes"] --> L["isSystemAccent?"]
    L -->|是| M["SYSTEM（动态取色）"]
    L -->|否| N["theme_color 偏好 → colorThemeMap"]
    N --> O{"命中?"}
    O -->|是| P["对应 ThemeOverlay_Material*"]
    O -->|否| Q["ThemeOverlay_MaterialBlue"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,B,G,H,K,L class core
    class C,D,E,F,I,J,M,N,P,Q class ui
    class O class branch
```

## 颜色映射表

| 色名 | 对应 style |
| :--- | :--- |
| SAKURA | `ThemeOverlay_MaterialSakura` |
| MATERIAL_RED / PINK / PURPLE / DEEP_PURPLE | `ThemeOverlay_MaterialRed` 等 |
| MATERIAL_INDIGO / BLUE / LIGHT_BLUE / CYAN | `ThemeOverlay_MaterialIndigo` 等 |
| MATERIAL_TEAL / GREEN / LIGHT_GREEN / LIME | `ThemeOverlay_MaterialTeal` 等 |
| MATERIAL_YELLOW / AMBER / ORANGE / DEEP_ORANGE | `ThemeOverlay_MaterialYellow` 等 |
| MATERIAL_BROWN / BLUE_GREY | `ThemeOverlay_MaterialBrown` / `_BlueGrey` |

`getColorTheme` 默认 fallback 字符串是 `"COLOR_BLUE"`（`theme_color` 偏好默认值），但 `colorThemeMap` 的 key 是 `"MATERIAL_BLUE"`——故首次未设偏好时会走 `colorThemeMap.get("COLOR_BLUE")` 返回 null，落到 `ThemeOverlay_MaterialBlue` 兜底分支，结果与 `MATERIAL_BLUE` 一致。

## getDarkTheme 映射

| 输入 mode | AppCompatDelegate 常量 |
| :--- | :--- |
| `MODE_NIGHT_FOLLOW_SYSTEM`（默认） | `MODE_NIGHT_FOLLOW_SYSTEM` |
| `MODE_NIGHT_YES` | `MODE_NIGHT_YES` |
| `MODE_NIGHT_NO` | `MODE_NIGHT_NO` |

`getDarkTheme(String mode)` 是 switch 映射，`default` 落到 FOLLOW_SYSTEM；无参 `getDarkTheme()` 读 `dark_theme` 偏好（默认 `MODE_NIGHT_FOLLOW_SYSTEM`）后转发。`App.onCreate` 调用无参版本设置 `AppCompatDelegate.setDefaultNightMode`，决定整个应用初始夜间模式。

## 夜间与颜色主题

夜间主题（`getNightThemeStyleRes`）返回 `ThemeOverlay_Black` 或 `ThemeOverlay`，由 Activity 在 `onCreate` 时作为 overlay 应用。颜色主题（`getColorThemeStyleRes`）独立返回 Material 色 overlay。两者叠加构成最终主题。系统动态取色（`isSystemAccent`）开启时颜色主题被 `"SYSTEM"` 取代，由 `DynamicColors` 在 Activity 上 applyDynamicColors 实际着色。

## 相关

- [App · Application 入口](./app-entry) — `onCreate` 调 `getDarkTheme()`
- [SettingsFragment · 主题偏好项](./settings-fragment) — `dark_theme`/`theme_color`/`follow_system_accent`/`black_dark_theme`
- [MainActivity · restart 重建](./main-activity) — 主题变更后重建 Activity
