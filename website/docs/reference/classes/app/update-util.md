# 🔄 UpdateUtil · 更新检查

> 📂 `app/src/main/java/org/lsposed/manager/util/UpdateUtil.java`
> 🟦 app 模块 · 远端版本拉取与安装包预下载

## 类职责

`public class UpdateUtil` 是管理器检查更新的**静态工具集**。它向 GitHub Releases API 查询最新版本，把版本号、发行说明、下载时间写入偏好，并按需同步下载 zip 安装包到缓存目录；UI 通过 `needUpdate()` 判断是否提示用户升级。

## 关键逻辑

- **请求目标**：`https://api.github.com/repos/JingMatrix/LSPosed/releases/latest`，经 `App.getOkHttpClient()` 走 DoH；
- **资产名解析**：`name.split("-")` 取第 3 段作为版本号写入 `latest_version`；
- **下载触发**：资产 `updated_at` 与偏好 `zip_time` 不一致才重下，下完校验 `size` 后落盘；
- **失效判定**：检查时间超过 30 天、或 `latest_version > BuildConfig.VERSION_CODE` 时 `needUpdate()` 返回 true；从未成功检查时按 `BUILD_TIME + 30 天` 判定。

## 方法签名

```java
// 异步拉取远端最新版本信息并按需下载 zip
public static void loadRemoteVersion()

// 检查是否需要提示更新
public static boolean needUpdate()

// 同步下载 zip 到缓存目录（私有，由 checkAssets 调用）
@Nullable
private static File downloadNewZipSync(String url, String name)

// 解析单个 asset，写偏好并触发下载（私有）
private static void checkAssets(JsonObject assets, String releaseNotes)
```

## 偏好键

| 键 | 类型 | 含义 |
| :--- | :--- | :--- |
| `checked` | `boolean` | 是否已成功检查过 |
| `latest_version` | `int` | 远端最新版本号 |
| `latest_check` | `long` | 上次检查的 epoch 秒 |
| `release_notes` | `String` | 发行说明正文 |
| `zip_file` | `String` | 已下载 zip 的绝对路径 |
| `zip_time` | `long` | 已下载 zip 对应的 asset 更新时间 |

## 更新流程

```mermaid
flowchart TD
    A["loadRemoteVersion"] --> B["GET GitHub releases/latest"]
    B --> C{"response.isSuccessful?"}
    C -->|否| D["onFailure: 标记 checked"]
    C -->|是| E["解析 assets 数组"]
    E --> F["checkAssets 逐个"]
    F --> G["写偏好 latest_version 等"]
    G --> H{"updated_at == zip_time?"}
    H -->|是| I["跳过下载"]
    H -->|否| J["downloadNewZipSync"]
    J --> K{"length == size?"}
    K -->|是| L["写 zip_file / zip_time"]
    K -->|否| I
    M["needUpdate"] --> N{"checked?"}
    N -->|否| O["BUILD_TIME+30天 判定"]
    N -->|是| P{"latest_check+30天 < now?"}
    P -->|是| Q["return true"]
    P -->|否| R{"latest_version > VERSION_CODE?"}

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class A,B,E,F,G,J,L,M class vec
    class C,H,K,N,P,R class hot
    class D,I,O,Q class plain
```

## 集成要点

- `loadRemoteVersion` 在应用启动或设置页进入时调用一次，结果常驻偏好，UI 不直接持有内存态，靠 `needUpdate()` 轮询；
- 下载为**同步阻塞**（`downloadNewZipSync` 在 OkHttp 回调线程执行），不占用主线程，但若网络差会拖长回调——daemon 端不依赖此结果；
- `name.split("-")[2]` 强依赖 release 资产命名规范（`LSPosed-vX.Y-r版本-架构.zip`），命名变动会导致版本号解析错位；
- `checked` 标志在 `onFailure` 时也会被置 true，避免无网络时反复重试；30 天后 `needUpdate` 仍会因 `latest_check+30天 < now` 返回 true 触发下次拉取。
- zip 落盘于 `App.getInstance().getCacheDir()`，系统清理缓存时会丢失，下次检查会重新下载。
- `needUpdate` 的"30 天"硬编码同时覆盖"从未检查"与"检查超期"两种情况，作为兜底催更机制。

## 相关

- [app 模块总览](../../modules/app)
- [CloudflareDNS · DoH 网络](./cloudflare-dns)（请求所走网络栈）
