# Native 模块

除了 Java 层的 Hook，Vector 还支持 **native Hook 模块**——直接在 native 层做 inline hook，适合 hook 系统 native 函数、绕过 Java 层限制的场景。这套机制基于 [Dobby](https://github.com/JingMatrix/Dobby) inline hooking 框架。

## 何时用 native 模块

| 场景 | 用 Java Hook | 用 native Hook |
| :--- | :--- | :--- |
| Hook Java 方法 | ✓ | — |
| Hook native 函数（`libart.so` 内部） | ✗ | ✓ |
| Hook 系统 syscall 包装 | ✗ | ✓ |
| 需要 Java 上下文 | ✓ | 复杂 |

native Hook 不经过 Java，直接改写 native 函数的机器码入口，插一个跳转。

## 如何声明

在模块 APK 里放 `assets/native_init` 文件，内容是 native 库文件名（每行一个）：

```text
libmynative.so
```

框架加载模块时，会把这些名字经 `NativeAPI::recordNativeEntrypoint` 注册。当系统 `do_dlopen` 加载同名库时，框架检测到并调用该库的 `native_init` 入口点。

## 入口点

你的 native 库需要导出 `native_init` 函数，接收一个 API 表：

```cpp
#include "native_api.h"

extern "C" void native_init(VectorNativeApi *api) {
    // api 提供创建 inline hook 的能力
    // 例如 hook libart.so 里的某个内部函数
}
```

`native_api` 系统的工作原理：

```mermaid
graph TD
    A["模块声明 libmynative.so"]:::in
    A --> B["框架注册到 NativeAPI"]:::step
    B --> C["系统 do_dlopen("libmynative.so")"]:::step
    C --> D["native 模块 hook 了 do_dlopen<br/>检测到已注册库"]:::step
    D --> E["调用该库的 native_init，传入 API 表"]:::step
    E --> F["native_init 里用 Dobby 做 inline hook"]:::out
    classDef in fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    classDef step fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    classDef out fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

## API 能力

`native_api` 提供一组创建自身 native hook 的 API。具体接口见 [native_api.h](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/core/native_api.h)。

::: tip 不直接访问框架核心符号
native 模块**不直接链接**框架的核心符号。它只通过 `native_init` 拿到的 API 表与框架交互。这保证了 native 模块与框架内部实现的解耦——框架升级不会破坏已编译的 native 模块。
:::

## 符号解析

native Hook 的前提是找到目标函数地址。Vector 的 `ElfImage` 能解析 stripped 二进制——它解压 `.gnu_debugdata` 段拿到隐藏符号表，再用 GNU hash → ELF hash → 线性扫描的级联策略查找。

你的 native 模块通常不需要自己写 ELF 解析，框架的 `ElfSymbolCache` 已经缓存了 `libart.so`、linker 等常用库。但理解这一点有助于排查"找不到符号"的问题。

## 与 Java 模块共存

native 模块可以和 Java 模块在同一个 APK 里共存——同时声明 `assets/xposed_init` 和 `assets/native_init` 即可。Java 部分 hook Java 方法，native 部分 hook native 函数，两者独立运作。

## 参考

- [Native Hook wiki (LSPosed)](https://github.com/LSPosed/LSPosed/wiki/Native-Hook)
- [Dobby inline hooking](https://github.com/JingMatrix/Dobby)
- [native_api.h 头文件](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/core/native_api.h)
