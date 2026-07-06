# 🎨 resources_hook.cpp

> 📂 [`native/src/jni/resources_hook.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/jni/resources_hook.cpp)
> 🟦 native 模块 · 二进制 XML 突变与资源 hook

## 文件职责

本文件实现 `ResourcesHook` 类的 JNI 方法，负责 native 侧的资源 hook：动态移除 Java 类的 `final` 修饰符、构造含 dummy 父类的内存 DEX classloader、解析 `libandroidfw.so` 的私有符号、以及在二进制 XML 解析过程中**直接改写内存中的资源 ID** 实现资源重定向。对应 Kotlin 侧的 `ResourcesHook` nativebridge 声明。

## 关键函数指针

```cpp
using TYPE_GET_ATTR_NAME_ID = int32_t (*)(void *, int);      // ResXMLParser::getAttributeNameID
using TYPE_STRING_AT        = char16_t *(*)(const void *, int32_t, size_t *);  // ResStringPool::stringAt
using TYPE_RESTART          = void (*)(void *);              // ResXMLParser::restart
using TYPE_NEXT             = int32_t (*)(void *);           // ResXMLParser::next

static TYPE_NEXT ResXMLParser_next = nullptr;
static TYPE_RESTART ResXMLParser_restart = nullptr;
static TYPE_GET_ATTR_NAME_ID ResXMLParser_getAttributeNameID = nullptr;
```

这些指向 `libandroidfw.so` 中 `android::ResXMLParser` 的私有 C++ 方法，由 `PrepareSymbols` 经 `ElfImage` 解析 mangled 名得到。`ResStringPool::setup` 也在此初始化。

## PrepareSymbols：符号解析

```cpp
static bool PrepareSymbols() {
    ElfImage fw(kFrameworkLibraryName);
    if (!fw.IsValid()) return false;
    ResXMLParser_next = fw.getSymbAddress<TYPE_NEXT>("_ZN7android12ResXMLParser4nextEv");
    ResXMLParser_restart = fw.getSymbAddress<TYPE_RESTART>("_ZN7android12ResXMLParser7restartEv");
    ResXMLParser_getAttributeNameID = fw.getSymbAddress<TYPE_GET_ATTR_NAME_ID>(
        LP_SELECT("_ZNK7android12ResXMLParser18getAttributeNameIDEj",   // 32 位
                  "_ZNK7android12ResXMLParser18getAttributeNameIDEm")); // 64 位
    return android::ResStringPool::setup({.art_symbol_resolver = [&](auto s) { return fw.getSymbAddress<>(s); }});
}
```

`getAttributeNameID` 用 `LP_SELECT` 按 32/64 位选不同 mangled 名（`j` vs `m` 后缀，对应 `unsigned int` vs `unsigned long`）。`ResStringPool::setup` 用同一个 `ElfImage` 作为符号解析器回调，初始化 `ResStringPool` 依赖的 ART 内部函数。

## initXResourcesNative：初始化

```cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, ResourcesHook, initXResourcesNative)
```

1. `GetXResourcesClassName()` 经 `ConfigBridge.obfuscation_map()` 把 `"android.content.res.XRes"` 映射到混淆后的类名前缀，拼出完整 `XResources` 类名（混淆感知）
2. `Context::FindClassFromCurrentLoader` 加载该类，`NewGlobalRef` 缓存为 `classXResources`
3. 动态拼 JNI 签名（`L<混淆名>;`），`GetStaticMethodID` 取 `translateResId` 与 `translateAttrId`
4. `PrepareSymbols()` 解析 native 符号
5. 任一步失败返回 `JNI_FALSE`，`XposedInit.hookResources` 据此设 `disableResources=true`

`GetXResourcesClassName` 用 `static` 局部变量保证只查一次混淆表。

## makeInheritable：去 final

```cpp
VECTOR_DEF_NATIVE_METHOD(jboolean, ResourcesHook, makeInheritable, jclass target_class)
```

调 `lsplant::MakeClassInheritable(env, target_class)` 在运行时移除 Java 类的 `final` 修饰符，让框架能继承 `Resources`/`TypedArray` 等原本 final 的类以注入 `XResources`/`XTypedArray` 子类。

## buildDummyClassLoader：内存 DEX 构造

```cpp
VECTOR_DEF_NATIVE_METHOD(jobject, ResourcesHook, buildDummyClassLoader,
    jobject parent, jstring resource_super_class, jstring typed_array_super_class)
```

用 `startop::dex::DexBuilder` 在内存中**动态生成 DEX**：

1. 创建类 `xposed/dummy/XResourcesSuperClass`，`setSuperClass` 设为调用方传入的 `Resources` 子类名
2. 创建类 `xposed/dummy/XTypedArraySuperClass`，`setSuperClass` 设为 `TypedArray` 子类名
3. `dex_file.CreateImage()` 得 `slicer::MemView`
4. 包成 `ByteBuffer`，用 `InMemoryDexClassLoader(ByteBuffer, parent)` 构造返回

这个 dummy classloader 让 `XResources` 能"继承"一个运行时生成的中间父类，绕过 Java 对 final 类的限制链。`XposedBridge.initXResources` 把自身 classloader 的 `parent` 字段替换为它。

## rewriteXmlReferencesNative：二进制 XML 突变（核心）

```cpp
VECTOR_DEF_NATIVE_METHOD(void, ResourcesHook, rewriteXmlReferencesNative,
    jlong parserPtr, jobject origRes, jobject repRes)
```

`parserPtr` 是 native `android::ResXMLParser*` 的裸指针（Java 侧以 `long` 传递）。核心循环：

```cpp
auto parser = (android::ResXMLParser *)parserPtr;
const android::ResXMLTree &mTree = parser->mTree;
auto mResIds = (uint32_t *)mTree.mResIds;
do {
    switch (ResXMLParser_next(parser)) {
    case START_TAG:
        tag = (android::ResXMLTree_attrExt *)parser->mCurExt;
        attrCount = tag->attributeCount;
        for (int idx = 0; idx < attrCount; idx++) {
            auto attr = (android::ResXMLTree_attribute *)(((const uint8_t *)tag) + tag->attributeStart + tag->attributeSize * idx);
            // (1) 属性名 ID 翻译
            int32_t attrNameID = ResXMLParser_getAttributeNameID(parser, idx);
            if (attrNameID >= 0 && (size_t)attrNameID < mTree.mNumResIds && mResIds[attrNameID] >= 0x7f000000) {
                auto attrName = mTree.mStrings.stringAt(attrNameID);
                jint attrResID = env->CallStaticIntMethod(classXResources, methodXResourcesTranslateAttrId, attrNameStr, origRes);
                mResIds[attrNameID] = attrResID;   // 直接改写内存
            }
            // (2) 属性值引用翻译
            if (attr->typedValue.dataType != TYPE_REFERENCE) continue;
            jint oldValue = attr->typedValue.data;
            if (oldValue < 0x7f000000) continue;
            jint newValue = env->CallStaticIntMethod(classXResources, methodXResourcesTranslateResId, oldValue, origRes, repRes);
            if (newValue != oldValue) attr->typedValue.data = newValue;  // 直接改写内存
        }
        continue;
    case END_DOCUMENT:
    case BAD_DOCUMENT:
        goto leave;
    default:
        continue;
    }
} while (true);
leave:
    ResXMLParser_restart(parser);   // 复位解析器供后续重读
```

关键点：

| 阶段 | 处理 |
| :--- | :--- |
| 遍历 token | 用 native `ResXMLParser_next` 推进二进制 XML 解析 |
| 属性名 ID | 仅处理 `>=0x7f000000`（应用包资源 ID），回调 Java `translateAttrId` 翻译后直接写 `mResIds[attrNameID]` |
| 属性值引用 | 仅 `TYPE_REFERENCE` 且 `>=0x7f`，回调 `translateResId` 翻译后写 `attr->typedValue.data` |
| 异常检查 | 每次 JNI 调用后 `ExceptionCheck`，有异常 `goto leave` |
| 退出 | `ResXMLParser_restart` 复位解析器，让框架能重新读取已被改写的 XML |

这是"原地突变"——不重新生成 XML 文件，而是直接改写 ART 内存中的解析器状态与资源 ID 表，零拷贝、对调用方透明。

## 注册表

```cpp
static JNINativeMethod gMethods[] = {
    VECTOR_NATIVE_METHOD(ResourcesHook, initXResourcesNative, "()Z"),
    VECTOR_NATIVE_METHOD(ResourcesHook, makeInheritable, "(Ljava/lang/Class;)Z"),
    VECTOR_NATIVE_METHOD(ResourcesHook, buildDummyClassLoader, "(Ljava/lang/ClassLoader;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/ClassLoader;"),
    VECTOR_NATIVE_METHOD(ResourcesHook, rewriteXmlReferencesNative, "(JLjava/lang/Object;Landroid/content/res/Resources;)V"),
};
void RegisterResourcesHook(JNIEnv *env) { REGISTER_VECTOR_NATIVE_METHODS(ResourcesHook); }
```

## 资源 hook 装配流

```mermaid
flowchart TD
    A["XposedBridge.initXResources"] --> B["ResourcesHook.makeInheritable<br/>去 final"]
    B --> C["ResourcesHook.buildDummyClassLoader<br/>动态 DEX 生成 dummy 父类"]
    C --> D["替换 classloader.parent"]
    D --> E["XposedInit.hookResources"]
    E --> F["ResourcesHook.initXResourcesNative<br/>加载 XResources + 解析符号"]
    F --> G["hook createResources"]
    G --> H["cloneToXResources → XResources"]
    H --> I["XML 解析时"]
    I --> J["rewriteXmlReferencesNative<br/>原地改写资源 ID"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,F,J class vec
    class G,H,I class hot
    class A,D,E class plain
```

## 相关

- [elf_image.cpp · ELF 解析](./elf-image) — `PrepareSymbols` 依赖它解析 `libandroidfw.so`
- [context.cpp · Context 抽象基类](./context) — `InitHooks` 注册本桥
- [XposedInit · 模块加载](../legacy/xposed-init) — `hookResources`/`initXResources` 调用方
- [legacy-resources · 资源 hook 总览](../legacy-resources)
