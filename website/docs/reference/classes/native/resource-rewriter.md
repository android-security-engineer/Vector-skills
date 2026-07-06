# 🧩 Resource Rewriter（C++）

> 📂 [`native/src/jni/resources_hook.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/jni/resources_hook.cpp)（`rewriteXmlReferencesNative`）
> 🟦 native 模块 · 二进制 XML 资源引用重写引擎

## 类职责

`ResourcesHook.rewriteXmlReferencesNative`（`namespace vector::native::jni`）是 Vector 资源 hook 的**核心重写路径**。它接收 Java 侧传来的原生 `android::ResXMLParser` 指针，遍历二进制 XML 的每个 chunk，对属于应用包（`0x7f...`）的属性名 ID 与属性值引用，回调 Java `XResources.translateAttrId`/`translateResId` 拿到替换 ID，然后**直接改写 parser 内存中的 `mResIds` 表与 `attr->typedValue.data`**——零拷贝、原地替换，让框架资源重定向到模块替换资源。

它与 `resources-hook-cpp.md` 同源（`resources_hook.cpp`），但后者聚焦 JNI 注册表整体，本文聚焦**重写循环的数据流与改写语义**。

## 方法签名

```cpp
VECTOR_DEF_NATIVE_METHOD(void, ResourcesHook, rewriteXmlReferencesNative,
                         jlong parserPtr, jobject origRes, jobject repRes);
```

| 参数 | 语义 |
| :--- | :--- |
| `parserPtr` | Java 侧 `XResources` 持有的原生 `android::ResXMLParser*`，按 `jlong` 传递 |
| `origRes` | 原 `XResources` 实例，供 `translateResId/AttrId` 回调时定位翻译上下文 |
| `repRes` | 替换 `Resources` 实例，决定资源重定向目标 |

`parserPtr` 是裸指针跨 JNI 边界——危险但必要，因 parser 是 ART 内部对象，Java 无法直接持有。

## 重写循环

```cpp
auto parser = (android::ResXMLParser *)parserPtr;
const android::ResXMLTree &mTree = parser->mTree;
auto mResIds = (uint32_t *)mTree.mResIds;

do {
    switch (ResXMLParser_next(parser)) {        // 调 libandroidfw 的 next()
    case android::ResXMLParser::START_TAG:
        tag = (android::ResXMLTree_attrExt *)parser->mCurExt;
        attrCount = tag->attributeCount;
        for (int idx = 0; idx < attrCount; idx++) {
            auto attr = (android::ResXMLTree_attribute *)
                (((const uint8_t *)tag) + tag->attributeStart + tag->attributeSize * idx);
            // ... 属性名 ID 与属性值两条改写路径
        }
        continue;
    case android::ResXMLParser::END_DOCUMENT:
    case android::ResXMLParser::BAD_DOCUMENT:
        goto leave;
    default: continue;
    }
} while (true);

leave:
    ResXMLParser_restart(parser);   // 复位 parser 供后续正常解析
}
```

每个 `START_TAG` 从 `mCurExt` 取 `attrExt`，按 `attributeStart + attributeSize*idx` 步进逐属性定位 `ResXMLTree_attribute`。`next()` 是缓存的 `libandroidfw` 函数指针（见 [arsc-parser](./arsc-parser)）。

## 属性名 ID 改写

```cpp
int32_t attrNameID = ResXMLParser_getAttributeNameID(parser, idx);
if (attrNameID >= 0 && (size_t)attrNameID < mTree.mNumResIds &&
    mResIds[attrNameID] >= 0x7f000000) {            // 仅应用包属性
    auto attrName = mTree.mStrings.stringAt(attrNameID);
    jstring attrNameStr = env->NewString((const jchar *)attrName.data_, attrName.length_);
    if (env->ExceptionCheck()) goto leave;
    jint attrResID = env->CallStaticIntMethod(
        classXResources, methodXResourcesTranslateAttrId, attrNameStr, origRes);
    env->DeleteLocalRef(attrNameStr);
    if (env->ExceptionCheck()) goto leave;
    mResIds[attrNameID] = attrResID;                // 原地改写资源 ID 表
}
```

`getAttributeNameID` 返回属性名在字符串池的索引，再 `stringAt` 取出名字（如 `textColor`）。`mResIds[attrNameID]` 是该属性名对应的资源 ID；只对 `>= 0x7f000000`（应用包）的才回调 Java 翻译，避免动系统属性。翻译结果直接写回 `mResIds` 表。

## 属性值引用改写

```cpp
if (attr->typedValue.dataType != android::Res_value::TYPE_REFERENCE) continue;
jint oldValue = attr->typedValue.data;
if (oldValue < 0x7f000000) continue;               // 仅应用包引用

jint newValue = env->CallStaticIntMethod(
    classXResources, methodXResourcesTranslateResId, oldValue, origRes, repRes);
if (env->ExceptionCheck()) goto leave;
if (newValue != oldValue) attr->typedValue.data = newValue;  // 原地改写值
```

只处理 `TYPE_REFERENCE`（`@xxx` 引用）。Java `translateResId` 结合 `origRes`（原资源上下文）与 `repRes`（替换上下文）决定新 ID；若返回值变了，直接覆写 `attr->typedValue.data`，parser 后续读到的就是替换后的资源。

## 异常安全

每个 JNI 调用后都 `env->ExceptionCheck()`，命中即 `goto leave`——统一出口先 `restart(parser)` 复位再返回，防止 parser 停在半截状态污染后续解析。

## 改写数据流

```mermaid
flowchart TD
    A["Java: rewriteXmlReferencesNative(parserPtr, orig, rep)"] --> B["ResXMLParser_next 遍历"]
    B --> C{START_TAG?}
    C -- 是 --> D["取 attrExt.mCurExt<br/>attributeCount 属性"]
    D --> E["getAttributeNameID(idx)"]
    E --> F{"mResIds[id] >= 0x7f?"}
    F -- 是 --> G["stringAt 取名<br/>回调 translateAttrId(orig)"]
    G --> H["写回 mResIds[id]"]
    F -- 否 --> I
    H --> I{"typedValue TYPE_REFERENCE<br/>且 data >= 0x7f?"}
    I -- 是 --> J["回调 translateResId(old, orig, rep)"]
    J --> K{"newValue != oldValue?"}
    K -- 是 --> L["写回 attr.typedValue.data"]
    K -- 否 --> M["下一属性"]
    L --> M
    I -- 否 --> M
    M --> D
    C -- END/BAD --> N["restart(parser) 复位"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class D,E,G,H,J,L class vec
    class C,F,I,K class hot
    class A,B,M,N class plain
```

## 相关

- [arsc-parser.md · ARSC 结构与符号桩](./arsc-parser) — `ResXMLParser`/`Res_value`/`PrepareSymbols` 的结构定义
- [resources-hook-cpp.md · 资源 hook JNI 桥](./resources-hook-cpp) — `initXResourcesNative`/`buildDummyClassLoader` 等同文件其他方法
- [context.md · 运行时上下文](./context) — `InitHooks` 注册 `RegisterResourcesHook`
- [native-core · native 总览](../native-core)
