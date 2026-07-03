# 🗂️ 类与文件参考

Vector 的全部类与源文件逐个剖析。按模块归类，每个模块下既有「聚合页」（按目录汇总一组类），也有「单类页」（深入单个核心类）。

::: tip 阅读建议
- 想快速了解一个模块有哪些类 → 看对应 [模块总览](../modules/)
- 想深入某个核心类的实现细节 → 翻本页下方的「单类」分组
- 想理解跨模块协作 → 看 [架构](../../architecture/overview) 章节
:::

## 模块导航

| 模块 | 聚合页入口 | 单类深入 |
| :--- | :--- | :--- |
| 🟦 app 管理器 | [adapters](./app-adapters) · [receivers](./app-receivers) · [repo](./app-repo) · [activity](./app-activity) · [fragment](./app-fragment) · [dialog](./app-dialog) · [widget](./app-widget) · [util](./app-util) | [app 单类 →](#app-控件与工具) |
| 🛰️ daemon 守护进程 | [data](./daemon-data) · [env](./daemon-env) · [ipc](./daemon-ipc) · [system](./daemon-system) · [utils](./daemon-utils) · [jni](./daemon-jni) · [入口](./daemon-entry) | [daemon 单类 →](#daemon-核心类) |
| 🧬 zygisk 注入引擎 | [cpp](./zygisk-cpp) · [kotlin](./zygisk-kotlin) · [service](./zygisk-service) | [zygisk 单类 →](#zygisk-核心类) |
| ⚙️ native 原生库 | [core](./native-core) · [elf](./native-elf) · [jni](./native-jni) · [framework](./native-framework) | [native 深入 →](#native-深入) |
| 🔌 xposed 现代 API | [core](./xposed-core) · [hooks](./xposed-hooks) · [hookers](./xposed-hookers) · [utils](./xposed-utils) · [nativebridge](./xposed-nativebridge) · [di](./xposed-di) | [xposed 实现 →](#xposed-实现单类) |
| 📜 legacy 兼容层 | [API 核心](./legacy-api) · [callbacks](./legacy-callbacks) · [services](./legacy-services) · [resources](./legacy-resources) · [impl](./legacy-impl) | [legacy 深入 →](#legacy-深入) |
| 🔨 dex2oat 劫持 | [包装器](./dex2oat-wrapper) · [hooker](./dex2oat-hooker) | — |
| 📦 magisk-loader | [customize.sh](./magisk-loader/customize-sh) · [service.sh](./magisk-loader/service-sh) · [module.prop](./magisk-loader/module-prop) · [SELinux 规则](./magisk-loader/sepolicy-rule) | — |
| 📡 services AIDL 实现 | [Daemon](./services/daemon-service-impl) · [Application](./services/application-service-impl) · [Manager](./services/manager-service-impl) · [SystemServer](./services/system-server-service-impl) · [InjectedModule](./services/injected-module-service-impl) | [AIDL 接口 →](../aidl/) |
| 👁️ hiddenapi | [bridge](../hiddenapi/bridge) · [stubs](../hiddenapi/stubs) | [bridge 桥方法 →](#hiddenapi-桥方法) |
| 📚 external 依赖 | [LSPlant](./external/lsplant-engine) · [Dobby](./external/dobby-inline) · [Magisk 规范](./external/magisk-module-api) · [序列化](./external/cxx-serializer) | — |

## app 控件与工具

::: details 单类清单
- [StatefulRecyclerView](./app/stateful-recyclerview) · [ExpandableTextView](./app/expandable-text-view) · [WelcomeDialog](./app/welcome-dialog)
- [UpdateUtil](./app/update-util) · [AppIconModelLoader](./app/app-icon-model-loader) · [NavUtil](./app/nav-util) · [CloudflareDNS](./app/cloudflare-dns) · [AccessibilityUtils](./app/accessibility-utils)
- [ConfigManager](./app/config-manager) · [AppEntry](./app/app-entry) · [MainActivity](./app/main-activity) · [HomeFragment](./app/home-fragment) · [ModulesFragment](./app/modules-fragment) · [LogsFragment](./app/logs-fragment) · [SettingsFragment](./app/settings-fragment) · [RepoLoader](./app/repo-loader) · [ModuleUtil](./app/module-util) · [BackupUtils](./app/backup-utils) · [ScopeAdapter](./app/scope-adapter) · [ThemeUtil](./app/theme-util)
:::

## daemon 核心类

::: details 单类清单
- [VectorDaemon](./daemon/vector-daemon) · [VectorService](./daemon/vector-service) · [DaemonState](./daemon/daemon-state)
- [ApplicationService](./daemon/application-service) · [ManagerService](./daemon/manager-service) · [ModuleService](./daemon/module-service) · [SystemServerService](./daemon/system-server-service) · [Dex2oatServer](./daemon/dex2oat-server) · [CliSocketServer](./daemon/cli-socket-server) · [LogcatMonitor](./daemon/logcat-monitor) · [ConfigCache](./daemon/config-cache) · [PreferenceStore](./daemon/preference-store) · [ObfuscationManager](./daemon/obfuscation-manager) · [FakeContext](./daemon/fake-context)
:::

## zygisk 核心类

::: details 单类清单
- [Module (cpp)](./zygisk/module-cpp) · [Main / ForkCommon](./zygisk/main-fork-common) · [BridgeService](./zygisk/bridge-service) · [IpcBridge](./zygisk/ipc-bridge) · [ParasiticManagerHooker](./zygisk/parasitic-manager-hooker)
:::

## native 深入

::: details 单类清单
- [Context](./native/context) · [HookBridge (cpp)](./native/hook-bridge-cpp) · [ElfImage](./native/elf-image) · [ResourcesHook (cpp)](./native/resources-hook-cpp)
- [ARSC 解析](./native/arsc-parser) · [资源重写循环](./native/resource-rewriter) · [inline hook 引擎](./native/inline-scope) · [符号解析与缓存](./native/symbol-resolver) · [JNI 桥](./native/jni-bridge) · [ArtMethod 访问](./native/art-method-access) · [logcat 零拷贝写入](./native/logcat-writer) · [daemon socket](./native/daemon-socket) · [ConfigBridge](./native/config-bridge) · [反优化跳板](./native/deopt-trampoline)
:::

## xposed 实现单类

::: details 单类清单
- 拦截器核心：[VectorChain](./xposed/vector-chain) · [VectorNativeHooker](./xposed/vector-native-hooker) · [VectorDeopter](./xposed/vector-deopter) · [VectorModuleClassLoader](./xposed/vector-module-classloader) · [VectorBootstrap](./xposed/vector-bootstrap) · [HookBridge (JNI)](./xposed/hook-bridge)
- Hookers：[LoadedApkHookers](./xposed/loaded-apk-hookers) · [SystemServerHookers](./xposed/system-server-hookers) · [AppAttachHooker](./xposed/app-attach-hooker)
- 调用与服务：[BaseInvoker](./xposed/base-invoker) · [VectorLegacyCallback](./xposed/vector-legacy-callback) · [VectorServiceClient](./xposed/vector-service-client) · [VectorModuleManager](./xposed/vector-module-manager) · [VectorInlinedCallers](./xposed/vector-inlined-callers) · [VectorLifecycleManager](./xposed/vector-lifecycle-manager) · [VectorMetaDataReader](./xposed/vector-meta-data-reader) · [VectorURLStreamHandler](./xposed/vector-url-stream-handler)
:::

## legacy 深入

::: details 单类清单
- [XposedBridge](./legacy/xposed-bridge) · [XposedHelpers](./legacy/xposed-helpers) · [XposedInit](./legacy/xposed-init) · [XSharedPreferences](./legacy/xshared-preferences) · [XC_MethodHook](./legacy/xc-method-hook) · [LegacyDelegateImpl](./legacy/legacy-delegate)
- [XposedHelpers 工具方法](./legacy/xposed-helpers-extra) · [XC_MethodReplacement](./legacy/xc-method-replacement) · [XposedBridge 内部状态](./legacy/xposed-bridge-tl) · [回调分发](./legacy/callback-dispatch) · [入口回调契约](./legacy/init-zygote-callback) · [IXposedMod 规范](./legacy/xposed-module-interface)
:::

## hiddenapi 桥方法

::: details 单类清单
- [方法调用桥](./hiddenapi/bridge-methods-invoke) · [字段访问桥](./hiddenapi/bridge-methods-field) · [构造对象桥](./hiddenapi/bridge-methods-new-instance) · [bridge 与 stubs 协作](./hiddenapi/bridge-stubs-bridge)
:::

## 相关

- [模块总览](../modules/) — 11 个 Gradle 模块的高层视角
- [AIDL 接口参考](../aidl/) — 跨进程服务契约
- [架构总览](../../architecture/overview) — 子系统如何协作
