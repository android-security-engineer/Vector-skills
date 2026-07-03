# 🔁 LegacyDelegateImpl

> 📂 `legacy/src/main/java/org/matrix/vector/legacy/LegacyDelegateImpl.java`
> 🟦 legacy 模块 · 现代↔legacy 翻译边界

## 类职责

`public class LegacyDelegateImpl implements LegacyFrameworkDelegate` 是现代框架（`xposed` 模块）与 legacy Xposed API 之间的**翻译边界实现**。现代侧只认 `LegacyFrameworkDelegate` 契约，不感知 `XposedBridge`/`XposedInit` 的存在；`LegacyDelegateImpl` 负责把现代生命周期事件（包加载、system_server 加载、hook 执行）翻译成 legacy 的 `XC_LoadPackage.callAll`、`XposedInit.loadModules`、`LegacyApiSupport` 调用。

这个边界让现代 hook 引擎（`VectorChain`）能在不依赖 legacy 类的前提下，复用整套传统 Xposed 模块生态。

## 接口契约（LegacyFrameworkDelegate）

```kotlin
interface LegacyFrameworkDelegate {
    fun loadModules(activityThread: Any)
    fun onPackageLoaded(info: LegacyPackageInfo)
    fun onSystemServerLoaded(classLoader: ClassLoader)
    fun processLegacyHook(
        executable: Executable,
        thisObject: Any?,
        args: Array<Any?>,
        legacyHooks: Array<Any?>,
        invokeOriginal: OriginalInvoker,
    ): Any?
    val isResourceHookingDisabled: Boolean
    fun setPackageNameForResDir(packageName: String, resDir: String?)
    fun hasLegacyModule(packageName: String): Boolean
}
```

实现逐一映射到 legacy 内部 API。

## 方法实现

### loadModules

```java
@Override
public void loadModules(Object activityThread) {
    XposedInit.loadModules((android.app.ActivityThread) activityThread);
}
```

把 `Object` 强转回 `ActivityThread`（现代侧用 `Any` 是为了不引入 Android 类型耦合），委托 `XposedInit.loadModules` 加载现代模块并清理 `mPackages` 缓存。

### onPackageLoaded

```java
@Override
public void onPackageLoaded(LegacyPackageInfo info) {
    XC_LoadPackage.LoadPackageParam lpparam = new XC_LoadPackage.LoadPackageParam(XposedBridge.sLoadedPackageCallbacks);
    lpparam.packageName = info.getPackageName();
    lpparam.processName = info.getProcessName();
    lpparam.classLoader = info.getClassLoader();
    lpparam.appInfo = info.getAppInfo();
    lpparam.isFirstApplication = info.isFirstApplication();

    if (info.isFirstApplication() && hasLegacyModule(info.getPackageName())) {
        hookNewXSP(lpparam);
    }
    XC_LoadPackage.callAll(lpparam);
}
```

把 `LegacyPackageInfo`（现代 DTO）翻译成 legacy 的 `LoadPackageParam`，并在**首次加载且是 legacy 模块**时调 `hookNewXSP` 注入 `XSharedPreferences` 的新路径 hook，最后 `callAll` 触发所有 `IXposedHookLoadPackage` 模块。

### onSystemServerLoaded

```java
@Override
public void onSystemServerLoaded(ClassLoader classLoader) {
    XposedInit.loadedPackagesInProcess.add("android");
    XC_LoadPackage.LoadPackageParam lpparam = ...;  // packageName="android", processName="android"
    lpparam.classLoader = classLoader;
    lpparam.isFirstApplication = true;
    XC_LoadPackage.callAll(lpparam);
}
```

兼容 rovo89 约定：system_server 的 packageName 与 processName 都设为 `"android"`，复用同一套 `sLoadedPackageCallbacks`。

### processLegacyHook（核心翻译）

```java
@Override
public Object processLegacyHook(Executable executable, Object thisObject, Object[] args,
        Object[] legacyHooks, OriginalInvoker invokeOriginal) {
    VectorLegacyCallback<Executable> callback = new VectorLegacyCallback<>(executable, thisObject, args);
    XposedBridge.LegacyApiSupport<Executable> legacy = new XposedBridge.LegacyApiSupport<>(callback, legacyHooks);

    legacy.handleBefore();                       // 正序 before
    if (!callback.isSkipped()) {                 // 未短路 → 调原方法
        try {
            Object result = invokeOriginal.invoke();
            callback.setResult(result);
        } catch (Throwable t) {
            callback.setThrowable(t);
        }
    }
    legacy.handleAfter();                        // 逆序 after
    if (callback.getThrowable() != null) {
        sneakyThrow(callback.getThrowable());    // 绕过 checked 异常检查抛出
    }
    return callback.getResult();
}
```

这是现代 `VectorChain` 的 terminal 节点：当链走到尽头且有 legacy hook 时，`VectorNativeHooker` 调用本方法。流程是经典的 before→原方法→after 三段式，但通过 `VectorLegacyCallback` 作为现代/legacy 之间的状态载体，`LegacyApiSupport.syncronizeApi` 负责双向同步 `method/thisObject/args/result/throwable/returnEarly`。`sneakyThrow` 用泛型骗过编译器的 checked 异常检查，把任意 `Throwable` 抛回调用方。

### 其余方法

```java
public boolean isResourceHookingDisabled()   // return XposedInit.disableResources
public boolean hasLegacyModule(String pkg)   // return XposedInit.getLoadedModules().containsKey(pkg)
public void setPackageNameForResDir(String p, String r)  // ResourceProxy.set(p, r)
```

## hookNewXSP：新 prefs 路径注入

```java
private void hookNewXSP(XC_LoadPackage.LoadPackageParam lpparam)
```

对声明 `xposedminversion>92` 或 `xposedsharedprefs` 的模块，hook 两个 `ContextImpl` 方法，让 `XSharedPreferences` 能读到安全区路径：

| 目标方法 | hook 类型 | 行为 |
| :--- | :--- | :--- |
| `ContextImpl.checkMode(int)` | `XC_MethodHook` after | 若 `MODE_WORLD_READABLE`（位 0）被设，吞掉 `SecurityException`（`setThrowable(null)`） |
| `ContextImpl.getPreferencesDir` | `XC_MethodReplacement` | 替换返回 `VectorServiceClient.getPrefsPath(packageName)` |

这让旧模块无需改代码即可在 Vector 受控环境下用 `MODE_WORLD_READABLE` 打开偏好。

## ResourceProxy 与 verifier 规避

```java
private static class ResourceProxy {
    static void set(String p, String r) {
        XResources.setPackageNameForResDir(p, r);
    }
}
```

`setPackageNameForResDir` 不直接调 `XResources.setPackageNameForResDir`，而是经独立静态内部类 `ResourceProxy` 转发。注释说明：这是为了让 verifier 在 `LegacyDelegateImpl` 类**首次加载**时不立刻校验 `XResources`——`ResourceProxy.set` 只在首次被调用时才被 verifier 检查，此时 `XResources` 已可用。

## 翻译边界架构

```mermaid
flowchart LR
    subgraph Modern["xposed 模块（现代）"]
        VB[VectorBootstrap.delegate]
        VNH[VectorNativeHooker]
        VC[VectorChain]
    end
    subgraph Legacy["legacy 模块"]
        LDI[LegacyDelegateImpl]
        XInit[XposedInit]
        XB[XposedBridge]
        LAS[LegacyApiSupport]
    end

    VB -->|"init(LegacyDelegateImpl)"| LDI
    VNH -->|"processLegacyHook"| LDI
    VC -->|"terminal 节点"| LDI
    LDI --> XInit
    LDI --> XB
    LDI --> LAS
    LDI -->|"onPackageLoaded"| XB

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class VB,VNH,VC class vec
    class LDI class hot
    class XInit,XB,LAS class plain
```

## 相关

- [VectorBootstrap · DI 引导](../xposed/vector-bootstrap) — `delegate` 持有本类实例
- [VectorNativeHooker · JNI trampoline](../xposed/vector-native-hooker) — 调 `processLegacyHook`
- [XposedBridge · 中枢门面](./xposed-bridge) — `LegacyApiSupport` 实现
- [XposedInit · 模块加载](./xposed-init) — `loadModules`/`loadedModules`
- [XSharedPreferences · 跨进程偏好](./xshared-preferences) — `hookNewXSP` 的受益者
