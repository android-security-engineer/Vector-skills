# 📦 VectorModuleClassLoader

> 📂 `xposed/src/main/kotlin/org/matrix/vector/impl/utils/VectorModuleClassLoader.kt`
> 🟩 xposed 模块 · 内存 DEX 隔离类加载器

## 类职责

`class VectorModuleClassLoader : ByteBufferDexClassLoader` 是模块执行的**隔离类加载器**。它通过内存映射 `SharedMemory` 加载模块 DEX（不落盘），自定义 `loadClass`/`findLibrary`/`findResource`，确保模块代码与框架、宿主进程隔离，同时让模块的 native 库与资源能被正确解析。

内存加载有双重收益：安全（模块 DEX 不写磁盘，难以被静态扫描）与性能（避免解压到磁盘的 IO）。

## 构造与工厂

```kotlin
companion object {
    @JvmStatic
    fun loadApk(
        apk: String,
        dexes: List<SharedMemory>,
        librarySearchPath: String,
        parent: ClassLoader?,
    ): ClassLoader
}
```

`loadApk` 是唯一对外入口，流程：

1. `dexes.parallelStream().map { dex.mapReadOnly() }` 把每个 `SharedMemory` 映射为只读 `ByteBuffer`，映射失败返回 null 并 log
2. 过滤 null 后转 `Array<ByteBuffer>`
3. 按 `Build.VERSION.SDK_INT` 选构造器：Q+ 走带 `librarySearchPath` 的构造器，以下走另一构造器
4. **DEX buffer 全部 unmap**（`SharedMemory.unmap`）并关闭原 `SharedMemory`，因为 `ByteBufferDexClassLoader` 已拷贝/接管数据
5. 返回 classloader

```kotlin
// Q+ 构造器
private constructor(dexBuffers: Array<ByteBuffer>, librarySearchPath: String?, parent: ClassLoader?, apkPath: String)
// Q 以下构造器
private constructor(dexBuffers: Array<ByteBuffer>, parent: ClassLoader?, apkPath: String, librarySearchPath: String?)
```

两个私有构造器都调 `initNativeDirs(librarySearchPath)` 初始化 native 库搜索目录。

## loadClass 双亲委派变体

```kotlin
@Throws(ClassNotFoundException::class)
override fun loadClass(name: String, resolve: Boolean): Class<*> {
    findLoadedClass(name)?.let { return it }              // 1. 已加载直接返回
    try {
        return Any::class.java.classLoader!!.loadClass(name)  // 2. 先问 bootstrap
    } catch (ignored: ClassNotFoundException) {}
    var fromSuper: ClassNotFoundException? = null
    try {
        return findClass(name)                           // 3. 自己找（模块 DEX）
    } catch (ex: ClassNotFoundException) {
        fromSuper = ex
    }
    try {
        return parent?.loadClass(name) ?: throw fromSuper  // 4. parent 找
    } catch (cnfe: ClassNotFoundException) {
        throw fromSuper                                  // 5. 抛出自己 findClass 的异常
    }
}
```

关键差异：**第 2 步先问 bootstrap（`Any::class.java.classLoader`）而非 parent**。这保证 `java.lang.String` 等核心类一定来自系统，模块 APK 里即使打包了同名类也不会被误用（这正是 `XposedInit.loadModule` 校验 "API 类未编进模块 APK" 的运行时保障）。

## findLibrary：native 库解析

```kotlin
override fun findLibrary(libraryName: String): String?
```

把 `libraryName` 经 `System.mapLibraryName` 转成文件名（如 `libfoo.so`），在 `nativeLibraryDirs` 中搜索：

| 目录形态 | 解析方式 |
| :--- | :--- |
| 含 `!/`（ZIP 内） | 打开 `JarFile`，找 `<entry>/libfoo.so`，仅接受 `ZipEntry.STORED`（未压缩，可 mmap），返回 `apk!/entry` 路径 |
| 普通目录 | `Os.open(path, O_RDONLY)` 试开，成功即返回路径（用 open 而非 File 检查可绕过权限伪存在） |
| 都不中 | 返回 null |

`nativeLibraryDirs` 由 `librarySearchPath`（来自 `XposedInit` 拼的 `apk!/lib/<abi>` 列表）加上 `SYSTEM_NATIVE_LIBRARY_DIRS`（`java.library.path`）组成。

## findResource：资源解析

```kotlin
override fun findResource(name: String): URL?
override fun findResources(name: String): Enumeration<URL>
```

用 `VectorURLStreamHandler(apkPath)` 为 APK 内资源构造 URL，`getEntryUrlOrNull` 在打开失败时返回 null。`findResources` 把单个结果包成单元素 `Enumeration`。

## 关键字段与常量

| 字段 | 含义 |
| :--- | :--- |
| `apkPath` | 模块 APK 路径，用于资源 URL 与 toString |
| `nativeLibraryDirs` | native 库搜索目录列表（模块 ABI 目录 + 系统目录） |
| `SYSTEM_NATIVE_LIBRARY_DIRS` | `java.library.path` 拆分得到的系统 native 目录 |
| `ZIP_SEPARATOR` | `"!/"`，ZIP 内路径分隔符 |

`toString` 返回 `VectorModuleClassLoader[module=<apk>, <super>]`，便于调试时识别加载器归属。

## 类关系

```mermaid
classDiagram
    class ByteBufferDexClassLoader {
        <<Android 框架>>
    }
    class VectorModuleClassLoader {
        -apkPath: String
        -nativeLibraryDirs: MutableList<File>
        +loadClass(name, resolve)
        +findLibrary(libName)
        +findResource(name)
        +companion.loadApk(apk, dexes, libPath, parent)
    }
    class SharedMemory {
        <<Android 框架>>
        +mapReadOnly()
    }
    class VectorURLStreamHandler {
        +getEntryUrlOrNull(name)
    }
    class XposedInit {
        +loadModule(name, apk, file)
    }

    VectorModuleClassLoader --|> ByteBufferDexClassLoader
    VectorModuleClassLoader ..> SharedMemory : mapReadOnly 映射 DEX
    VectorModuleClassLoader ..> VectorURLStreamHandler : 资源 URL
    XposedInit ..> VectorModuleClassLoader : loadApk 构造

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class VectorModuleClassLoader,VectorURLStreamHandler class vec
    class XposedInit class hot
    class ByteBufferDexClassLoader,SharedMemory class plain
```

## 相关

- [XposedInit · 模块加载](../legacy/xposed-init) — `loadModule` 调 `loadApk` 构造本类
- [VectorBootstrap · DI 引导](./vector-bootstrap) — 模块在隔离 CL 内运行
- [native-core · Context.LoadDex](../native-core) — native 侧 DEX 加载机制
