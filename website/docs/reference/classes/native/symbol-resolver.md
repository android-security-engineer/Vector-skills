# 🧩 Symbol Resolver（C++）

> 📂 [`native/include/elf/elf_image.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/elf/elf_image.h)
> 📂 [`native/src/elf/elf_image.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/elf/elf_image.cpp)
> 📂 [`native/include/elf/symbol_cache.h`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/include/elf/symbol_cache.h)
> 📂 [`native/src/elf/symbol_cache.cpp`](https://github.com/android-security-engineer/Vector-skills/blob/master/native/src/elf/symbol_cache.cpp)
> 🟦 native 模块 · ELF 内存解析与符号查找缓存

## 类职责

`class ElfImage`（`namespace vector::native`）在**进程内存中解析已加载的 ELF 共享库**：扫 `/proc/self/maps` 定位库基址，mmap 磁盘文件解析 ELF 头，再用 GNU hash / ELF hash / 线性扫描三种策略按符号名查地址。`class ElfSymbolCache` 是其**线程安全懒加载缓存**，避免反复解析 `libart.so`/`libbinder.so`/linker。

两者共同支撑 Vector 的所有 native 符号查找——资源 hook 找 `libandroidfw.so` 函数、native API 找 linker `do_dlopen`、LSPlant `art_symbol_resolver` 解析 ART 内部符号。

## ElfImage 构造与定位

```cpp
explicit ElfImage(std::string_view lib_name);
~ElfImage();
[[nodiscard]] bool IsValid() const { return base_ != nullptr; }
[[nodiscard]] const std::string &GetPath() const { return path_; }
```

构造流程：`findModuleBase()` 扫 `/proc/self/maps` 找 `lib_name` 的内存基址 `base_` 与加载路径 `path_`；`open(path_)+mmap(PROT_READ,MAP_SHARED)` 把磁盘 ELF 映射进内存 `file_map_`；`parseHeaders` 解析 section headers 定位 `.dynsym`/`.dynstr`/`.gnu.hash`/`.hash`；若 ELF 被 strip 则 `decompressGnuDebugData()` 解压 `.gnu_debugdata`（XZ）取 `.symtab`。

> 📂 基址来自 [`/proc/self/maps`](https://github.com/android-security-engineer/Vector-skills/blob/master//proc/self/maps) 扫描，磁盘内容来自 mmap——两者结合才能算出符号运行时绝对地址。

## 符号查找（三策略）

```cpp
template <typename T = void *> requires(std::is_pointer_v<T>)
const T getSymbAddress(std::string_view name) const {
    auto gnu_hash = GnuHash(name);
    auto elf_hash = ElfHash(name);
    auto offset = getSymbOffset(name, gnu_hash, elf_hash);
    if (offset > 0 && base_ != nullptr)
        return reinterpret_cast<T>(reinterpret_cast<uintptr_t>(base_) + offset - bias_);
    return nullptr;
}

template <typename T = void *> requires(std::is_pointer_v<T>)
const T getSymbPrefixFirstAddress(std::string_view prefix) const;
```

`getSymbOffset` 依次尝试：

| 策略 | 函数 | 适用 |
| :--- | :--- | :--- |
| GNU hash | `gnuLookup` | 快速，多数现代库的 `.gnu.hash` |
| ELF hash | `elfLookup` | 旧库的 `.hash` 表 |
| 线性扫描 | `linearLookup` | `.symtab` 全表，慢但能找 dynsym 没有的符号 |

最终地址 = `base_ + offset - bias_`。`bias_` 是 load bias（ELF 程序头 `p_vaddr` 偏移），懒算。`getSymbPrefixFirstAddress` 按前缀查首个匹配（找 mangled C++ 符号），只走 `.symtab` 线性扫描。

## 哈希函数

```cpp
[[nodiscard]] static constexpr uint32_t ElfHash(std::string_view name);   // 传统 ELF hash
[[nodiscard]] static constexpr uint32_t GnuHash(std::string_view name);   // h*33+p
```

均为 `constexpr`，查找时预算两套 hash 一次传给 `getSymbOffset`，避免每策略重算。

## 关键成员

```cpp
std::string path_;
void *base_ = nullptr;            // 内存基址
void *file_map_ = nullptr;        // 磁盘 mmap
ElfW(Addr) bias_ = 0;
ElfW(Shdr) *dynsym_ = nullptr;
ElfW(Sym) *dynsym_start_ = nullptr;
const char *strtab_start_ = nullptr;
// GNU hash 字段
uint32_t *gnu_bloom_filter_ = nullptr; uint32_t *gnu_bucket_ = nullptr; uint32_t *gnu_chain_ = nullptr;
// strip 库的 .symtab（来自 .gnu_debugdata）
ElfW(Sym) *symtab_start_ = nullptr; const char *symtab_str_start_ = nullptr;
mutable std::map<std::string_view, ElfW(Sym) *> symtabs_;  // 懒建线性查找索引
```

`symtabs_` 是 `mutable`，让 `const` 查找方法能懒建 `.symtab` 全表索引，加速重复线性查找。

## ElfSymbolCache 缓存

```cpp
class ElfSymbolCache {
public:
    static const ElfImage *GetArt();        // libart.so
    static const ElfImage *GetLibBinder();  // libbinder.so
    static const ElfImage *GetLinker();     / / 动态链接器
    static bool ClearCache(const ElfImage *image_to_clear);
    static void ClearCache();
};
```

每个 `Get*()` 用**双重检查锁**：先无锁判 `g_xxx_image`，空则加 `std::mutex` 再判一次，仍空才 `make_unique<ElfImage>(name)`；构造后若 `!IsValid()` 则 `reset()`。`ClearCache(image)` 按指针匹配清单项缓存（测试/重载场景）。库常量 `kArtLibraryName`/`kBinderLibraryName`/`kLinkerPath` 来自 `common/config.h`。

## 解析与查找流程

```mermaid
flowchart TD
    A["ElfImage(libart.so)"] --> B["findModuleBase<br/>扫 /proc/self/maps"]
    B --> C["mmap 磁盘 ELF"]
    C --> D["parseHeaders<br/>.dynsym/.gnu.hash/.hash"]
    D --> E{"有 .gnu_debugdata?"}
    E -- 是 --> F["decompressGnuDebugData<br/>XZ 解压取 .symtab"]
    E -- 否 --> G["就绪"]
    F --> G
    G --> H["getSymbAddress(name)"]
    H --> I["gnuLookup GNU hash"]
    I --> J{"找到?"}
    J -- 否 --> K["elfLookup ELF hash"]
    K --> L{"找到?"}
    L -- 否 --> M["linearLookup .symtab 线性"]
    M --> N["base_ + offset - bias_"]
    J -- 是 --> N
    L -- 是 --> N

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class B,C,D,F,H,I,K,M,N class vec
    class E,J,L class hot
    class A,G class plain
```

## 相关

- [arsc-parser.md · ARSC 结构与符号桩](./arsc-parser) — `PrepareSymbols` 用 `getSymbAddress` 解析 `libandroidfw` 函数
- [inline-scope.md · Dobby inline hook](./inline-scope) — `ElfSymbolCache::GetLinker()` 服务 `art_symbol_resolver`
- [elf-image.md · ELF 解析（旧版）](./elf-image) — 同类的既有文档
- [native-core · native 总览](../native-core)
