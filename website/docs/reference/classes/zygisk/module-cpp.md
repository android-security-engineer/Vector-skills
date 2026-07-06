# 🧩 VectorModule (module.cpp)

> 📂 [`zygisk/src/main/cpp/module.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/zygisk/src/main/cpp/module.cpp)
> 🟦 zygisk 模块 · Zygisk 生命周期与 specialize 回调

## 类职责

`class VectorModule : public zygisk::ModuleBase, public vector::native::Context` 是 Zygisk 加载器的**主入口类**。它继承 `ModuleBase` 接收 Zygisk 生命周期回调，继承 `native::Context` 获得 DEX 加载、ART hook、JNI hook、入口类查找等核心注入能力。它负责：判断进程是否为注入目标、向 daemon 请求 binder、拉取框架 DEX 与混淆映射、初始化 ART/JNI hook、定位 Java 入口类、调用 `Main.forkCommon`，并在失败时允许 Zygisk 卸载本库。

## 进程过滤常量

```cpp
constexpr int FIRST_ISOLATED_UID = 99000;
constexpr int LAST_ISOLATED_UID = 99999;
constexpr int FIRST_APP_ZYGOTE_ISOLATED_UID = 90000;
constexpr int LAST_APP_ZYGOTE_ISOLATED_UID = 98999;
constexpr int SHARED_RELRO_UID = 1037;
constexpr int PER_USER_RANGE = 100000;
constexpr uid_t kHostPackageUid = INJECTED_PACKAGE_UID;
constexpr uid_t GID_INET = 3003;
enum RuntimeFlags : uint32_t { LATE_INJECT = 1 << 30 };
```

`kHostPackageName`/`kManagerPackageName` 由 CMake 注入。

## ConfigImpl

```cpp
using obfuscation_map_t = std::map<std::string, std::string>;
class ConfigImpl : public ConfigBridge {
    inline static void Init();
    obfuscation_map_t &obfuscation_map() override;
    void obfuscation_map(obfuscation_map_t m) override;
};
```

内存中持有混淆映射的 `ConfigBridge` 实现，`onLoad` 时 `ConfigImpl::Init()`，`postAppSpecialize` 拉取后 `obfuscation_map(std::move(map))` 写入。

## ART hook 配置

```cpp
const lsplant::InitInfo init_info_{
    .inline_hooker = [](target, replace) { ... HookInline ... },
    .inline_unhooker = [](target) { ... UnhookInline ... },
    .art_symbol_resolver = [](symbol) { return ElfSymbolCache::GetArt()->getSymbAddress(symbol); },
    .art_symbol_prefix_resolver = [](symbol) { ... getSymbPrefixFirstAddress ... },
    .generated_class_name = "Vector_",
    .generated_source_name = "Dobby",
};
```

lsplant 的内联 hook 委托给 native 库的 `HookInline`/`UnhookInline`，ART 符号解析走 `ElfSymbolCache::GetArt()`。生成的 hook 类名前缀 `Vector_`、源名 `Dobby`。

## onLoad

```cpp
void onLoad(zygisk::Api *api, JNIEnv *env) override
```

保存 `api_`/`env_`，`instance_.reset(this)` 把自己注册为 `Context` 单例，`ConfigImpl::Init()`。

## preAppSpecialize · 注入决策

```cpp
void preAppSpecialize(zygisk::AppSpecializeArgs *args) override
```

- 重置 `should_inject_=false`、`is_manager_app_=false`；
- **管理器特殊处理**：`uid == kHostPackageUid && niceName == kManagerPackageName` 时，扩容 GID 数组追加 `GID_INET`（授网络权限），`niceName` 改为 `INJECTED_PACKAGE_NAME`，置 `is_manager_app_=true`；
- `IPCBridge::Initialize(env_)`；
- 过滤：无 `app_data_dir`、`is_child_zygote`、isolated/app-zygote-isolated/`SHARED_RELRO_UID` 均跳过；
- 通过则 `should_inject_=true`。

## postAppSpecialize · 框架注入

```cpp
void postAppSpecialize(const zygisk::AppSpecializeArgs *args) override
```

1. `!should_inject_` → `SetAllowUnload(true)` 返回；
2. `is_manager_app_` 时恢复 `niceName = kManagerPackageName`；
3. `IPCBridge::RequestAppBinder(env_, args->nice_name)`，失败则卸载返回；
4. `FetchFrameworkDex` → `FetchObfuscationMap` → `ConfigBridge.obfuscation_map(std::move)`；
5. `PreloadedDex dex(dex_fd, dex_size)` + `LoadDex(env_, std::move(dex))`，`close(dex_fd)`（mmap 已复制）；
6. `InitArtHooker(env_, init_info_)` + `InitHooks(env_)` + `SetupEntryClass(env_)`；
7. `FindAndCall(env_, "forkCommon", "(ZZLjava/lang/String;Ljava/lang/String;Landroid/os/IBinder;)V", JNI_FALSE, JNI_FALSE, niceName, appDataDir, binder, is_manager_app_)`；
8. `SetAllowUnload(false)` 防止 dlclose。

## pre/postServerSpecialize · system_server

```cpp
void preServerSpecialize(zygisk::ServerSpecializeArgs *args) override
```

`should_inject_=true`，`IPCBridge::Initialize`。

```cpp
void postServerSpecialize(const zygisk::ServerSpecializeArgs *args) override
```

- ZTE workaround：`ro.vendor.product.ztename` 存在时反射 `Process.setArgV0("system_server")`；
- `bridgeServiceName` 默认 `"serial"`，`runtime_flags & LATE_INJECT` 时改 `"serial_vector"`；
- `RequestSystemServerBinder` → `RequestManagerBinderFromSystemServer`，`effective_binder` 取 manager 优先否则用 system 代理；
- 同样 `FetchFrameworkDex`/`FetchObfuscationMap`/`LoadDex`/`close`；
- **`IPCBridge::HookBridge(env_)`**（仅 system_server 安装 Binder Trap）；
- `InitArtHooker`/`InitHooks`/`SetupEntryClass`；
- `FindAndCall("forkCommon", ..., JNI_TRUE, is_late_inject, "system", nullptr, manager_binder, is_manager_app_)`。

## LoadDex · InMemoryDexClassLoader

```cpp
void LoadDex(JNIEnv *env, PreloadedDex &&dex) override
```

`getSystemClassLoader` 作父，`NewDirectByteBuffer(dex.data(), dex.size())` 包装内存，`InMemoryDexClassLoader(ByteBuffer, ClassLoader)` 构造，`NewGlobalRef` 存 `inject_class_loader_`。

## SetupEntryClass

```cpp
void SetupEntryClass(JNIEnv *env) override
```

`obfs_map.at("org.matrix.vector.core.") + "Main"` 算出真实入口类名，`FindClassFromLoader(env, inject_class_loader_, name)` 找到，`NewGlobalRef` 存 `entry_class_`。

## SetAllowUnload

```cpp
void SetAllowUnload(bool unload)
```

`unload=true` 时 `api_->setOption(zygisk::DLCLOSE_MODULE_LIBRARY)` 并 `instance_.release()`（防静态 `unique_ptr` 析构 double-free）；否则仅记日志。

## 注入流程

```mermaid
flowchart TD
    Load["onLoad"] --> Pre["preSpecialize"]
    Pre --> Dec{"注入决策"}
    Dec -->|非目标| Unload["SetAllowUnload(true)"]
    Dec -->|目标| Post["postSpecialize"]
    Post --> RB["RequestAppBinder / RequestSystemServerBinder"]
    RB --> Fetch["FetchFrameworkDex + FetchObfuscationMap"]
    Fetch --> LD["LoadDex (InMemoryDexClassLoader)"]
    LD --> Hook["InitArtHooker + InitHooks"]
    Hook --> EC["SetupEntryClass"]
    EC --> FC["FindAndCall forkCommon"]
    FC --> Keep["SetAllowUnload(false)"]
    Post -.->|system_server| HB["HookBridge (Binder Trap)"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class RB,Fetch,LD,Hook,EC,FC,HB class vec
    class Dec class hot
    class Load,Pre,Post,Keep,Unload class plain
```

## 相关

- [ipc-bridge · IPCBridge 通信](./ipc-bridge)
- [main-fork-common · forkCommon Java 入口](./main-fork-common)
- [bridge-service · system_server 端 execTransact](./bridge-service)
- [obfuscation-manager · 混淆映射产出](../daemon/obfuscation-manager)
