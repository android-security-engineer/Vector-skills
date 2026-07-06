# app · ui/widget 包

> 📂 [`app/src/main/java/org/lsposed/manager/ui/widget/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/widget/)
> 🟦 管理器的自定义控件

## 包职责

提供管理器 UI 用到的自定义 View：带状态保存的 RecyclerView、空态提示 RecyclerView、可展开/收起的文本视图、链接化 TextView、以及能在 RecyclerView 内正确滚动嵌套的 WebView。这些控件是各 Fragment 列表与详情页的基础积木。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`StatefulRecyclerView`](#statefulrecyclerview) | 保存/恢复 Adapter 状态的 RecyclerView |
| [`EmptyStateRecyclerView`](#emptystaterecyclerview) | 列表空时绘制提示文字的 RecyclerView |
| [`ExpandableTextView`](#expandabletextview) | 可展开/收起、带"展开/收起"链接的 TextView |
| [`LinkifyTextView`](#linkifytextview) | 拦截链接点击、让父 View 处理 ripple 的 TextView |
| [`ScrollWebView`](#scrollwebview) | 与 RecyclerView 嵌套协同滚动的 WebView |

```mermaid
graph TD
    BORDER["BorderRecyclerView<br/>(rikka 基类)"]:::ext
    STATE["StatefulRecyclerView"]:::ui
    EMPTY["EmptyStateRecyclerView"]:::ui
    ADAPTER["EmptyStateAdapter&lt;T&gt;<br/>(抽象适配器基类)"]:::ui

    BORDER <|-- STATE
    STATE <|-- EMPTY
    EMPTY -- "静态内部类" --> ADAPTER
    ADAPTER -- "继承" --> SSA["SimpleStatefulAdaptor<br/>(util 包)"]:::ui

    classDef ui fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef ext fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
```

---

## StatefulRecyclerView

`public class StatefulRecyclerView extends BorderRecyclerView`（继承 rikka 的带边框 RecyclerView）

**状态保存型 RecyclerView**。重写 `onSaveInstanceState` / `onRestoreInstanceState`，当其 Adapter 实现了 `androidx.viewpager2.adapter.StatefulAdapter` 时，把 Adapter 状态一并存入/恢复 Bundle。配合 `SimpleStatefulAdaptor` 实现列表项滚动位置与内部状态的跨配置变更保留。

### 主要方法

```java
@Override public Parcelable onSaveInstanceState()      // 存 superState + adaptor.saveState()
@Override public void onRestoreInstanceState(Parcelable state)  // 恢复 superState + adaptor.restoreState()
```

存盘结构：`Bundle { "superState": Parcelable, "adaptor": Parcelable }`。

---

## EmptyStateRecyclerView

`public class EmptyStateRecyclerView extends StatefulRecyclerView`

**空态提示 RecyclerView**。重写 `dispatchDraw`，在 Adapter 已加载但条目数为 0 时，于列表中心绘制 `R.string.list_empty` 提示文字。支持 `ConcatAdapter`——会从中找出 `EmptyStateAdapter` 子适配器判断空态。

### 构造与绘制

```java
public EmptyStateRecyclerView(Context context, @Nullable AttributeSet attrs, int defStyle)
// 绘制：paint 取 textColorSecondary、字号 16sp，居中 StaticLayout
@Override protected void dispatchDraw(Canvas canvas)
```

`dispatchDraw` 逻辑：

1. 先 `super.dispatchDraw(canvas)` 画完列表内容。
2. 若 adapter 是 `ConcatAdapter`，遍历其内含适配器找 `EmptyStateAdapter`。
3. 命中的 `EmptyStateAdapter` 满足 `isLoaded() && getItemCount() == 0` 时，在视图中心画空态文字。

### 内部类 EmptyStateAdapter

```java
public abstract static class EmptyStateAdapter<T extends ViewHolder>
        extends SimpleStatefulAdaptor<T> {
    abstract public boolean isLoaded();
}
```

继承 `util` 包的 `SimpleStatefulAdaptor`（自带状态保存），只新增一个 `isLoaded()` 抽象方法供子类实现（表示数据是否已加载完毕，避免"加载中"误显示空态）。`ModulesFragment.ModuleAdapter`、`LogsFragment.LogAdaptor`、`RepoFragment.RepoAdapter`、`RepoItemFragment.ReleaseAdapter` 都继承它。

---

## ExpandableTextView

`public class ExpandableTextView extends MaterialTextView`

**可展开/收起的文本视图**。文本超出行数上限时，自动在末行追加"展开"/"收起"可点击链接，点击后通过 `TransitionManager.beginDelayedTransition` 平滑改变 `maxLines`。

### 关键字段

| 字段 | 含义 |
| :--- | :--- |
| `maxLines` | XML 里声明的初始最大行数（构造时记录） |
| `nextLines` | 展开后要设的行数 |
| `collapse` / `expand` | "收起"/"展开"文本（带 `ClickableSpan`） |
| `lineCount` | 实际测得的文本总行数 |

### 工作流程

1. `setText` 存原文，`onPreDraw` 首次绘制时测 `lineCount`。
2. 若 `lineCount > maxLines`：末行截断处追加"展开"链接；点击后设 `nextLines = lineCount + 1` 并 `super.setText(text)` 重新绘制。
3. 重新绘制后 `nextLines == getMaxLines()`，改为追加"收起"链接；点击后回 `maxLines`。
4. `onLayout` 持续更新 `lineCount`。

### 触摸处理

```java
@Override public boolean onTouchEvent(@NonNull MotionEvent event)
```

`onTouchEvent` 计算触摸点对应的文本偏移，仅当落在 `ClickableSpan` 上才交给 `super` 处理——否则返回 false，让父 View 处理点击（保证 ripple 等正常）。

### 状态保存

```java
@Override protected Parcelable onSaveInstanceState()        // 存 maxLines
@Override protected void onRestoreInstanceState(Parcelable state)
```

保存当前 `maxLines`，跨配置变更保持展开/收起状态。

---

## LinkifyTextView

`public class LinkifyTextView extends androidx.appcompat.widget.AppCompatTextView`

**链接拦截 TextView**。`onTouchEvent` 在 `ACTION_DOWN` 时记录触摸点所在的 `ClickableSpan`（存入 `mCurrentSpan`），但**不立即触发点击**——点击交给父/祖父 View 处理，保证 ripple 等反馈正常。父 View 可在 `onClick` 里通过 `getCurrentSpan()` 取出当前链接并决定动作（如 `RepoItemFragment.InformationAdapter` 用它实现"点协作者条目跳转 GitHub"）。

### 主要方法

```java
public ClickableSpan getCurrentSpan()       // 取 ACTION_DOWN 时记录的 span
public void clearCurrentSpan()              // 清除（消费后调用）

@Override public boolean onTouchEvent(@NonNull MotionEvent event)
```

::: tip 设计意图
注释说明：若让 TextView 自己处理点击，ripple 不生效且非链接区域也会吞掉事件。这里只在 `ACTION_DOWN` 分析出命中的 span，真正的 click 交给父级，从而两全其美。
:::

---

## ScrollWebView

`public class ScrollWebView extends WebView`

**嵌套滚动 WebView**。解决 WebView 放在 RecyclerView 内部时手势冲突：按下时请求父级不要拦截触摸事件，水平滚动到边界时再放权。

### 主要方法

```java
@Override public boolean onTouchEvent(MotionEvent event)          // DOWN 时 disallowIntercept
@Override protected void onOverScrolled(int scrollX, int scrollY, boolean clampedX, boolean clampedY)
private static ViewParent findViewParentIfNeeds(View v)          // 找到最近的 RecyclerView（非 BorderRecyclerView）
```

### 嵌套滚动逻辑

- `ACTION_DOWN`：`findViewParentIfNeeds` 找到最近的 `RecyclerView`（但跳过 `BorderRecyclerView`，因后者自身处理边界），对其 `requestDisallowInterceptTouchEvent(true)`。
- `onOverScrolled` 且 `clampedX`（水平到达边界）：`requestDisallowInterceptTouchEvent(false)`，把控制权交还父级，使外层列表可以接管竖向滚动。

`RepoItemFragment` 用它渲染模块 README 与发布说明的 HTML（GitHub Markdown）。

## 相关

- [app 模块总览](../modules/app)
- [app · fragment 包](./app-fragment)（消费这些控件）
- [app · util 包](./app-util)（`SimpleStatefulAdaptor` 是 `EmptyStateAdapter` 的基类）
