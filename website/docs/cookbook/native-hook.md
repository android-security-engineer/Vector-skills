# 🪝 native 函数 Hook

> 难度 ⭐⭐⭐⭐ · 直接在 native 层做 inline hook，适合 Java 层够不着的场景。

## 何时用

| 场景 | Java Hook | native Hook |
| :--- | :--- | :--- |
| Hook Java 方法 | ✓ | — |
| Hook `libart.so` 内部函数 | ✗ | ✓ |
| Hook 系统 syscall 包装 | ✗ | ✓ |
| 需要 Java 上下文 | ✓ | 复杂 |

native Hook 不经过 Java，直接改写 native 函数的机器码入口，插一个跳转。基于 [Dobby](https://github.com/JingMatrix/Dobby)。

## 声明 native 模块

在模块 APK 里放 `assets/native_init`，内容是 native 库文件名：

```text
libmynative.so
```

框架加载模块时，把这些名字经 `NativeAPI::recordNativeEntrypoint` 注册。当系统 `do_dlopen` 加载同名库时，框架检测到并调用该库的 `native_init` 入口点。

## 入口点

你的 native 库需导出 `native_init`，接收一个 API 表：

```cpp
#include "native_api.h"

extern "C" void native_init(VectorNativeApi *api) {
    // api 提供创建 inline hook 的能力
    // 例：hook libart.so 里的某个内部函数
    void *target = /* 目标函数地址，可经 ElfImage 查找 */;
    void *replace = &my_replace_func;
    void **backup = &orig_func;
    api->hook(target, replace, backup);   // Dobby inline hook
}
```

## 工作流程

```mermaid
graph TD
    A["模块声明 libmynative.so"]:::in
    A --> B["框架注册到 NativeAPI"]:::step
    B --> C["系统 do_dlopen(\"libmynative.so\")"]:::step
    C --> D["native 模块 hook 了 do_dlopen<br/>检测到已注册库"]:::step
    D --> E["调用 native_init，传入 API 表"]:::step
    E --> F["native_init 里用 Dobby 做 inline hook"]:::out
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## 符号解析

native Hook 的前提是找到目标函数地址。Vector 的 `ElfImage` 能解析 stripped 二进制——解压 `.gnu_debugdata` 段拿隐藏符号表，再用 GNU hash → ELF hash → 线性扫描级联查找。

你的 native 模块通常不需自己写 ELF 解析，框架的 `ElfSymbolCache` 已缓存 `libart.so`、linker 等常用库。详见 [native · elf 包](../reference/classes/native-elf)。

## 与 Java 模块共存

native 模块可和 Java 模块在同一 APK 共存——同时声明 `assets/xposed_init` 和 `assets/native_init`。Java 部分 hook Java 方法，native 部分 hook native 函数，独立运作。

## 参考

- [Native 模块](../developer/native)
- [native · core 包](../reference/classes/native-core)
- [native_api.h 头文件](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/core/native_api.h)
