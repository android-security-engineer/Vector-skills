# 🚀 部署与运维

这一区讲文档站本身的构建、部署与运维。Vector 文档站基于 VitePress，通过 GitHub Actions 自动构建并部署到 GitHub Pages。

## 内容

| 文档 | 内容 |
| :--- | :--- |
| 🖥️ [本地预览](./local) | 本地起 dev server、构建预览 |
| 🔧 [GitHub Actions CI/CD](./ci-cd) | 自动构建流水线详解 |
| 🌐 [GitHub Pages 部署](./pages) | Pages 配置与部署 |
| 📦 [构建产物与缓存](./artifacts) | 产物结构、npm 缓存优化 |

## 访问地址

部署后文档站访问：

| 场景 | URL | 触发条件 |
| :--- | :--- | :--- |
| **默认（子路径）** | `https://<org>.github.io/Vector-skills/` | push 到 `master` 且改动 `website/**` 或工作流文件 |
| **手动触发** | 同上 | 在 Actions 页 `workflow_dispatch` 手动运行 |
| **自定义域名** | `https://docs.your-domain.com/` | 配置 CNAME 并把 `base` 改为 `/` |

> ✅ 当前站点已上线：**<https://android-security-engineer.github.io/Vector-skills/>**，push 到 `master` 改动 `website/**` 即自动重新部署。

> ⚠️ 因配置了 `base: '/Vector-skills/'`，站点运行在子路径下。所有内部链接、静态资源路径都带此前缀；自定义域名时需同步调整 `base`，否则资源 404。

::: tip 何时会触发部署
工作流 `deploy-docs.yml` 的触发条件（见源文件）：
- `push` 到 `master`，且改动落在 `website/**` 或 `.github/workflows/deploy-docs.yml`。
- `workflow_dispatch`（Actions 页手动按钮）。
- 同分支并发部署只保留最新一次（`concurrency: cancel-in-progress: true`）。
:::

## 部署全景

```mermaid
graph LR
    PUSH["push 到 master<br/>改动 website/**"]:::in
    PUSH --> CI["GitHub Actions<br/>deploy-docs.yml"]:::ci
    CI --> INSTALL["npm ci 安装依赖"]:::step
    INSTALL --> BUILD["vitepress build"]:::step
    BUILD --> ART["上传 Pages artifact"]:::step
    ART --> DEPLOY["deploy-pages<br/>发布到 GitHub Pages"]:::out
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef ci fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef step fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 前置准备

要让部署真正生效，仓库需满足：

1. **Pages Source**：Settings → Pages → Source 设为 **GitHub Actions**（不是 branch）。
2. **github-pages 环境**：CI 用 `environment: github-pages`，首次需在 Settings → Environments 确认存在。
3. **权限**：工作流已声明 `contents: read`、`pages: write`、`id-token: write`，仓库 Actions 默认权限需允许写 Pages。

详见 [GitHub Pages 部署](./pages)。

## 接下来

- 第一次部署，按 [GitHub Pages 部署](./pages) 的清单走。
- 本地预览改动，看 [本地预览](./local)。
- 流水线细节，看 [CI/CD](./ci-cd)。
