# 🏡 HomeFragment

> 📂 [`app/src/main/java/org/lsposed/manager/ui/fragment/HomeFragment.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/fragment/HomeFragment.java)
> 🟦 app 模块 · 首页状态卡

## 类职责

`public class HomeFragment extends BaseFragment implements MenuProvider` 是管理器首页。它根据 `ConfigManager.isBinderAlive()` 与 `UpdateUtil.needUpdate()` 渲染状态卡：已激活 / 部分激活 / 未安装 / 需更新，并展示版本、API、dex2oat 兼容性、系统版本、设备、ABI 等诊断信息，提供「复制信息」按钮。顶部工具栏点击弹出关于对话框。

`onCreate` 时还会触发 `WelcomeDialog.showIfNeed` 首次欢迎弹窗。

## 状态判定

`updateStates(Activity, binderAlive, needUpdate)` 是核心，分支如下：

| binderAlive | 条件 | 显示 |
| :--- | :--- | :--- |
| true + needUpdate | — | 「需要更新」卡 + 跳转最新版 URL |
| true + 正常 | sepolicy/systemServer/dex2oat 全 OK | 「已激活」✓ |
| true | 任一异常 | 「部分激活」⚠ + 对应警告文案 |
| false + Magisk 已装 | — | 「安装」卡 |
| false + 无 Magisk | — | 「未安装」 |

dex2oat 异常条件：`getDex2OatWrapperCompatibility() != DEX2OAT_OK && !dex2oatFlagsLoaded()`。

## 诊断信息

状态摘要格式：`getXposedVersionName() (getXposedVersionCode())`。dex2oat 兼容性按 `ILSPManagerService.DEX2OAT_*` 常量映射到 `supported` / `unsupported (crashed|mount_failed|selinux_permissive|sepolicy_incorrect)`；Android 10 以下直接标 unsupported。

`copyInfo` 把 API/dex2oat/框架版本/管理器包名/系统版本/设备/ABI 拼成纯文本写入剪贴板。

## 开发者检测

```java
private boolean isDeveloper()
```

扫描 `/data/local/tmp/.studio/ipids` 下的 pid 文件，对每个 pid 发 `Os.kill(pid, 0)`（信号 0 仅探测存活）：进程存活或返回非 `ESRCH` 错误即判为开发者，显示开发者警告卡。`ESRCH` 时清理过期 pid 文件。

## 菜单与关于

`onPrepareMenu` 绑定「关于」「反馈 issue」菜单项。`showAbout()` 弹出内部类 `AboutDialog`（`DialogFragment`），展示版本号、GitHub/Telegram 链接，用 `LinkTransformationMethod` 让链接可点。

## 内部类 AboutDialog

```java
public static class AboutDialog extends DialogFragment {
    @NonNull @Override
    public Dialog onCreateDialog(@Nullable Bundle savedInstanceState)
}
```

`onCreateDialog` 用 `DialogAboutBinding` inflate 视图，标题设为 `app_name`，信息区设为 HTML（`about_view_source_code` 文案，含 GitHub/Telegram `<a>` 链接）经 `HtmlCompat.fromHtml` 解析、`LinkMovementMethod` + `LinkTransformationMethod` 让链接可点可样式化，版本号格式 `BuildConfig.VERSION_NAME (BuildConfig.VERSION_CODE)`，外套 `BlurBehindDialogBuilder`。

## 视图与生命周期

```java
@Override public void onCreate(@Nullable Bundle savedInstanceState)   // WelcomeDialog.showIfNeed
@Override public View onCreateView(@NonNull LayoutInflater, ViewGroup, Bundle)
@Override public void onDestroyView()                                 // binding=null
```

`onCreateView` 绑定 `FragmentHomeBinding`，配置工具栏（无导航图标、点击弹关于）、`appBar.setLiftable(true)`、`nestedScrollView` 边界显隐回调联动 `appBar.setLifted`，最后调 `updateStates(requireActivity(), isBinderAlive(), needUpdate())` 渲染状态。`onDestroyView` 清空 `binding` 防内存泄漏。

## 诊断信息字段

| 字段 | 来源 |
| :--- | :--- |
| apiVersion | `ConfigManager.getXposedApiVersion()` |
| frameworkVersion | `getXposedVersionName() (getXposedVersionCode())` |
| managerPackageName | `activity.getPackageName()` |
| dex2oatWrapper | `getDex2OatWrapperCompatibility()` 映射到 supported/unsupported 子状态 |
| systemVersion | `Build.VERSION.RELEASE/CODENAME (API)`，预览版带 Preview 标记 |
| device | `Build.MANUFACTURER + BRAND + MODEL`（首字母大写） |
| systemAbi | `Build.SUPPORTED_ABIS[0]` |

`getDevice` 把 `MANUFACTURER` 与 `BRAND` 首字母大写拼接，两者不同时都显示，再附 `MODEL`。

## 状态卡判定流程

```mermaid
flowchart TD
    A["updateStates"] --> B{"binderAlive?"}
    B -->|是| C{"needUpdate?"}
    C -->|是| D["更新卡可见"]
    C -->|否| E{"sepolicy / systemServer<br/>/ dex2oat 任一异常?"}
    E -->|是| F["部分激活 ⚠<br/>对应警告文案"]
    E -->|否| G["已激活 ✓"]
    B -->|否| H{"isMagiskInstalled?"}
    H -->|是| I["安装卡"]
    H -->|否| J["未安装"]
    D --> K["填充版本/API/dex2oat/<br/>系统/设备/ABI 信息"]
    F --> K
    G --> K

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    class A class core
    class B,C,E,H class branch
    class D,F,G,I,J,K class ui
```

## 相关

- [ConfigManager · 状态诊断方法](./config-manager)
- [MainActivity · 宿主 Activity](./main-activity)
- [app · fragment 总览](../app-fragment)
