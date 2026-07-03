# 📦 打包 native 库进模块

> 难度 ⭐⭐⭐ · 把 `.so` 打进模块 APK，配合 `assets/native_init` 让框架在合适时机加载。

## 场景

模块除 Java Hook 外还要做 native inline hook（Dobby），或需要在 Java 层调用一个自己写的 native 工具函数。

## 两种加载路径

```mermaid
graph TD
    SO[".so 打进 APK lib/<abi>/"]:::step
    SO --> P1{"应用自己 System.loadLibrary"}:::vec
    P1 -->|是| A1["宿主 ClassLoader 找到 .so<br/>常规 dlopen"]:::ok
    P1 -->|否，走框架"| A2["assets/native_init 声明库名"]:::step
    A2 --> B["NativeAPI.recordNativeEntrypoint 注册"]:::vec
    B --> C["系统 do_dlopen 同名库时<br/>框架拦截并调用 native_init 入口"]:::ok
    style SO fill:#1a2030,stroke:#6b7689,color:#cdd6e3
    style vec fill:#0e3a36,stroke:#3dd8c8,color:#bff5ec
    style ok fill:#1a3a1a,stroke:#5cd980,color:#bfffd0
```

| 方式 | 触发者 | 适合 |
| :--- | :--- | :--- |
| `System.loadLibrary("foo")` | 宿主/模块自己 | Java 调 native 工具函数 |
| `assets/native_init` 声明 | 框架在 do_dlopen 时 | native inline hook 模块（框架调你的 `native_init`） |

## abiFilters 与打包

Gradle 里限定要打包的 ABI，避免无用架构拖大体积：

```kotlin
android {
    defaultConfig {
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }
}
```

> 框架按进程位数选择 ABI：64 位进程用 `Build.SUPPORTED_64_BIT_ABIS`，32 位用 `SUPPORTED_32_BIT_ABIS`。模块应同时提供两种位数，否则在不对位数的进程里加载失败。

## 模块 ClassLoader 的库搜索路径

`XposedInit.loadModule` 构造 `VectorModuleClassLoader` 时，按当前进程位数拼出 `librarySearchPath`：

```
/path/to/module.apk!/lib/arm64-v8a:/path/to/module.apk!/lib/armeabi-v7a:
```

所以 `System.loadLibrary("foo")` 能在模块 ClassLoader 下找到 `libfoo.so`。注意要用**模块自己的 ClassLoader** 调 `loadLibrary`，而非系统 ClassLoader。

## 配合 native_init

`assets/native_init` 内容是库文件名（不含 `lib` 前缀和 `.so` 后缀），每行一个：

```text
mynative
```

框架加载模块时经 `NativeAPI::recordNativeEntrypoint` 记下名字；当系统后续 `do_dlopen("libmynative.so")` 时，框架已 hook 了 `do_dlopen`，检测到注册名匹配就调用该库导出的 `native_init(VectorNativeApi*)` 入口，把 inline hook 能力表传进去。

```cpp
// 你的 .so 里导出
extern "C" void native_init(VectorNativeApi *api) {
    // api->hook 提供 Dobby inline hook 能力
    void *target = /* 目标函数地址，可借助 ElfImage/ElfSymbolCache */;
    api->hook(target, &my_replace, &orig_backup);
}
```

## 与 Java 模块共存

同一 APK 可同时声明 `assets/xposed_init`（Java 入口）和 `assets/native_init`（native 入口）。Java 部分 hook Java 方法，native 部分 hook native 函数，独立运作，互不干扰。详见 [native 函数 Hook](./native-hook)。

## 自检清单

| 项 | 检查 |
| :--- | :--- |
| ABI 齐全 | arm64-v8a / armeabi-v7a 都有，按需加 x86_64 |
| 库名匹配 | `native_init` 写的 `mynative` 对应 `libmynative.so` |
| 入口符号 | 导出 `native_init`（C 链接，未 strip） |
| 位数对齐 | 64 位进程里不要只放 32 位 .so |
| 不混 API 类 | 不要把 `de.robv.android.xposed.*` 编进 .so 依赖 |

## 陷阱

| 陷阱 | 后果 | 对策 |
| :--- | :--- | :--- |
| 用系统 ClassLoader loadLibrary | 找不到模块 .so | 用模块 ClassLoader |
| 只打 64 位 | 32 位进程加载失败 | abiFilters 含两套 |
| `native_init` 被 strip | 入口找不到 | 导出符号加 `extern "C"` + 不 strip |
| 库名写全 `libmynative.so` | 框架按全名匹配失败 | `native_init` 写 `mynative` |

## 相关

- [native 函数 Hook](./native-hook)
- [Native 模块](../developer/native)
- [legacy · XposedInit（initNativeModule）](../reference/classes/legacy-impl)
- [native · core 包](../reference/classes/native-core)
