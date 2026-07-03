<script setup>
// Vector 注入链路示意图
// 用 span 着色，呼应"信号激活"的设计语言
</script>

<template>
  <div class="injection-diagram">
    <pre><code><span class="dim">  ┌─────────────────────────────────────────────────────────────┐</span>
<span class="dim">  │                    Vector 注入链路                           │</span>
<span class="dim">  └─────────────────────────────────────────────────────────────┘</span>

  <span class="amber">Zygote</span> ──fork──▶ <span class="cyan">system_server</span> ──Binder 中继──▶ <span class="amber">用户应用</span>
                          ▲                          │
                          │ <span class="dim">_VEC 事务拦截</span>           │ 请求框架 DEX
                          │                          ▼
                       <span class="cyan">Daemon 守护进程</span> ◀──── <span class="dim">心跳 Binder</span> ──┘
                          │
                          │ <span class="dim">SharedMemory</span>
                          ▼
                   <span class="amber">内存中的框架 + 模块</span> ──▶ <span class="cyan">LSPlant Hook 引擎</span>

<span class="dim">  无磁盘写入 · 无 ServiceManager 注册 · 重启即恢复</span></code></pre>
  </div>
</template>

<style scoped>
.injection-diagram {
  margin: 4rem auto 2rem;
  max-width: 760px;
  overflow-x: auto;
  padding: 1.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}
.injection-diagram pre {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
}
.injection-diagram code {
  color: var(--vp-c-text-2);
  background: transparent;
  padding: 0;
}
.injection-diagram .cyan { color: #3dd8c8; }
.injection-diagram .amber { color: #e8a838; }
.injection-diagram .dim { color: var(--vp-c-text-3); }
@media (max-width: 768px) {
  .injection-diagram pre { font-size: 10px; }
}
</style>
