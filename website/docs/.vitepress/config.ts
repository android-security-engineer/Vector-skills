import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

// Vector 文档站配置
// 仓库地址用于 GitHub Pages 部署与编辑链接
const repo = 'https://github.com/android-security-engineer/Vector-skills'

// mermaid 配置：配色锚定站点的电光青强调色，暗色模式下使用 dark base，
// 字体沿用站点的等宽字体以保持"代码即母语"的视觉语言
const mermaidConfig = {
  theme: {
    variables: {
      fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
      fontSize: '14px',
    },
  },
  flowchart: {
    curve: 'basis',
    htmlLabels: true,
    useMaxWidth: true,
  },
  sequence: {
    showSequenceNumbers: false,
    actorMargin: 60,
    boxMargin: 8,
    mirrorActors: true,
  },
}

export default withMermaid(
  defineConfig({
  lang: 'zh-CN',
  title: 'Vector',
  description: '面向现代 Android 的高性能 ART Hook 框架',

  // 部署到 <user>.github.io/Vector-skills 的子路径
  base: '/Vector-skills/',

  cleanUrls: true,
  lastUpdated: true,

  // 文档已全部生成，开启严格死链检查以保证后续维护质量
  ignoreDeadLinks: false,

  head: [
    ['meta', { name: 'theme-color', content: '#0B0E14' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Vector-skills/favicon.svg' }]
  ],

  markdown: {
    lineNumbers: true,
    theme: { light: 'github-light', dark: 'vesper' }
  },

  themeConfig: {
    siteTitle: 'Vector',

    logo: '/favicon.svg',

    nav: [
      { text: '指南', link: '/guide/intro' },
      { text: '架构', link: '/architecture/overview' },
      { text: '开发者', link: '/developer/modules' },
      { text: '实战', link: '/cookbook/' },
      {
        text: '参考',
        items: [
          { text: '🧱 模块总览', link: '/reference/modules/' },
          { text: '🗂️ 类与文件', link: '/reference/classes/' },
          { text: '📡 AIDL 接口', link: '/reference/aidl/' },
          { text: '👁️ Hidden API', link: '/reference/hiddenapi/' }
        ]
      },
      {
        text: '资源',
        items: [
          { text: '⬇️ 下载', link: 'https://github.com/android-security-engineer/Vector-skills/releases' },
          { text: '💻 源代码', link: repo },
          { text: '🚀 部署文档', link: '/deployment/' },
          { text: '📖 关于本文档', link: '/about' },
          { text: '🧬 LSPlant 引擎', link: 'https://github.com/JingMatrix/LSPlant' }
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          collapsed: false,
          items: [
            { text: '什么是 Vector', link: '/guide/intro' },
            { text: '🚀 快速上手', link: '/guide/quickstart' },
            { text: '它能解决什么', link: '/guide/why' },
            { text: '🧩 核心概念串讲', link: '/guide/concepts' },
            { text: '安装', link: '/guide/install' },
            { text: '兼容性矩阵', link: '/guide/compatibility' },
            { text: '🛡️ 安全与责任', link: '/guide/safety' }
          ]
        },
        {
          text: '基础概念',
          collapsed: false,
          items: [
            { text: 'ART Hook 原理', link: '/guide/art-hook' },
            { text: '模块机制', link: '/guide/modules' },
            { text: '术语表', link: '/guide/glossary' },
            { text: '🎯 典型用例', link: '/guide/use-cases' }
          ]
        },
        {
          text: '求助',
          collapsed: false,
          items: [
            { text: '常见问题 FAQ', link: '/guide/faq' },
            { text: '故障排查', link: '/guide/troubleshooting' }
          ]
        }
      ],
      '/architecture/': [
        {
          text: '总览',
          collapsed: false,
          items: [
            { text: '系统全景', link: '/architecture/overview' },
            { text: '启动与注入链路', link: '/architecture/boot-flow' },
            { text: 'IPC 与 Binder 中继', link: '/architecture/ipc' }
          ]
        },
        {
          text: '核心子系统',
          collapsed: false,
          items: [
            { text: 'Zygisk 模块', link: '/architecture/zygisk' },
            { text: 'Daemon 守护进程', link: '/architecture/daemon' },
            { text: 'Native 原生库', link: '/architecture/native' },
            { text: 'dex2oat 编译劫持', link: '/architecture/dex2oat' },
            { text: 'Xposed API 实现', link: '/architecture/xposed' },
            { text: 'Legacy 兼容层', link: '/architecture/legacy' },
            { text: '资源 Hook 子系统', link: '/architecture/resources' }
          ]
        },
        {
          text: '深入机制',
          collapsed: false,
          items: [
            { text: '安全与隐蔽性', link: '/architecture/security' },
            { text: 'SELinux 边界', link: '/architecture/selinux' },
            { text: '类名混淆', link: '/architecture/obfuscation' },
            { text: '进程生命周期', link: '/architecture/lifecycle' },
            { text: 'Daemon 并发模型', link: '/architecture/concurrency' },
            { text: '内存 ClassLoader', link: '/architecture/loader' },
            { text: '🏥 寄生管理器深入', link: '/architecture/manager-parasitic' }
          ]
        },
        {
          text: '运行机制',
          collapsed: true,
          items: [
            { text: '🔗 数据流总览', link: '/architecture/data-flow' },
            { text: '🧵 线程模型', link: '/architecture/threading' },
            { text: '📋 日志体系', link: '/architecture/logging' },
            { text: '🛠️ 构建系统', link: '/architecture/build' },
            { text: '🔄 模块更新与 OTA', link: '/architecture/update' }
          ]
        }
      ],
      '/developer/': [
        {
          text: '模块开发',
          collapsed: false,
          items: [
            { text: '编写一个模块', link: '/developer/modules' },
            { text: 'Hook API', link: '/developer/hook-api' },
            { text: '资源与偏好', link: '/developer/resources' },
            { text: 'Native 模块', link: '/developer/native' }
          ]
        },
        {
          text: '进阶',
          collapsed: false,
          items: [
            { text: 'API 对照表', link: '/developer/api-comparison' },
            { text: '从 LSPosed 迁移', link: '/developer/migration' },
            { text: '🧬 模块生命周期', link: '/developer/module-lifecycle' },
            { text: '🏷️ API 版本与能力检测', link: '/developer/version-api' }
          ]
        },
        {
          text: '工程实践',
          collapsed: true,
          items: [
            { text: '🛠️ 构建环境搭建', link: '/developer/build-environment' },
            { text: '✅ 最佳实践', link: '/developer/best-practices' },
            { text: '🐛 调试模块', link: '/developer/debug-module' }
          ]
        }
      ],
      '/cookbook/': [
        {
          text: '实战配方',
          collapsed: false,
          items: [
            { text: '配方索引', link: '/cookbook/' },
            { text: '🔄 拦截改写返回值', link: '/cookbook/replace-return' },
            { text: '✏️ 修改方法参数', link: '/cookbook/modify-args' },
            { text: '🔁 完全替换实现', link: '/cookbook/replace-implementation' },
            { text: '🏗️ Hook 构造函数', link: '/cookbook/hook-constructor' },
            { text: '🖼️ 替换布局资源', link: '/cookbook/replace-layout' },
            { text: '🔗 跨进程共享配置', link: '/cookbook/shared-prefs' },
            { text: '🪝 native 函数 Hook', link: '/cookbook/native-hook' },
            { text: '🚀 Hook Zygote 早期', link: '/cookbook/hook-zygote' },
            { text: '🧩 多模块链式 Hook', link: '/cookbook/multi-module-hook' },
            { text: '🎯 作用域与多进程', link: '/cookbook/scope' },
            { text: '🐛 日志与调试', link: '/cookbook/debugging' },
            { text: '⚡ 性能优化', link: '/cookbook/performance' },
            { text: '💾 备份恢复配置', link: '/cookbook/backup-restore' },
            { text: '📤 发布模块到仓库', link: '/cookbook/module-repo' },
            { text: '🧷 Hook 静态方法', link: '/cookbook/hook-static-method' },
            { text: '🅰️ Hook 内部类与匿名类', link: '/cookbook/hook-inner-class' },
            { text: '📡 模块广播通信', link: '/cookbook/broadcast-module' },
            { text: '🔒 持久化配置', link: '/cookbook/persistent-prefs' },
            { text: '🔄 远程偏好监听', link: '/cookbook/remote-preference' },
            { text: '✂️ 动态取消 Hook', link: '/cookbook/handle-unhook' },
            { text: '📚 打包 native 库', link: '/cookbook/native-inline-lib' },
            { text: '🏛️ Hook system_server', link: '/cookbook/system-server-hook' },
            { text: '✅ 发布前自检清单', link: '/cookbook/repo-publish-checklist' }
          ]
        }
      ],
      '/reference/modules/': [
        {
          text: '模块总览',
          collapsed: false,
          items: [
            { text: '索引', link: '/reference/modules/' },
            { text: '🟦 app 管理器', link: '/reference/modules/app' },
            { text: '🛰️ daemon 守护进程', link: '/reference/modules/daemon' },
            { text: '🧬 zygisk 注入引擎', link: '/reference/modules/zygisk' },
            { text: '⚙️ native 原生库', link: '/reference/modules/native' },
            { text: '🔨 dex2oat 劫持', link: '/reference/modules/dex2oat' },
            { text: '🔌 xposed 现代 API', link: '/reference/modules/xposed' },
            { text: '📜 legacy 兼容层', link: '/reference/modules/legacy' },
            { text: '🏛️ hiddenapi 桥与桩', link: '/reference/modules/hiddenapi' },
            { text: '📡 services AIDL', link: '/reference/modules/services' },
            { text: '📦 magisk-loader', link: '/reference/modules/magisk-loader' },
            { text: '📚 external 依赖', link: '/reference/modules/external' }
          ]
        }
      ],
      '/reference/classes/': [
        {
          text: '类与文件参考',
          collapsed: false,
          items: [
            { text: '索引', link: '/reference/classes/' },
            {
              text: 'app 🟦',
              collapsed: true,
              items: [
                { text: ' adapters', link: '/reference/classes/app-adapters' },
                { text: ' receivers', link: '/reference/classes/app-receivers' },
                { text: ' repo', link: '/reference/classes/app-repo' },
                { text: ' ui/activity', link: '/reference/classes/app-activity' },
                { text: ' ui/fragment', link: '/reference/classes/app-fragment' },
                { text: ' ui/dialog', link: '/reference/classes/app-dialog' },
                { text: ' ui/widget', link: '/reference/classes/app-widget' },
                { text: ' util', link: '/reference/classes/app-util' },
                {
                  text: 'app 单类 · 控件',
                  collapsed: true,
                  items: [
                    { text: 'StatefulRecyclerView', link: '/reference/classes/app/stateful-recyclerview' },
                    { text: 'ExpandableTextView', link: '/reference/classes/app/expandable-text-view' },
                    { text: 'WelcomeDialog', link: '/reference/classes/app/welcome-dialog' }
                  ]
                },
                {
                  text: 'app 单类 · 工具',
                  collapsed: true,
                  items: [
                    { text: 'UpdateUtil', link: '/reference/classes/app/update-util' },
                    { text: 'AppIconModelLoader', link: '/reference/classes/app/app-icon-model-loader' },
                    { text: 'NavUtil', link: '/reference/classes/app/nav-util' },
                    { text: 'CloudflareDNS', link: '/reference/classes/app/cloudflare-dns' },
                    { text: 'AccessibilityUtils', link: '/reference/classes/app/accessibility-utils' }
                  ]
                },
                {
                  text: 'app 单类 · 核心',
                  collapsed: true,
                  items: [
                    { text: 'ConfigManager', link: '/reference/classes/app/config-manager' },
                    { text: 'AppEntry', link: '/reference/classes/app/app-entry' },
                    { text: 'MainActivity', link: '/reference/classes/app/main-activity' },
                    { text: 'HomeFragment', link: '/reference/classes/app/home-fragment' },
                    { text: 'ModulesFragment', link: '/reference/classes/app/modules-fragment' },
                    { text: 'LogsFragment', link: '/reference/classes/app/logs-fragment' },
                    { text: 'SettingsFragment', link: '/reference/classes/app/settings-fragment' },
                    { text: 'RepoLoader', link: '/reference/classes/app/repo-loader' },
                    { text: 'ModuleUtil', link: '/reference/classes/app/module-util' },
                    { text: 'BackupUtils', link: '/reference/classes/app/backup-utils' },
                    { text: 'ScopeAdapter', link: '/reference/classes/app/scope-adapter' },
                    { text: 'ThemeUtil', link: '/reference/classes/app/theme-util' }
                  ]
                }
              ]
            },
            {
              text: 'daemon 🛰️',
              collapsed: true,
              items: [
                { text: ' data', link: '/reference/classes/daemon-data' },
                { text: ' env', link: '/reference/classes/daemon-env' },
                { text: ' ipc', link: '/reference/classes/daemon-ipc' },
                { text: ' system', link: '/reference/classes/daemon-system' },
                { text: ' utils', link: '/reference/classes/daemon-utils' },
                { text: ' jni', link: '/reference/classes/daemon-jni' },
                { text: ' 入口', link: '/reference/classes/daemon-entry' },
                {
                  text: 'daemon 单类',
                  collapsed: true,
                  items: [
                    { text: 'VectorDaemon', link: '/reference/classes/daemon/vector-daemon' },
                    { text: 'VectorService', link: '/reference/classes/daemon/vector-service' },
                    { text: 'DaemonState', link: '/reference/classes/daemon/daemon-state' },
                    { text: 'ApplicationService', link: '/reference/classes/daemon/application-service' },
                    { text: 'ManagerService', link: '/reference/classes/daemon/manager-service' },
                    { text: 'ModuleService', link: '/reference/classes/daemon/module-service' },
                    { text: 'SystemServerService', link: '/reference/classes/daemon/system-server-service' },
                    { text: 'Dex2oatServer', link: '/reference/classes/daemon/dex2oat-server' },
                    { text: 'CliSocketServer', link: '/reference/classes/daemon/cli-socket-server' },
                    { text: 'LogcatMonitor', link: '/reference/classes/daemon/logcat-monitor' },
                    { text: 'ConfigCache', link: '/reference/classes/daemon/config-cache' },
                    { text: 'PreferenceStore', link: '/reference/classes/daemon/preference-store' },
                    { text: 'ObfuscationManager', link: '/reference/classes/daemon/obfuscation-manager' },
                    { text: 'FakeContext', link: '/reference/classes/daemon/fake-context' }
                  ]
                }
              ]
            },
            {
              text: 'zygisk 🧬',
              collapsed: true,
              items: [
                { text: ' cpp', link: '/reference/classes/zygisk-cpp' },
                { text: ' kotlin', link: '/reference/classes/zygisk-kotlin' },
                { text: ' service', link: '/reference/classes/zygisk-service' },
                {
                  text: 'zygisk 单类',
                  collapsed: true,
                  items: [
                    { text: 'Module (cpp)', link: '/reference/classes/zygisk/module-cpp' },
                    { text: 'Main / ForkCommon', link: '/reference/classes/zygisk/main-fork-common' },
                    { text: 'BridgeService', link: '/reference/classes/zygisk/bridge-service' },
                    { text: 'IpcBridge', link: '/reference/classes/zygisk/ipc-bridge' },
                    { text: 'ParasiticManagerHooker', link: '/reference/classes/zygisk/parasitic-manager-hooker' }
                  ]
                }
              ]
            },
            {
              text: 'native ⚙️',
              collapsed: true,
              items: [
                { text: ' core', link: '/reference/classes/native-core' },
                { text: ' elf', link: '/reference/classes/native-elf' },
                { text: ' jni', link: '/reference/classes/native-jni' },
                { text: ' framework', link: '/reference/classes/native-framework' }
              ]
            },
            {
              text: 'xposed 🔌',
              collapsed: true,
              items: [
                { text: ' core', link: '/reference/classes/xposed-core' },
                { text: ' hooks', link: '/reference/classes/xposed-hooks' },
                { text: ' hookers', link: '/reference/classes/xposed-hookers' },
                { text: ' utils', link: '/reference/classes/xposed-utils' },
                { text: ' nativebridge', link: '/reference/classes/xposed-nativebridge' },
                { text: ' di', link: '/reference/classes/xposed-di' },
                {
                  text: 'xposed 实现 · 单类',
                  collapsed: true,
                  items: [
                    { text: 'LoadedApkHookers', link: '/reference/classes/xposed/loaded-apk-hookers' },
                    { text: 'SystemServerHookers', link: '/reference/classes/xposed/system-server-hookers' },
                    { text: 'AppAttachHooker', link: '/reference/classes/xposed/app-attach-hooker' },
                    { text: 'BaseInvoker', link: '/reference/classes/xposed/base-invoker' },
                    { text: 'VectorLegacyCallback', link: '/reference/classes/xposed/vector-legacy-callback' },
                    { text: 'VectorServiceClient', link: '/reference/classes/xposed/vector-service-client' },
                    { text: 'VectorModuleManager', link: '/reference/classes/xposed/vector-module-manager' },
                    { text: 'VectorInlinedCallers', link: '/reference/classes/xposed/vector-inlined-callers' },
                    { text: 'VectorLifecycleManager', link: '/reference/classes/xposed/vector-lifecycle-manager' },
                    { text: 'VectorMetaDataReader', link: '/reference/classes/xposed/vector-meta-data-reader' },
                    { text: 'VectorURLStreamHandler', link: '/reference/classes/xposed/vector-url-stream-handler' }
                  ]
                }
              ]
            },
            {
              text: 'legacy 📜',
              collapsed: true,
              items: [
                { text: ' API 核心', link: '/reference/classes/legacy-api' },
                { text: ' callbacks', link: '/reference/classes/legacy-callbacks' },
                { text: ' services', link: '/reference/classes/legacy-services' },
                { text: ' resources', link: '/reference/classes/legacy-resources' },
                { text: ' impl', link: '/reference/classes/legacy-impl' }
              ]
            },
            {
              text: 'dex2oat 🔨',
              collapsed: true,
              items: [
                { text: ' 包装器', link: '/reference/classes/dex2oat-wrapper' },
                { text: ' hooker', link: '/reference/classes/dex2oat-hooker' }
              ]
            },
            {
              text: 'magisk-loader 📦',
              collapsed: true,
              items: [
                { text: 'customize.sh', link: '/reference/classes/magisk-loader/customize-sh' },
                { text: 'service.sh', link: '/reference/classes/magisk-loader/service-sh' },
                { text: 'post-fs-data 阶段', link: '/reference/classes/magisk-loader/post-fs-data-sh' },
                { text: 'module.prop', link: '/reference/classes/magisk-loader/module-prop' },
                { text: 'SELinux 规则', link: '/reference/classes/magisk-loader/sepolicy-rule' }
              ]
            },
            {
              text: 'services AIDL 实现 📡',
              collapsed: true,
              items: [
                { text: 'IDaemonService 实现', link: '/reference/classes/services/daemon-service-impl' },
                { text: 'ILSPApplicationService 实现', link: '/reference/classes/services/application-service-impl' },
                { text: 'ILSPManagerService 实现', link: '/reference/classes/services/manager-service-impl' },
                { text: 'ILSPSystemServerService 实现', link: '/reference/classes/services/system-server-service-impl' },
                { text: 'ILSPInjectedModuleService 实现', link: '/reference/classes/services/injected-module-service-impl' }
              ]
            },
            {
              text: 'external 依赖 📚',
              collapsed: true,
              items: [
                { text: 'LSPlant 引擎', link: '/reference/classes/external/lsplant-engine' },
                { text: 'Dobby inline hook', link: '/reference/classes/external/dobby-inline' },
                { text: 'Magisk 模块规范', link: '/reference/classes/external/magisk-module-api' },
                { text: '序列化与零拷贝', link: '/reference/classes/external/cxx-serializer' }
              ]
            },
            {
              text: 'legacy 深入 📜',
              collapsed: true,
              items: [
                { text: 'XposedBridge', link: '/reference/classes/legacy/xposed-bridge' },
                { text: 'XposedHelpers', link: '/reference/classes/legacy/xposed-helpers' },
                { text: 'XposedInit', link: '/reference/classes/legacy/xposed-init' },
                { text: 'XSharedPreferences', link: '/reference/classes/legacy/xshared-preferences' },
                { text: 'XC_MethodHook', link: '/reference/classes/legacy/xc-method-hook' },
                { text: 'LegacyDelegateImpl', link: '/reference/classes/legacy/legacy-delegate' },
                { text: 'XposedHelpers 工具方法', link: '/reference/classes/legacy/xposed-helpers-extra' },
                { text: 'XC_MethodReplacement', link: '/reference/classes/legacy/xc-method-replacement' },
                { text: 'XposedBridge 内部状态', link: '/reference/classes/legacy/xposed-bridge-tl' },
                { text: '回调分发', link: '/reference/classes/legacy/callback-dispatch' },
                { text: '入口回调契约', link: '/reference/classes/legacy/init-zygote-callback' },
                { text: 'IXposedMod 规范', link: '/reference/classes/legacy/xposed-module-interface' }
              ]
            },
            {
              text: 'xposed 深入 🔌',
              collapsed: true,
              items: [
                { text: 'VectorChain', link: '/reference/classes/xposed/vector-chain' },
                { text: 'VectorNativeHooker', link: '/reference/classes/xposed/vector-native-hooker' },
                { text: 'VectorDeopter', link: '/reference/classes/xposed/vector-deopter' },
                { text: 'VectorModuleClassLoader', link: '/reference/classes/xposed/vector-module-classloader' },
                { text: 'VectorBootstrap', link: '/reference/classes/xposed/vector-bootstrap' },
                { text: 'HookBridge (JNI)', link: '/reference/classes/xposed/hook-bridge' }
              ]
            },
            {
              text: 'native 深入 ⚙️',
              collapsed: true,
              items: [
                { text: 'Context', link: '/reference/classes/native/context' },
                { text: 'HookBridge (cpp)', link: '/reference/classes/native/hook-bridge-cpp' },
                { text: 'ElfImage', link: '/reference/classes/native/elf-image' },
                { text: 'ResourcesHook (cpp)', link: '/reference/classes/native/resources-hook-cpp' },
                { text: 'ARSC 解析', link: '/reference/classes/native/arsc-parser' },
                { text: '资源重写循环', link: '/reference/classes/native/resource-rewriter' },
                { text: 'inline hook 引擎', link: '/reference/classes/native/inline-scope' },
                { text: '符号解析与缓存', link: '/reference/classes/native/symbol-resolver' },
                { text: 'JNI 桥', link: '/reference/classes/native/jni-bridge' },
                { text: 'ArtMethod 访问', link: '/reference/classes/native/art-method-access' },
                { text: 'logcat 零拷贝写入', link: '/reference/classes/native/logcat-writer' },
                { text: 'daemon socket', link: '/reference/classes/native/daemon-socket' },
                { text: 'ConfigBridge', link: '/reference/classes/native/config-bridge' },
                { text: '反优化跳板', link: '/reference/classes/native/deopt-trampoline' }
              ]
            }
          ]
        }
      ],
      '/reference/aidl/': [
        {
          text: 'AIDL 接口参考',
          collapsed: false,
          items: [
            { text: '索引', link: '/reference/aidl/' },
            { text: 'IDaemonService', link: '/reference/aidl/idaemonservice' },
            { text: 'ILSPApplicationService', link: '/reference/aidl/ilspapplicationservice' },
            { text: 'ILSPInjectedModuleService', link: '/reference/aidl/ilspinjectedmoduleservice' },
            { text: 'ILSPSystemServerService', link: '/reference/aidl/ilspsystemserverservice' },
            { text: 'ILSPManagerService', link: '/reference/aidl/ilspmanagerservice' },
            { text: 'IRemotePreferenceCallback', link: '/reference/aidl/iremotepreferencecallback' },
            { text: '🧩 数据模型', link: '/reference/aidl/models' }
          ]
        }
      ],
      '/reference/hiddenapi/': [
        {
          text: 'Hidden API 桥与桩',
          collapsed: false,
          items: [
            { text: '索引', link: '/reference/hiddenapi/' },
            { text: 'bridge 桥接层', link: '/reference/hiddenapi/bridge' },
            { text: 'stubs 桩总览', link: '/reference/hiddenapi/stubs' },
            {
              text: 'stubs 按包',
              collapsed: true,
              items: [
                { text: 'android.app', link: '/reference/hiddenapi/stubs/stubs-android-app' },
                { text: 'android.os', link: '/reference/hiddenapi/stubs/stubs-android-os' },
                { text: 'android.content', link: '/reference/hiddenapi/stubs/stubs-android-content' },
                { text: 'server / dalvik / dummy', link: '/reference/hiddenapi/stubs/stubs-android-server' }
              ]
            },
            {
              text: 'bridge 桥方法',
              collapsed: true,
              items: [
                { text: '方法调用桥', link: '/reference/classes/hiddenapi/bridge-methods-invoke' },
                { text: '字段访问桥', link: '/reference/classes/hiddenapi/bridge-methods-field' },
                { text: '构造对象桥', link: '/reference/classes/hiddenapi/bridge-methods-new-instance' },
                { text: 'bridge 与 stubs 协作', link: '/reference/classes/hiddenapi/bridge-stubs-bridge' }
              ]
            }
          ]
        }
      ],
      '/deployment/': [
        {
          text: '部署与运维',
          collapsed: false,
          items: [
            { text: '索引', link: '/deployment/' },
            { text: '本地预览', link: '/deployment/local' },
            { text: 'GitHub Actions CI/CD', link: '/deployment/ci-cd' },
            { text: 'GitHub Pages 部署', link: '/deployment/pages' },
            { text: '构建产物与缓存', link: '/deployment/artifacts' },
            { text: '🩺 部署排错', link: '/deployment/troubleshoot' },
            { text: '🎨 站点定制', link: '/deployment/customize' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: repo }
    ],

    editLink: {
      pattern: `${repo}/edit/master/website/docs/:path`,
      text: '在 GitHub 上编辑此页'
    },

    footer: {
      message: '基于 GPL-3.0 协议开源',
      copyright: 'Vector Framework · 本站为社区教学文档'
    },

    search: {
      provider: 'local'
    },

    outline: {
      label: '本页目录',
      level: [2, 3]
    },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },

    lastUpdated: {
      text: '最后更新于'
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式'
  },

  mermaid: mermaidConfig,
}),
)
