# 🧩 Config Bridge（C++）

> 📂 [`native/include/core/config_bridge.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/core/config_bridge.h)
> 📂 [`native/src/core/context.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/core/context.cpp)（实例化）
> 📂 [`native/include/jni/jni_bridge.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/jni/jni_bridge.h)（消费方 `GetNativeBridgeSignature`）
> 🟦 native 模块 · native 侧配置缓存（混淆表）

## 类职责

`class ConfigBridge`（`namespace vector::native`）是 native 库的**配置数据单例缓存**，当前仅承载**混淆映射表** `obfuscation_map`（原始类名→混淆后 JNI 内部名）。它是抽象基类（`obfuscation_map` 纯虚），实际实例由平台子类（如 zygisk `IPCBridge` 路径）从 daemon 拉取混淆表后填充，再经 `GetInstance()` 暴露给 native 全局。

native 侧不直接连 daemon 拉配置——混淆表在初始化时一次性灌入 `ConfigBridge`，后续所有 JNI 桥注册、资源 hook 类名解析都从这份缓存读，避免每次注册都走 IPC。

## 单例管理

```cpp
class ConfigBridge {
public:
    virtual ~ConfigBridge() = default;
    ConfigBridge(const ConfigBridge &) = delete;
    ConfigBridge &operator=(const ConfigBridge &) = delete;

    static ConfigBridge *GetInstance() { return instance_.get(); }
    static std::unique_ptr<ConfigBridge> ReleaseInstance() { return std::move(instance_); }

    virtual std::map<std::string, std::string> &obfuscation_map() = 0;   // 取
    virtual void obfuscation_map(std::map<std::string, std::string> map) = 0;  // 设

protected:
    ConfigBridge() = default;
    static std::unique_ptr<ConfigBridge> instance_;   // 与 Context 生命周期绑定
};
```

`GetInstance()` 返回裸指针，未初始化返回 `nullptr`，调用方须自检。`ReleaseInstance()` `std::move` 转移所有权用于关闭。`obfuscation_map()` 是 getter/setter 对（取引用/按值设），子类持 `std::map` 成员实现之。`instance_` 是 `protected` 静态 `unique_ptr`——在 `context.cpp` 顶部 `std::unique_ptr<ConfigBridge> ConfigBridge::instance_;` 定义，由子类在构造时写入。

## 实例化与 Context 同构

```cpp
// context.cpp
std::unique_ptr<Context> Context::instance_;
std::unique_ptr<ConfigBridge> ConfigBridge::instance_;   // 与 Context 同时定义
```

`ConfigBridge::instance_` 与 `Context::instance_` 在同一文件定义，生命周期对齐——子类（如 `IPCBridge` 持有的 native context）在初始化时同时创建两者，关闭时同时 `ReleaseInstance`，保证配置缓存与运行时上下文同生共死。

## 消费方：GetNativeBridgeSignature

```cpp
// jni_bridge.h
inline std::string GetNativeBridgeSignature() {
    auto *bridge = ConfigBridge::GetInstance();
    if (bridge) {
        const auto &obfs_map = bridge->obfuscation_map();
        auto it = obfs_map.find("org.matrix.vector.nativebridge.");
        if (it != obfs_map.end()) return it->second;   // 混淆后 "org/xxx/.../"
    }
    return "org/matrix/vector/nativebridge/";   // 回退默认
}
```

JNI 桥注册时（见 [jni-bridge](./jni-bridge)）按 key `org.matrix.vector.nativebridge.` 查混淆表，拿到混淆后包名作为 Java 类签名前缀。`ConfigBridge` 为空（未初始化）或表里无 key 时回退未混淆默认值，保证开发期可调试。

## 消费方：GetXResourcesClassName

```cpp
// resources_hook.cpp
auto it = obfs_map.find("android.content.res.XRes");
if (it == obfs_map.end()) { LOGE("Could not find obfuscated name for XResources."); return ""; }
std::string jni_name = it->second + "ources";   // 拼 "ources" 还原 XResources
```

资源 hook 用 key `android.content.res.XRes` 查混淆前缀，再拼 `ources` 还原完整类名。混淆表只在构建期生成（混淆器按这些固定 key 改包名），native 侧用固定 key 查。

## 灌入时机（基于调用方推断）

> 📂 `ConfigBridge::instance_` 由平台子类创建并 `obfuscation_map(...)` 灌入。zygisk 路径下，`IPCBridge::FetchObfuscationMap` 从 daemon Binder 拉取混淆表，native context 子类据此 `new` 具体子类、`obfuscation_map(map)` 设值、赋给 `instance_`，先于 `InitHooks`/`RegisterNativeMethods` 完成。本文基于 `ConfigBridge` 公共接口与消费方调用时序推断灌入路径，具体子类实现见各平台 native context。

## 配置数据流

```mermaid
flowchart TD
    A["daemon 持混淆表"] --> B["IPCBridge.FetchObfuscationMap<br/>Binder 拉取（zygisk 路径，推断）"]
    B --> C["native context 子类<br/>new ConfigBridgeImpl"]
    C --> D["obfuscation_map(map) 灌入"]
    D --> E["instance_ 赋值"]
    E --> F["GetInstance 全局可用"]
    F --> G["GetNativeBridgeSignature<br/>查 nativebridge key"]
    F --> H["GetXResourcesClassName<br/>查 XRes key"]
    G --> I["REGISTER_VECTOR_NATIVE_METHODS<br/>拼接混淆类名注册"]
    H --> J["initXResourcesNative<br/>加载混淆 XResources 类"]
    E --> K["ReleaseInstance<br/>与 Context 同构释放"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,G,H,I,J class vec
    class E,K class hot
    class A,F class plain
```

## 相关

- [jni-bridge.md · JNI 桥宏与混淆签名](./jni-bridge) — `GetNativeBridgeSignature` 的宿主
- [resources-hook-cpp.md · 资源 hook JNI 桥](./resources-hook-cpp) — `GetXResourcesClassName` 消费混淆表
- [context.md · 运行时上下文](./context) — `ConfigBridge::instance_` 与 `Context::instance_` 同构
- [ipc-bridge.md · zygisk IPC 桥](../zygisk/ipc-bridge) — `FetchObfuscationMap` 从 daemon 拉取混淆表
- [native-core · native 总览](../native-core)
