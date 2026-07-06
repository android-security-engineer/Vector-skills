# 🖼️ AppIconModelLoader · Glide 图标加载

> 📂 [`app/src/main/java/org/lsposed/manager/util/AppIconModelLoader.java`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/AppIconModelLoader.java)
> 🟦 app 模块 · 以 `PackageInfo` 为模型的 Glide 图标加载器

## 类职责

`public class AppIconModelLoader implements ModelLoader<PackageInfo, Bitmap>` 让 Glide 直接以 `PackageInfo` 作为模型加载应用图标，底层委托 `me.zhanghai.android.appiconloader.AppIconLoader`。这样列表页可直接 `Glide.with(...).load(packageInfo)`，由 Glide 负责缓存与异步，避免每个条目手写 `PackageManager.getApplicationIcon`。

## 关键设计

- **UID 跨用户归一**：`buildLoadData` 里把 `ApplicationInfo.uid` 模 `App.PER_USER_RANGE`，使同一应用在不同用户下的图标共享缓存键；
- **缓存键**：`AppIconLoader.getIconKey(warpPackageInfo, context)`，含包名/版本/图标变更戳；
- **数据源标记为 LOCAL**：`getDataSource()` 返回 `DataSource.LOCAL`，告诉 Glide 这是本地读取、不走磁盘缓存二级；
- **`handles` 恒真**：所有 `PackageInfo` 模型都由本 loader 处理。

## 方法签名

```java
// 构造（私有，由 Factory 创建）
private AppIconModelLoader(@Px int iconSize, boolean shrinkNonAdaptiveIcons, @NonNull Context context)

@Override
public boolean handles(@NonNull PackageInfo model)

@Nullable
@Override
public LoadData<Bitmap> buildLoadData(@NonNull PackageInfo model, int width, int height,
                                      @NonNull Options options)
```

## 内部类

### Fetcher（私有静态）

`implements DataFetcher<Bitmap>` —— 实际执行图标加载。`loadData` 调 `mLoader.loadIcon(mApplicationInfo)`，成功回调 `onDataReady`，异常回调 `onLoadFailed`；`cleanup`/`cancel` 空实现。

```java
public void loadData(@NonNull Priority priority, @NonNull DataCallback<? super Bitmap> callback)
public void cleanup()
public void cancel()
@NonNull public Class<Bitmap> getDataClass()
@NonNull public DataSource getDataSource()
```

### Factory（公开静态）

`implements ModelLoaderFactory<PackageInfo, Bitmap>` —— 注册到 Glide 的工厂，持有 `iconSize`、`shrinkNonAdaptiveIcons`、`context`。

```java
public Factory(@Px int iconSize, boolean shrinkNonAdaptiveIcons, @NonNull Context context)

@NonNull
@Override
public ModelLoader<PackageInfo, Bitmap> build(@NonNull MultiModelLoaderFactory multiFactory)

@Override
public void teardown()
```

## 加载链路

```mermaid
flowchart LR
    A["Glide.load(packageInfo)"] --> B["AppIconModelLoader"]
    B --> C["buildLoadData"]
    C --> D["UID 模 PER_USER_RANGE"]
    D --> E["AppIconLoader.getIconKey"]
    E --> F["LoadData + Fetcher"]
    F --> G["Fetcher.loadData"]
    G --> H["AppIconLoader.loadIcon"]
    H --> I["Bitmap → onDataReady"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    class B,C,D,E,F,G,H class vec
    class A,I class plain
```

## 注册与使用

- `Factory` 通过 `Glide.register(PackageInfo, Bitmap, Factory)` 注册一次，之后 `Glide.with(view).load(packageInfo).into(imageView)` 自动命中本 loader；
- `shrinkNonAdaptiveIcons` 控制是否把非自适应图标缩放到前景区域，列表场景通常 true 以保证视觉一致；
- `DataSource.LOCAL` 让 Glide 不走网络/磁盘缓存二级，图标直接由 `AppIconLoader` 从 `PackageManager` 读，缓存键由 `getIconKey` 保证包升级后自动失效；
- `handles` 恒真意味着本 loader 接管所有 `PackageInfo` 模型，其他 `ModelLoader` 不参与。
- `buildLoadData` 每次新建 `ApplicationInfo`/`PackageInfo` 包装副本，避免改写原对象污染调用方持有的 `PackageInfo`。
- `Fetcher.cleanup`/`cancel` 空实现：图标加载无外部资源需释放，`AppIconLoader.loadIcon` 内部自管理。

## 相关

- [app 模块总览](../../modules/app)
- [app · adapters 包](../app-adapters)（`ScopeAdapter` 在 `onBindViewHolder` 使用此加载链）
