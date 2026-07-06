# 🧩 StatefulRecyclerView

> 📂 [`app/src/main/java/org/lsposed/manager/ui/widget/StatefulRecyclerView.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/ui/widget/StatefulRecyclerView.java)
> 🟦 app 模块 · 带状态保存的 RecyclerView 基类

## 类职责

`public class StatefulRecyclerView extends BorderRecyclerView` 是管理器所有列表控件的**共同基类**。它在配置变更（旋转、暗色模式切换等导致 Activity 重建）时，把 RecyclerView 自身的 `Parcelable` 状态与 `ViewPager2` 风格的 `StatefulAdapter` 适配器状态一并存入 `Bundle`，重建后再分别恢复——保证列表滚动位置、`ConcatAdapter` 子适配器的展开/选中态不丢失。

## 核心机制

- 自身继承 `rikka.widget.borderview.BorderRecyclerView`，提供边框绘制；
- `onSaveInstanceState` 把父类状态包进 `superState`，再判断当前 `Adapter` 是否实现 `androidx.viewpager2.adapter.StatefulAdapter`，若是则把 `saveState()` 结果放进 `adaptor` key；
- `onRestoreInstanceState` 反向解包，先恢复父类，再恢复适配器。

## Bundle 键

| key | 类型 | 含义 |
| :--- | :--- | :--- |
| `superState` | `Parcelable` | `BorderRecyclerView` 父类保存的滚动/布局状态 |
| `adaptor` | `Parcelable` | `StatefulAdapter.saveState()` 返回的适配器状态（仅当 adapter 实现 `StatefulAdapter`） |

## 设计要点

- **为何区分 superState / adaptor**：RecyclerView 自身的 `Parcelable`（`LayoutManager`、滚动偏移）与适配器的逻辑状态（勾选、展开）属于不同层，混存会导致恢复顺序错乱。分键存储后，`onRestoreInstanceState` 可先恢复视图层、再恢复数据层。
- **`StatefulAdapter` 判定而非强类型**：通过 `instanceof` 探测，使任意实现 `androidx.viewpager2.adapter.StatefulAdapter` 的适配器（如 `SimpleStatefulAdaptor`、`ConcatAdapter` 的子适配器）都能受益，无需本类强制依赖具体类型。
- **非 Bundle 时的退化**：若传入的 `state` 不是 `Bundle`（极端情况，如框架直接传父类状态），直接走 `super.onRestoreInstanceState`，不破坏原有行为。
- **继承链**：`StatefulRecyclerView` → `BorderRecyclerView`（边框绘制）→ `RecyclerView`，状态保存方法逐层向上调用 `super`。

## 方法签名

```java
// 构造（三个标准重载）
public StatefulRecyclerView(@NonNull Context context)
public StatefulRecyclerView(@NonNull Context context, @Nullable AttributeSet attrs)
public StatefulRecyclerView(@NonNull Context context, @Nullable AttributeSet attrs, int defStyle)

// 保存状态：父类状态 + StatefulAdapter 状态
@Override
public Parcelable onSaveInstanceState()

// 恢复状态：先恢复父类，再恢复适配器
@Override
public void onRestoreInstanceState(Parcelable state)
```

## 状态流转

```mermaid
flowchart TD
    A["配置变更/Activity 销毁"] --> B["onSaveInstanceState"]
    B --> C{"adapter 实现 StatefulAdapter?"}
    C -->|是| D["saveState 存入 adaptor"]
    C -->|否| E["仅存 superState"]
    D --> F["Bundle 返回框架"]
    E --> F
    G["Activity 重建"] --> H["onRestoreInstanceState"]
    H --> I["恢复 superState"]
    I --> J{"含 adaptor?"}
    J -->|是| K["restoreState"]
    J -->|否| L["结束"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,D,H,I,K class vec
    class C,J class hot
    class A,F,G,L,E class plain
```

## 子类

| 子类 | 增强点 |
| :--- | :--- |
| `EmptyStateRecyclerView` | 重写 `dispatchDraw`，在适配器为空且已加载时绘制居中空状态文案；定义 `EmptyStateAdapter` 抽象基类 |

`EmptyStateRecyclerView` 的 `dispatchDraw` 会穿透 `ConcatAdapter` 找到第一个 `EmptyStateAdapter`，只有 `isLoaded() && getItemCount() == 0` 时才绘制 `R.string.list_empty`，避免加载中误显空状态。

## 使用要点

- XML 布局里直接用全限定类名 `<org.lsposed.manager.ui.widget.StatefulRecyclerView>` 即可获得状态保存，无需在 Activity 手动处理；
- 适配器需实现 `StatefulAdapter`（最简方式是继承 `SimpleStatefulAdaptor`），否则只有父类 `superState` 被保存；
- `ConcatAdapter` 场景下，只要任一子适配器是 `StatefulAdapter`，本类只保存**第一个**（`getAdapters()` 顺序），多 StatefulAdapter 子项需自行合并状态；
- 配置变更外的销毁（如用户主动 finish）不会触发 `onSaveInstanceState`，本机制仅覆盖框架重建场景。

## 相关

- [app 模块总览](../../modules/app)
- [app · adapters 包](../app-adapters)（`ScopeAdapter` 等 `EmptyStateAdapter` 子类受益于此机制）
- [accessibility-utils · 无障碍辅助](./accessibility-utils)（`SimpleStatefulAdaptor` 提供按条目状态保存）
