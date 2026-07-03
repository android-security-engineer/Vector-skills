# 🔗 bridge 与 stubs 的协作机制

> 📂 `hiddenapi/bridge/src/main/java/hidden/HiddenApiBridge.java`
> 📂 `hiddenapi/stubs/src/main/java/` （桩源码树）
> 📂 `hiddenapi/bridge/build.gradle` · `hiddenapi/stubs/build.gradle`
> 🟦 hiddenapi · bridge + stubs · 运行时桩替换为真实符号

## 两子模块的分工

`hiddenapi` 下分两个 Gradle 子模块，构成 hidden API 访问的完整闭环：

| 子模块 | 角色 | 是否进运行时 | 关键产出 |
| :--- | :--- | :--- | :--- |
| `stubs` | 编译期桩 | **否** | 与 Android 框架同包同名的占位类，方法体全 `throw` |
| `bridge` | 运行时桥 | **是** | 具名转发方法，依赖 stubs 编译 |

```mermaid
flowchart LR
    subgraph 编译期
        A["stubs 模块<br/>(java-library)"] -- "throw Stub!" --> B["bridge 模块<br/>(java-library)"]
        B -.->|"compileOnly(stubs)"| A
    end
    subgraph 运行期
        C["bridge .class<br/>(打包进 Vector)"] --> D["Android 框架<br/>真实 android.*/dalvik.*"]
        D --> E["真实 hidden 实现"]
    end
    B --> C

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class A,B,C,D class vec
    class E class vec
```

## stubs：编译期占位

`stubs` 是一组**与 Android 框架包名/类名完全一致的 Java 源文件**，只用于让 bridge 模块在编译期解析符号。桩的方法体**全部抛异常**，字段为默认值——它们永远不应被执行。

样例（`dalvik/system/BaseDexClassLoader.java` 桩）：

```java
package dalvik.system;
public class BaseDexClassLoader extends ClassLoader {
    public BaseDexClassLoader(ByteBuffer[] dexFiles, ClassLoader parent) {
        throw new RuntimeException("Stub!");
    }
    public BaseDexClassLoader(ByteBuffer[] dexFiles, String librarySearchPath, ClassLoader parent) {
        throw new RuntimeException("Stub!");
    }
    public String getLdLibraryPath() {
        throw new RuntimeException("Stub!");
    }
}
```

样例（`android/os/UserHandle.java` 桩）：

```java
package android.os;
public class UserHandle {
    public UserHandle(int h) { throw new RuntimeException("STUB"); }
    public int getIdentifier() { throw new RuntimeException("STUB"); }
    public static final UserHandle ALL = null;          // 常量桩为 null
}
```

`stubs/build.gradle` 只设 Java 8 兼容，无运行时依赖：

```groovy
plugins { `java-library` }
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}
```

## bridge：编译期依赖、运行时转发

`bridge` 模块用 `compileOnly` 依赖 stubs——**只在编译期需要桩符号，运行时不打包 stubs 的 .class**：

```groovy
// hiddenapi/bridge/build.gradle
plugins { `java-library` }
dependencies { compileOnly(projects.hiddenapi.stubs) }
```

`compileOnly` 的语义恰好契合 stubs 的角色：编译器用 stubs 的类/方法签名做类型检查与符号解析，生成的 bridge .class 只包含对 `android.*`/`dalvik.*` 符号的**引用**，不含 stubs 的字节码。这样 bridge 打包进 Vector 后不会把"会 throw Stub!"的桩类带进 APK。

## 运行时桩替换为真实符号

bridge 的 .class 中，对 `android.os.UserHandle.<init>(I)V`、`dalvik.system.BaseDexClassLoader.<init>` 等符号的引用是**符号引用**（constant pool 引用），在运行时由 VM 按类加载器查找解析：

1. **类查找**：bridge 代码引用 `android.os.UserHandle`，VM 先问 bridge 自身 classloader → bootstrap/系统 classloader → 命中 Android 框架的真实 `android.os.UserHandle`（位于 `framework.jar` / boot classpath）。
2. **桩被遮蔽**：stubs 的 `UserHandle.class` 从不进运行时 classpath（`compileOnly` 不打包），因此桩的 `throw Stub!` 方法体**永不被加载**。
3. **符号绑定**：bridge 的 `new UserHandle(h)` 在运行时绑定到真实 `UserHandle` 的 `<init>` 构造器；`UserHandle.ALL` 绑定到真实静态常量（非 null）。

这就是"运行时桩替换为真实符号"的本质——**不是热替换字节码，而是类路径遮蔽**：编译期用占位类通过编译，运行期占位类缺席、真实类顶上。

## 桩与桥的对应关系

| 桩（stubs） | 桥（bridge）调用 | 运行时真实符号 |
| :--- | :--- | :--- |
| `BaseDexClassLoader.<init>(ByteBuffer[],ClassLoader)` | `ByteBufferDexClassLoader` super 调用 | 真实 `BaseDexClassLoader` |
| `UserHandle.<init>(int)` | `HiddenApiBridge.UserHandle(int)` | 真实 `UserHandle` 构造器 |
| `UserHandle.ALL`（桩为 null） | `HiddenApiBridge.UserHandle_ALL()` | 真实 `UserHandle.ALL` 常量 |
| `Os.ioctlInt(...)` 三重载 | `HiddenApiBridge.Os_ioctlInt(...)` 版本分支 | 真实 `Os.ioctlInt` |
| `ApplicationInfo.overlayPaths` | `ApplicationInfo_overlayPaths(...)` | 真实 `overlayPaths` 字段 |

## 为何不用反射

对 hidden API 的访问有两条路：stubs+bridge 的**编译期类型安全**方案，与 `Method.invoke`/`Field.get` 的**运行时反射**方案。Vector 两者并用：

- bridge（本机制）：编译期类型检查，调用方写普通 Java 语法，零反射开销，但每访问一个 hidden API 都要在 stubs 加桩 + bridge 加方法。
- `XposedHelpers`（反射）：通用、无需为每个 API 写桩，但有 `setAccessible` + 拆箱开销，且字段/方法名拼写错误到运行时才暴露。

bridge 适合"高频、稳定、跨版本签名一致"的 hidden API（如 `addAssetPath`）；反射适合"低频、动态、需按版本选 API"的场景。

## 相关

- [bridge-methods-invoke · 方法调用桥](./bridge-methods-invoke)
- [bridge-methods-field · 字段访问桥](./bridge-methods-field)
- [bridge-methods-new-instance · 对象构造桥](./bridge-methods-new-instance)
- [bridge 子模块总览](../../hiddenapi/bridge)
- [stubs 总览](../../hiddenapi/stubs)
- [XposedHelpers · 反射工具](../legacy/xposed-helpers-extra)
