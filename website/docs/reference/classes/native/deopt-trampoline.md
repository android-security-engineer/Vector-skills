# 🧩 Deopt Trampoline（C++）

> 📂 `native/src/jni/hook_bridge.cpp`（`deoptimizeMethod`）
> 📂 `dex2oat/src/main/cpp/dex2oat.cpp`（`--inline-max-code-units=0`）
> 📂 `dex2oat/src/main/cpp/oat_hook.cpp`（cmdline 伪造）
> 🟦 native/dex2oat 模块 · 反优化的 native 部分

## 类职责

Vector 的「反优化跳板」**不是一个单独的类**，而是三个组件协作的组合机制，确保被 hook 的 Java 方法**不走 AOT/JIT 内联编译路径**、必要时**重置 ArtMethod 状态机回解释执行**。任务描述的「dex2oat 标记后 ArtMethod 状态机重置」对应：(1) dex2oat wrapper 给编译器加 `--inline-max-code-units=0` 阻止内联；(2) `oat_hook` 伪造 OAT 头 cmdline 隐藏此标记；(3) 运行时 `HookBridge.deoptimizeMethod` 调 `lsplant::Deoptimize` 重置目标方法 entry point。

> ⚠️ ArtMethod 状态机重置的底层（`entry_point_from_quick_compiled_code` 切回解释器桥）由 LSPlant `Deoptimize` 内部完成，Vector 仅暴露 JNI 入口并准备 dex2oat 编译期条件（见 [art-method-access](./art-method-access)）。

## 运行时反优化 deoptimizeMethod

```cpp
// hook_bridge.cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, HookBridge, deoptimizeMethod, jobject hookMethod) {
    return lsplant::Deoptimize(env, hookMethod);
}
```

Java 侧 `HookBridge.deoptimizeMethod(Executable)` 直接转调 `lsplant::Deoptimize`。LSPlant 内部把目标 `ArtMethod` 的 quick 入口从编译产物切回 `quick_to_interpreter_bridge`，使方法强制走解释器——这样 ART 不会再跳进内联/编译代码绕过 hook。返回布尔表示成功。某些 hook（如对 JIT 已编译方法）必须先 deopt 才能生效。

## 编译期反内联 dex2oat wrapper

```cpp
// dex2oat.cpp, exec_argv 构造
exec_argv.push_back(linker_path);
exec_argv.push_back(stock_fd_path);              // 原版 dex2oat
for (int i = 1; i < argc; ++i) exec_argv.push_back(argv[i]);
exec_argv.push_back("--inline-max-code-units=0");  // 禁用方法内联
exec_argv.push_back(nullptr);
setenv("LD_PRELOAD", ("/proc/self/fd/" + std::to_string(hooker_fd)).c_str(), 1);
setenv("DEX2OAT_CMD", argv[0], 1);
execve(linker_path, exec_argv.data(), environ);
```

Vector wrapper 在 dex2oat 命令行追加 `--inline-max-code-units=0`：告诉 ART 编译器**任何方法都不内联进调用者**。这是反优化的编译期手段——若目标方法被内联进别处，hook 目标方法本体无法影响那些内联调用点；禁内联后每个调用都经方法本体，hook 才能全面生效。wrapper 同时 `LD_PRELOAD` 注入 `liboat_hook.so`。

## OAT 头 cmdline 伪造 oat_hook

```cpp
// oat_hook.cpp
const std::string_view kParamToRemove = "--inline-max-code-units=0";
std::string g_binary_path = getenv("DEX2OAT_CMD");  // 原始 dex2oat 路径

bool SpoofKeyValueStore(uint8_t* store) {
    // 解析 OAT 头 key-value store，定位 "dex2oat-cmdline" 条目
    if (key == art::OatHeader::kDex2OatCmdLineKey &&
        value.find(kParamToRemove) != std::string_view::npos) {
        std::string cleaned_cmd = process_cmd(value, g_binary_path);
        // 若有 padding 则原地覆写；否则重建 store 并重算 size
    }
}
```

`--inline-max-code-units=0` 会写进生成 OAT 文件的 `dex2oat-cmdline` 头字段，可被反检测。`oat_hook`（PLT hook `OatHeader::GetKeyValueStore`/`ComputeChecksum`）在 dex2oat 写头时拦截，用 `process_cmd` 把命令行首个 token（wrapper 路径）换回原版 `DEX2OAT_CMD` 路径并删除该 flag，再重算 checksum——生成的 OAT 看起来像原版 dex2oat 正常产出。

## PLT hook 选型与版本分支

```cpp
// oat_hook.cpp
void register_hook(dev_t dev, ino_t inode, const char* symbol, void* new_func, void** old_func) {
    lsplt::RegisterHook(dev, inode, symbol, new_func, old_func);
}

__attribute__((constructor)) static void initialize() {
    // 扫 lsplt::MapInfo::Scan() 找 bin/dex2oat 的 dev/inode
    PLT_HOOK_REGISTER(dev, inode, _ZNK3art9OatHeader16GetKeyValueStoreEv);
    if (!lsplt::CommitHook()) {   // Android <16 失败则
        PLT_HOOK_REGISTER(dev, inode, _ZNK3art9OatHeader15ComputeChecksumEPj);  // 16+ 走 checksum
        lsplt::CommitHook();
    }
}
```

`oat_hook` 用 **lsplt**（PLT hook，非 inline）拦截。Android 16+ 改在 `ComputeChecksum` 阶段拦截（此时数据已就绪、可重算校验和）。`__attribute__((constructor))` 让库被 `LD_PRELOAD` 加载时自动初始化。

## 三段协作流程

```mermaid
flowchart TD
    subgraph COMPILE["编译期（dex2oat）"]
        A["wrapper execve"] --> B["追加 --inline-max-code-units=0"]
        B --> C["LD_PRELOAD liboat_hook.so"]
        C --> D["dex2oat 编译<br/>禁内联"]
        D --> E["oat_hook PLT 拦截<br/>GetKeyValueStore/ComputeChecksum"]
        E --> F["SpoofKeyValueStore<br/>删 flag + 换路径 + 重算 checksum"]
        F --> G["产出无痕 OAT"]
    end
    subgraph RUNTIME["运行时（目标进程）"]
        H["Java: HookBridge.deoptimizeMethod"] --> I["lsplant::Deoptimize"]
        I --> J["ArtMethod entry_point<br/>切回 interpreter bridge（LSPlant 内部）"]
        J --> K["方法走解释器<br/>hook 全面生效"]
    end
    G -.->|"加载 OAT 后<br/>运行时按需 deopt"| H

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,E,F,I,J class vec
    class A,G,H,K class plain
```

## 相关

- [art-method-access.md · ArtMethod 跨版本访问](./art-method-access) — `lsplant::Deoptimize` 与 ArtMethod 偏移的归属
- [daemon-socket.md · dex2oat socket](./daemon-socket) — wrapper 经 socket 拿原版 dex2oat 与 hook 库 FD
- [hook-bridge-cpp.md · ART hook 引擎](./hook-bridge-cpp) — `deoptimizeMethod` 所属 JNI 桥
- [dex2oat-hooker.md · dex2oat hook](../dex2oat-hooker) — 整体 dex2oat 拦截架构
- [native-core · native 总览](../native-core)
