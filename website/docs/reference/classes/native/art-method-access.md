# 🧩 ArtMethod Access（C++）

> 📂 [`native/src/core/context.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/core/context.cpp)（`InitArtHooker`）
> 📂 [`native/src/jni/hook_bridge.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/jni/hook_bridge.cpp)（`deoptimizeMethod`）
> 📂 [`native/src/core/native_api.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/core/native_api.cpp)（`art_symbol_resolver`）
> 🟦 native 模块 · ArtMethod 跨版本字段访问（基于调用方推断）

## 类职责

Vector native 库**不直接定义 ArtMethod 字段偏移**。`access_flags`、`entry_point_from_quick_compiled_code` 等 ArtMethod 内部字段的偏移与跨版本兼容，由 **LSPlant** 库内部管理；Vector 仅通过三处接入点间接参与：`Context::InitArtHooker` 调 `lsplant::Init` 传入运行时探测信息、`native_api.cpp` 提供 `art_symbol_resolver` 让 LSPlant 解析 ART 内部符号、`hook_bridge.cpp` 暴露 `deoptimizeMethod` 调 `lsplant::Deoptimize`。

> ⚠️ 说明：任务描述提到的「ArtMethod 字段偏移与跨版本兼容」在 Vector 仓库源码中**无独立实现**——这些偏移表封装在 LSPlant 内部（外部依赖），Vector 只负责把正确的符号解析器与初始化信息喂给它。本文基于 Vector 对 LSPlant 的调用方推断，标注各接入点职责。

## 接入点一：InitArtHooker

```cpp
void Context::InitArtHooker(JNIEnv *env, const lsplant::InitInfo &initInfo) {
    if (!lsplant::Init(env, initInfo)) {
        LOGE("Failed to initialize LSPlant hooking framework.");
    }
}
```

`Context` 子类在初始化时构造 `lsplant::InitInfo`（含 ART 版本探测回调、符号解析器、inline hooker 等）传给 `lsplant::Init`。LSPlant 内部据此探测当前 Android 版本的 ArtMethod 布局、entry point 字段偏移、`access_flags` 位置等，建立跨版本兼容的 hook 基础。失败仅 log，不阻断。

## 接入点二：art_symbol_resolver

```cpp
// native_api.cpp, RegisterNativeLib 内
return InstallNativeAPI(lsplant::InitInfo{
    .inline_hooker = [](void *target, void *replacement) {
        void *backup = nullptr;
        return HookInline(target, replacement, &backup) == 0 ? backup : nullptr;
    },
    .art_symbol_resolver = [](auto symbol) {
        return ElfSymbolCache::GetLinker()->getSymbAddress(symbol);
    },
});
```

LSPlant 需要解析 ART 内部符号（如 `ArtMethod::SetAccessFlags`、`quick_to_interpreter_bridge`、`kAccessFlagsOffset` 相关函数）时会回调 `art_symbol_resolver`。Vector 实现用 `ElfSymbolCache::GetLinker()`（`libart.so` 的 `ElfImage`）`getSymbAddress(symbol)` 按名查地址。

> 📂 ArtMethod 字段偏移的真正符号/常量定义在 LSPlant 内部（[`external/lsplant`](https://github.com/android-security-engineer/Vector-skills/blob/master/external/lsplant)），Vector 仓库不包含其源码。

## 接入点三：deoptimizeMethod

```cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, HookBridge, deoptimizeMethod, jobject hookMethod) {
    return lsplant::Deoptimize(env, hookMethod);
}
```

Java 侧 `HookBridge.deoptimizeMethod` 直接转调 `lsplant::Deoptimize`。LSPlant 内部会重置目标 ArtMethod 的状态机——把 JIT/AOT 编译的 `entry_point_from_quick_compiled_code` 切回解释器桥，强制方法走解释执行，使 hook 生效（见 [deopt-trampoline](./deopt-trampoline)）。Vector 不参与状态机重置细节，仅暴露 JNI 入口。

## LSPlant InitInfo 关键字段

```cpp
// lsplant::InitInfo（LSPlant 提供，Vector 填充）
struct InitInfo {
    // ART 内部符号解析回调（Vector 用 ElfSymbolCache::GetArt/Linker 实现）
    std::function<void *(std::string_view)> art_symbol_resolver;
    // inline hook 回调（Vector 用 HookInline → Dobby）
    std::function<void *(void *, void *)> inline_hooker;
    // ... 版本探测、entry point 信息等由 LSPlant 内部使用
};
```

| InitInfo 字段 | Vector 实现 | LSPlant 用途 |
| :--- | :--- | :--- |
| `art_symbol_resolver` | `ElfSymbolCache::GetLinker()->getSymbAddress` | 解析 `libart.so` 内 ArtMethod 相关函数符号 |
| `inline_hooker` | `HookInline`（→ Dobby） | entry point 替换的底层 inline hook |

`access_flags`、`entry_point_from_quick_compiled_code` 偏移探测逻辑封装在 LSPlant `Init` 内部，对 Vector 不可见。

## ArtMethod 访问链路

```mermaid
flowchart TD
    A["Context 子类初始化"] --> B["构造 lsplant::InitInfo"]
    B --> C["art_symbol_resolver = ElfSymbolCache::GetLinker"]
    B --> D["inline_hooker = HookInline (Dobby)"]
    C --> E["lsplant::Init(env, initInfo)"]
    D --> E
    E --> F["LSPlant 内部探测 ArtMethod 偏移<br/>access_flags / entry_point"]
    F --> G["建立跨版本 hook 基础"]
    G --> H["运行中 lsplant::Hook / Deoptimize"]
    H --> I["Java: HookBridge.deoptimizeMethod"]
    I --> J["lsplant::Deoptimize<br/>重置 ArtMethod 状态机"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,E class vec
    class F,J class hot
    class A,G,H,I class plain
```

## 相关

- [inline-scope.md · Dobby inline hook](./inline-scope) — `inline_hooker` 委托给 `HookInline`
- [symbol-resolver.md · ElfImage 符号查找](./symbol-resolver) — `art_symbol_resolver` 的底层
- [deopt-trampoline.md · 反优化跳板](./deopt-trampoline) — `lsplant::Deoptimize` 与 dex2oat 反优化组合
- [context.md · 运行时上下文](./context) — `InitArtHooker` 的宿主
- [native-core · native 总览](../native-core)
