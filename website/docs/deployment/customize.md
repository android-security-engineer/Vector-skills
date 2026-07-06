# 🎨 站点定制

VitePress 文档站的视觉与功能定制：主题色、logo、mermaid 配色、自定义域名、footer。

> 📂 [`website/docs/.vitepress/theme/custom.css`](https://github.com/android-security-engineer/Vector-skills/blob/master/website/docs/.vitepress/theme/custom.css) · `config.ts`
> 🚀 deployment 运维

## 定制入口

| 定制项 | 文件 | 说明 |
| :--- | :--- | :--- |
| 主题色 | `theme/custom.css` | `--vp-c-brand-*` 变量 |
| 字体 | `theme/custom.css` | `--vp-font-family-base/mono` |
| logo / favicon | `config.ts` + `public/` | `logo`、`head` link |
| mermaid 配色 | `config.ts` `mermaidConfig` | 全局图表样式 |
| 自定义组件 | `theme/index.ts` | `app.component` 全局注册 |
| 自定义域名 | GitHub Pages 设置 | CNAME |
| footer | `config.ts` `themeConfig.footer` | 版权信息 |

## 主题色

`custom.css` 定义浅色与深色两套品牌色，锚定"近黑冷蓝 + 电光青"：

```css
:root {
  --vp-c-brand-1: #0e8c7e;   /* 浅色主色 */
  --vp-c-brand-2: #0a7468;
  --vp-c-brand-3: #14b3a0;
  --vp-c-brand-soft: rgba(14, 140, 126, 0.14);
}
.dark {
  --vp-c-brand-1: #3dd8c8;   /* 深色电光青 */
  --vp-c-brand-2: #4fe6d8;
  --vp-c-brand-3: #6ff0e4;
}
```

修改这些变量即可全局换色。`--vp-c-indigo-*` 同步设为青色，使 VitePress 内置组件（如按钮、徽章）一致。

## mermaid 配色

文档中 mermaid 图采用统一 classDef 配色约定：

| classDef | fill / stroke | 含义 |
| :--- | :--- | :--- |
| Vector 青 | `#0e3a36` / `#3dd8c8` | Vector 自身组件 |
| 琥珀 | `#3a2a10` / `#e8a838` | 问题/警告/检查 |
| 灰蓝 | `#1a2030` / `#6b7689` | 普通节点 |
| 绿 | `#1a3a1a` / `#5cd980` | 成功/通过 |
| 蓝 UI | `#143a4a` / `#4fb3d8` | UI/系统侧 |

`config.ts` 的 `mermaidConfig` 设全局字体与布局：

```ts
const mermaidConfig = {
  theme: { variables: {
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    fontSize: '14px',
  }},
  flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true },
}
```

## logo 与 favicon

```ts
head: [
  ['meta', { name: 'theme-color', content: '#0B0E14' }],
  ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Vector-skills/favicon.svg' }]
],
themeConfig: { logo: '/favicon.svg' }
```

- `logo` 路径相对 `public/`，不带 base 前缀（VitePress 自动处理）；
- `head` 中 `href` 需带 base 前缀；
- favicon 放 `website/docs/public/favicon.svg`。

## 自定义组件

`theme/index.ts` 注册全局组件，可在任意 markdown 中使用：

```ts
enhanceApp({ app }) {
  app.use(MermaidPlugin)
  app.component('InjectionDiagram', InjectionDiagram)
}
```

`InjectionDiagram.vue` 即注入链路可视化组件。新增组件放 `theme/` 目录并在此注册。

## 自定义域名

默认部署到 `<user>.github.io/Vector-skills/`。使用自定义域名时：

1. 在 `website/docs/public/` 放 `CNAME` 文件，内容为域名（如 `docs.vector.dev`）；
2. DNS 配置 CNAME 指向 `<user>.github.io`；
3. **改 `base` 为 `'/'`**，自定义域名根路径无需子路径前缀；
4. GitHub Pages 设置中验证域名。

> ⚠️ 切换自定义域名后，`head` 中 favicon 等硬编码 base 的 `href` 也需同步改为 `'/'`。

## footer

```ts
footer: {
  message: '基于 GPL-3.0 协议开源',
  copyright: 'Vector Framework · 本站为社区教学文档'
}
```

`editLink.pattern` 指向仓库 edit URL，点击"在 GitHub 上编辑此页"直接跳转源文件。

## 相关

- 配置全貌见 [config.ts](https://github.com/android-security-engineer/Vector-skills/blob/master/website/docs/.vitepress/config.ts)
- 本地预览见 [local](./local)
- 部署排错见 [troubleshoot](./troubleshoot)
- Pages 部署见 [pages](./pages)
