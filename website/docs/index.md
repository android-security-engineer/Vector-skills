---
layout: home

hero:
  name: Vector
  text: 现代 Android 的 ART Hook 框架
  tagline: 基于 Zygisk 的原生级注入框架，保持与 Xposed API 完全兼容。改的是内存，不是 APK——可逆、无痕、跨版本。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/intro
    - theme: alt
      text: 架构总览
      link: /architecture/overview

features:
  - icon: 🪝
    title: 原生级 ART Hook
    details: 基于 LSPlant 在 ART 运行时层面拦截 Java 方法，绕过编译期优化，提供稳定、高效的方法插桩。
    link: /guide/art-hook
    linkText: 了解原理 →
  - icon: 🧬
    title: 纯内存执行
    details: 框架 DEX 通过 SharedMemory 注入，模块从内存加载。零磁盘足迹，对抗反作弊检测。
    link: /architecture/boot-flow
    linkText: 看注入链路 →
  - icon: 🔌
    title: 双 API 兼容
    details: 同时支持经典 de.robv.android.xposed 与现代 libxposed API，老模块与新模块皆可运行。
    link: /developer/modules
    linkText: 模块开发 →
  - icon: ⚙️
    title: 编译期反内联
    details: 劫持 dex2oat 编译器，强制 --inline-max-code-units=0，确保被 Hook 的方法不会被内联逃逸。
    link: /architecture/dex2oat
    linkText: 看如何劫持 →
  - icon: 🛰️
    title: 隐形 IPC
    details: 不向 ServiceManager 注册服务，而是拦截 Binder 事务、主动推送 Binder 引用，隐蔽建立通信。
    link: /architecture/ipc
    linkText: IPC 设计 →
  - icon: 📱
    title: 寄生式管理器
    details: 管理器应用不单独安装，而是寄生在宿主进程（如 com.android.shell）中运行，无独立包名。
    link: /architecture/zygisk
    linkText: 寄生机制 →
---

<InjectionDiagram />

## Vector 是什么

Vector 是一个运行在 **Zygisk** 之上的 ART Hook 框架，基于 [LSPlant](https://github.com/JingMatrix/LSPlant) 实现，**保持与原版 Xposed API 完全兼容**。它让你在不修改 APK、不刷系统镜像的前提下，从内存层面改写 Android 系统与应用的行为——可逆、无痕、跨版本。

- **支持 Android 8.1 至 17 Beta**，跨 ROM 通用。
- **双 API 兼容**：经典 `de.robv.android.xposed` 与现代 `libxposed` 皆可运行，老模块近乎原样迁移。
- **纯内存执行**：框架 DEX 经 SharedMemory 注入，零磁盘足迹，对抗反作弊检测。
- **寄生式管理器**：无独立包名，寄生在 `com.android.shell` 等宿主进程中运行。

## 快速导航

| 你想… | 去哪 |
| :--- | :--- |
| 了解 Vector 解决什么问题 | [指南 · 什么是 Vector](./guide/intro) |
| 装上试试 | [指南 · 安装](./guide/install) |
| 写第一个 Hook 模块 | [实战配方](./cookbook/) |
| 理解注入链路与 IPC | [架构总览](./architecture/overview) |
| 本地预览文档站 | [部署 · 本地预览](./deployment/local) |

## 它在解决什么

传统修改 Android 行为的两条路都沉重且危险：

```mermaid
graph LR
    subgraph 传统["传统方式（破坏性 / 高风险）"]
        T1["重打包 APK<br/>破坏签名·可检测"]:::bad
        T2["改系统镜像<br/>刷机·不可逆"]:::bad
    end
    V1["Vector<br/>运行时内存拦截"]:::good
    style T1 fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    style T2 fill:#3a2a10,stroke:#e8a838,color:#ffd9b0
    style V1 fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
```

Vector 走第三条路——在运行时从内存层面拦截方法调用。**APK 字节不动，重启即恢复**。

## 上手三步

```mermaid
graph LR
    S1["1. 装 Magisk/KernelSU<br/>+ Zygisk"]:::step
    S1 --> S2["2. 刷入 Vector 模块<br/>重启"]:::step
    S2 --> S3["3. 勾选作用域<br/>写模块"]:::out
    classDef step fill:#143a4a,stroke:#4fb3d8,color:#bff0f5
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

1. 准备一台 root 设备，装 [Magisk](https://github.com/topjohnwu/Magisk) / [KernelSU](https://github.com/tiann/KernelSU) 并启用 Zygisk（推荐 [NeoZygisk](https://github.com/JingMatrix/NeoZygisk)）。
2. 从 [GitHub Releases](https://github.com/android-security-engineer/Vector-skills/releases) 下载 Vector 模块 zip，在 root 管理器里刷入并重启。
3. 通过系统通知进入寄生式管理器，勾选模块作用域，开始写你的第一个 [Hook 配方](./cookbook/)。

## 文档站部署

本站基于 VitePress，由 GitHub Actions 自动构建并部署到 GitHub Pages：

- 访问地址：`https://<org>.github.io/Vector-skills/`
- 触发条件：push 到 `master` 且改动 `website/**`
- 本地预览：`cd website && npm install && npm run dev`

详见 [部署与运维](./deployment/)。

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #3dd8c8 30%, #6ff0e4);
  --vp-home-hero-image-background-image: linear-gradient(-45deg, #14b3a0 40%, #0b0e14 60%);
  --vp-home-hero-image-filter: blur(36px);
}
</style>
