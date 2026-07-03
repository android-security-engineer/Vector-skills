# 🧩 ARSC Parser（C++）

> 📂 `native/include/framework/android_types.h`
> 📂 `native/src/jni/resources_hook.cpp`（`PrepareSymbols`）
> 🟦 native 模块 · Android 二进制资源表结构与符号桩

## 类职责

`namespace android`（在 `android_types.h` 中定义）是 AOSP `androidfw` 资源类型的**内存布局镜像**。它按 AOSP `ResourceTypes.h` 逐字段复刻 `ResStringPool`、`ResXMLTree`、`Res_value` 等 C++ 结构体，让 Vector 能在 native 层**零拷贝解析二进制 XML/资源表 chunk**——直接把 `ResXMLParser` 指针当原生对象遍历，取出包名/资源 ID/属性值。

这些结构体本身不解析数据，而是提供与 ART 内存中 `libandroidfw.so` 对象**二进制兼容**的视图；真正的 chunk 遍历由 `libandroidfw` 内部函数完成，Vector 通过符号查找拿到函数指针后调用。

## Chunk 类型枚举

```cpp
enum {
    RES_NULL_TYPE = 0x0000,
    RES_STRING_POOL_TYPE = 0x0001,   // 字符串池
    RES_TABLE_TYPE = 0x0002,          // 资源表
    RES_XML_TYPE = 0x0003,            // 二进制 XML
    RES_XML_START_ELEMENT_TYPE = 0x0102,
    RES_XML_END_ELEMENT_TYPE = 0x0103,
    RES_XML_RESOURCE_MAP_TYPE = 0x0180, // 字符串→资源 ID 映射
    RES_TABLE_PACKAGE_TYPE = 0x0200,    // 包（含包名）
    RES_TABLE_TYPE_TYPE = 0x0201,
    RES_TABLE_TYPE_SPEC_TYPE = 0x0202,
};
```

`RES_TABLE_PACKAGE_TYPE` chunk 内含包名；`RES_XML_RESOURCE_MAP_TYPE` 把字符串池索引映射回资源 ID，资源重写就靠它定位 `0x7f...` 应用包属性。

## ResStringPool

```cpp
class ResStringPool {
public:
    status_t mError;
    const void *mHeader;
    const uint32_t *mEntries;     // 偏移表
    const void *mStrings;          // 字符串数据
    uint32_t mStringPoolSize;

    using stringAtRet = expected<StringPiece16, NullOrIOError>;

    inline static auto stringAtS_ = ("_ZNK7android13ResStringPool8stringAtEjPj"_sym |
                                     "_ZNK7android13ResStringPool8stringAtEmPm"_sym)
                                        .as<stringAtRet (ResStringPool::*)(size_t)>;
    inline static auto stringAt_ = ("_ZNK7android13ResStringPool8stringAtEj"_sym |
                                    "_ZNK7android13ResStringPool8stringAtEm"_sym)
                                       .as<const char16_t *(ResStringPool::*)(size_t, size_t *)>;

    StringPiece16 stringAt(size_t idx) const;
    static bool setup(const lsplant::HookHandler &handler);
};
```

`stringAt_`/`stringAtS_` 是 LSPlant 符号字面量（`_sym`），覆盖 32/64 位两套 mangled 名。`setup()` 在初始化时把这两个符号解析为成员函数指针——之后 `stringAt(idx)` 直接以成员指针调用 ART 内存中的真实函数，取 `char16_t*` 字符串。`expected`/`unexpected` 是 AOSP 风格的错误载体。

## ResXMLTree / ResXMLParser

```cpp
class ResXMLParser {
public:
    enum event_code_t { BAD_DOCUMENT=-1, START_DOCUMENT=0, END_DOCUMENT=1,
                        START_TAG, END_TAG, TEXT, START_NAMESPACE, END_NAMESPACE };
    const ResXMLTree &mTree;
    event_code_t mEventCode;
    const ResXMLTree_node *mCurNode;
    const void *mCurExt;   // 指向当前 chunk 的扩展数据（如 attrExt）
};

class ResXMLTree : public ResXMLParser {
public:
    ResStringPool mStrings;        // 字符串池
    const uint32_t *mResIds;       // 资源 ID 映射表
    size_t mNumResIds;
    const ResXMLTree_node *mRootNode;
};
```

`mCurExt` 在 `START_TAG` 时指向 `ResXMLTree_attrExt`，含 `attributeCount`/`attributeStart`/`attributeSize`——据此算出每个 `ResXMLTree_attribute` 的偏移，逐属性读 `typedValue.data`。

## Res_value 数据类型

```cpp
struct Res_value {
    uint8_t dataType;
    data_type data;
    enum : uint8_t {
        TYPE_REFERENCE = 0x01,   // 引用另一资源（@color/...）
        TYPE_STRING   = 0x03,
        TYPE_INT_DEC  = 0x10,
        TYPE_INT_COLOR_ARGB8 = 0x1c,
        // ...
    };
};
```

资源重写只关心 `TYPE_REFERENCE` 且 `data >= 0x7f000000`（应用包资源）的属性——只有这些才回调 Java `translateResId` 做替换。

## 符号桩 PrepareSymbols

```cpp
static bool PrepareSymbols() {
    ElfImage fw(kFrameworkLibraryName);   // libandroidfw.so
    ResXMLParser_next             = fw.getSymbAddress<TYPE_NEXT>("_ZN7android12ResXMLParser4nextEv");
    ResXMLParser_restart          = fw.getSymbAddress<TYPE_RESTART>("_ZN7android12ResXMLParser7restartEv");
    ResXMLParser_getAttributeNameID = fw.getSymbAddress<TYPE_GET_ATTR_NAME_ID>(
        LP_SELECT("_ZNK7android12ResXMLParser18getAttributeNameIDEj",
                  "_ZNK7android12ResXMLParser18getAttributeNameIDEm"));
    return android::ResStringPool::setup(lsplant::InitInfo{
        .art_symbol_resolver = [&](auto s) { return fw.getSymbAddress<>(s); }});
}
```

四个 native 函数指针在 `initXResourcesNative` 时一次性从 `libandroidfw.so` 解析并缓存。`LP_SELECT` 按 32/64 位选 mangled 名（`j` vs `m` 后缀）。`ResStringPool::setup` 复用同一 `art_symbol_resolver` 闭包解析 `stringAt` 两套符号。

## 解析流程

```mermaid
flowchart TD
    A["initXResourcesNative"] --> B["PrepareSymbols<br/>ElfImage 解析 libandroidfw"]
    B --> C["缓存 next/restart/getAttributeNameID/stringAt"]
    C --> D["rewriteXmlReferencesNative<br/>传入 ResXMLParser*"]
    D --> E["ResXMLParser_next 遍历 chunk"]
    E --> F{START_TAG?}
    F -- 是 --> G["读 attrExt.attributeCount"]
    G --> H["逐属性 getAttributeNameID"]
    H --> I["mResIds[attrNameID] >= 0x7f?"]
    I -- 是 --> J["stringAt 取属性名<br/>回调 translateAttrId"]
    J --> K["改写 mResIds 表"]
    K --> L["typedValue.data >= 0x7f?<br/>回调 translateResId"]
    L --> M["改写 attr->typedValue.data"]
    M --> E
    F -- END/BAD --> N["ResXMLParser_restart 复位"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,E,G,H,J,K,L,M class vec
    class I,F class hot
    class A,N class plain
```

## 相关

- [resource-rewriter.md · XML 引用重写](./resource-rewriter) — 用本结构的 `rewriteXmlReferencesNative` 流程
- [resources-hook-cpp.md · 资源 hook JNI 桥](./resources-hook-cpp) — `PrepareSymbols` 所属 JNI 注册表
- [symbol-resolver.md · ElfImage 符号查找](./symbol-resolver) — `getSymbAddress` 的底层实现
- [native-core · native 总览](../native-core)
