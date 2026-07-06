# 📜 LogsFragment

> 📂 [`app/src/main/java/org/lsposed/manager/ui/fragment/LogsFragment.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/fragment/LogsFragment.java)
> 🟦 app 模块 · 日志查看（Verbose / 模块日志双页）

## 类职责

`public class LogsFragment extends BaseFragment implements MenuProvider` 是日志页。用 `ViewPager2` + `TabLayout` 承载两页——模块日志（`getModulesLog`）与详细日志（`getVerboseLog`），通过 `ConfigManager.getLog(boolean verbose)` 拿到 `ParcelFileDescriptor`，按行读入 `List<CharSequence>` 渲染。提供保存为 zip、滚动到顶/底、清空、自动换行开关等操作。

工具栏副标题显示详细日志开关状态（`isVerboseLogEnabled`）。

## 双页结构

`LogPageAdapter extends FragmentStateAdapter`，固定 2 页，`verbose(position)` = `position != 0`（第 0 页模块日志、第 1 页 verbose）。`getItemViewType` 由「自动换行」偏好决定：开启用 `LogFragment`（垂直换行）、关闭用 `UnwrapLogFragment`（横向滚动不换行）。

## 内部类 LogFragment

```java
public static class LogFragment extends BaseFragment
```

| 成员 | 作用 |
| :--- | :--- |
| `SCROLL_THRESHOLD` | `500`，超过则跳过动画直接 `scrollToPosition` |
| `verbose` | 从 arguments 读取，决定读哪条日志 |
| `adaptor` | `LogAdaptor`，`List<CharSequence>` → TextView |
| `fullRefresh()` | 后台读 PFD → `BufferedReader.lines().parallel()` → `refresh(tmp)` |
| `scrollToTop/Bottom` | 与父 `LogsFragment` 协作折叠/展开 appBar |

`fullRefresh` 用 try-with-resources 关闭 PFD 与 reader；异常时把堆栈按行塞进列表兜底。RecyclerView 强制 `LAYOUT_DIRECTION_LTR`（日志格式不受 RTL 影响）。

## UnwrapLogFragment

```java
public static class UnwrapLogFragment extends LogFragment
```

在 RecyclerView 外包一层 `HorizontalScrollView`，`onBindViewHolder` 里 `view.measure(0,0)` 测出期望宽度并动态设 `layoutParams.width`，实现长行不换行横向滚动。无障碍关闭动画时禁用 overScroll。

## 生命周期与监听

```java
@Override public View onCreateView(...)
@Override public boolean onMenuItemSelected(@NonNull MenuItem item)
@Override public void onPrepareMenu(@NonNull Menu menu)
@Override public void onCreateMenu(@NonNull Menu, @NonNull MenuInflater)
@Override public void onDestroyView()
public void setOptionsItemSelectListener(OptionsItemSelectListener optionsItemSelectListener)
```

`onCreateView` 配置工具栏副标题（`isVerboseLogEnabled` ? `enabled_verbose_log` : `disabled_verbose_log`）、`LogPageAdapter`、`TabLayoutMediator`（`isAnimationEnabled` 来自 `AccessibilityUtils`），并加布局变更监听在 tab 总宽不超屏时切 `MODE_FIXED` + `GRAVITY_FILL`。`onPrepareMenu` 读取 `enable_word_wrap` 偏好设菜单勾选与 ViewPager 滑动开关。`onDestroyView` 清空 `binding`。

## OptionsItemSelectListener

```java
interface OptionsItemSelectListener {
    boolean onOptionsItemSelected(@NonNull MenuItem item);
}
```

`LogFragment.attachListeners` 把自己的滚动/清空逻辑注册为父 `LogsFragment` 的 `optionsItemSelectListener`；父 `onMenuItemSelected` 先处理 save/word_wrap，其余转发给当前页的 listener。`detachListeners` 仅解绑边界监听（滚动/清空依赖 listener 实时注册）。

## 菜单与保存

| 菜单 | 行为 |
| :--- | :--- |
| `menu_save` | `saveLogsLauncher`（`CreateDocument("application/zip")`）→ 后台调 `LSPManagerServiceHolder.getService().getLogs(zipFd)` 打包全量日志 |
| `menu_word_wrap` | 切换 `enable_word_wrap` 偏好、`ViewPager.setUserInputEnabled`、`adapter.refresh()` |
| `menu_scroll_top/down` | 委托给当前 `LogFragment` |
| `menu_clear` | `ConfigManager.clearLogs(verbose)` 后 `fullRefresh()` |

`LogFragment` 通过 `setOptionsItemSelectListener` 把滚动/清空菜单回调注册到父 Fragment。

## 读取与保存流程

```mermaid
flowchart TD
    A["LogFragment.fullRefresh"] --> B["ConfigManager.getLog(verbose)"]
    B --> C["ParcelFileDescriptor"]
    C --> D["BufferedReader.lines().parallel()"]
    D --> E{"异常?"}
    E -->|是| F["堆栈按行兜底"]
    E -->|否| G["List<CharSequence>"]
    F --> H["adaptor.refresh → notifyDataSetChanged"]
    G --> H
    I["menu_save"] --> J["CreateDocument zip"]
    J --> K["getLogs(zipFd) IPC"]
    K --> L["写入 Downloads"]

    classDef core fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef ipc fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef branch fill:#3a2a10,stroke:#e8a838,color:#fff
    class A,D,H class core
    class B,C,K class ipc
    class E class branch
    class F,G,I,J,L class ipc
```

## 相关

- [ConfigManager · 日志方法](./config-manager) — `getLog` / `clearLogs` / `isVerboseLogEnabled`
- [ILSPManagerService · 日志 IPC](../../aidl/ilspmanagerservice)
- [SettingsFragment · verbose 开关](./settings-fragment)
