import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { MermaidPlugin } from 'vitepress-plugin-mermaid'
import InjectionDiagram from './InjectionDiagram.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // mermaid 图表渲染支持（flowchart / sequence / class 等）
    app.use(MermaidPlugin)
    // 全局注册注入链路图组件，可在任意 markdown 中使用
    app.component('InjectionDiagram', InjectionDiagram)
  }
} satisfies Theme
