# 📚 elf_image.cpp

> 📂 `native/include/elf/elf_image.h`
> 📂 `native/src/elf/elf_image.cpp`
> 🟦 native 模块 · ELF 内存解析与符号查找

## 类职责

`class ElfImage`（`namespace vector::native`）负责**在内存中解析已加载的 ELF 共享库**并按符号名定位函数地址。它从 `/proc/self/maps` 找到库的基址，`mmap` 磁盘上的 ELF 文件，解析段头/符号表/哈希表，支持 GNU hash、ELF hash、线性查找三种符号定位策略，并能解压 `.gnu_debugdata`（XZ 压缩的调试符号）以恢复被 strip 的 `.symtab`。

典型用途：`resources_hook.cpp` 用它从 `libandroidfw.so` 解析 `ResXMLParser::next` 等私有 C++ 函数地址；`Context` 子类用它解析 ART 内部符号。

## 构造与生命周期

```cpp
explicit ElfImage(std::string_view lib_name);
~ElfImage();
ElfImage(const ElfImage &) = delete;
ElfImage &operator=(const ElfImage &) = delete;

[[nodiscard]] bool IsValid() const { return base_ != nullptr; }
[[nodiscard]] const std::string &GetPath() const { return path_; }
```

构造流程：

1. `findModuleBase()` 从 `/proc/self/maps` 定位基址（失败则 `base_=null` 直接返回）
2. `open` + `fstat` + `mmap(PROT_READ, MAP_SHARED)` 映射整个 ELF 文件
3. `parseHeaders(header_)` 解析主 ELF 段头
4. `decompressGnuDebugData()` 若存在 `.gnu_debugdata`，XZ 解压后对解压出的 mini-ELF 再次 `parseHeaders` 找 `.symtab`

析构 `munmap(file_map_)`。拷贝/赋值被 delete 防止资源误管理。

## findModuleBase：基址定位

```cpp
bool ElfImage::findModuleBase()
```

解析 `/proc/self/maps`，过滤含 `lib_name` 的行，按优先级选基址：

1. **首选模式**：`r--p` 后紧跟 `r-xp` 的块（libart.so 的可靠模式），取 `r--p` 起址
2. **次选**：第一个 `r-xp` 块
3. **兜底**：过滤列表的第一条

选中的 `start_addr` 作为 `base_`，并把 `path_` 更新为 maps 里的规范路径。这步很关键：磁盘文件偏移 ≠ 内存地址，需要 base + offset - bias 才是真实地址。

## parseHeaders：段头解析

```cpp
void ElfImage::parseHeaders(ElfW(Ehdr) *header)
```

遍历 `e_shnum` 个段头，按 `sh_type` 分类：

| 段类型 | 提取内容 |
| :--- | :--- |
| `SHT_DYNSYM` | 首个 `.dynsym` → `dynsym_`/`dynsym_start_` |
| `SHT_SYMTAB` | `.symtab` → `symtab_start_`/`symtab_count_`（仅从 debugdata 中有效） |
| `SHT_STRTAB` | dynsym 后的首个 strtab → `strtab_start_`；名为 `.strtab` 的 → `symtab_str_start_` |
| `SHT_PROGBITS` | 首个 `SHF_ALLOC` 且 `sh_addr>0` 的段算 `bias_ = sh_addr - sh_offset` |
| `SHT_HASH` | 标准 ELF hash：`nbucket_`/`bucket_`/`chain_` |
| `SHT_GNU_HASH` | GNU hash：`gnu_nbucket_`/`gnu_symndx_`/`gnu_bloom_size_`/`gnu_shift2_`/`gnu_bloom_filter_`/`gnu_bucket_`/`gnu_chain_` |

`bias_`（load bias）是虚拟地址与文件偏移之差，`getSymbAddress` 计算最终地址时用它修正。

## decompressGnuDebugData：XZ 解压

```cpp
bool ElfImage::decompressGnuDebugData()
```

许多系统库被 strip 了 `.symtab`，但保留了 XZ 压缩的 `.gnu_debugdata`（mini ELF 含完整符号）。流程：

1. 找 `.gnu_debugdata` 段的 offset/size
2. `xz_crc32_init()` + `xz_dec_init(XZ_DYNALLOC, 1<<26)` 初始化 XZ 解码器
3. 循环 `xz_dec_run`：`XZ_STREAM_END` 时 `resize` 到实际大小返回 true；`XZ_OK` 且 out 满则 `resize*2` 扩容继续；其他返回值视为失败
4. 解压结果存 `elf_debugdata_`（`std::string`），构造 `header_debugdata_` 指针，再次 `parseHeaders` 找 `.symtab`

## 符号查找：三级级联

```cpp
ElfW(Addr) getSymbOffset(std::string_view name, uint32_t gnu_hash, uint32_t elf_hash) const {
    if (auto offset = gnuLookup(name, gnu_hash); offset > 0) return offset;
    else if (offset = elfLookup(name, elf_hash); offset > 0) return offset;
    else if (offset = linearLookup(name); offset > 0) return offset;
    else return 0;
}
```

| 策略 | 数据源 | 速度 | 适用 |
| :--- | :--- | :--- | :--- |
| `gnuLookup` | `.gnu.hash` + bloom filter + bucket/chain | 最快 | 导出符号（dynsym） |
| `elfLookup` | `.hash` + bucket/chain | 快 | 旧格式导出符号 |
| `linearLookup` | `.symtab` 全量（懒构建 map） | 慢 | 私有/内部符号（仅 debugdata 有） |

### GNU hash 查找

bloom filter 先快速排除"肯定不存在"的符号：用 hash 的两位掩码与 bloom word 比较，不匹配则直接返回 0。匹配则沿 `bucket[hash%nbucket]` 起始的 chain 链遍历，chain 值最低位为 1 表示链尾。

### 线性查找与 prefix

```cpp
void ensureLinearMapInitialized() const;   // 懒构建 symtabs_ map（仅 STT_FUNC/STT_OBJECT 且 size>0）
ElfW(Addr) linearLookup(std::string_view name) const;
std::vector<ElfW(Addr)> linearRangeLookup(std::string_view name) const;  // 同名所有符号
ElfW(Addr) prefixLookupFirst(std::string_view prefix) const;             // 前缀首个（用于 mangled 名）
```

`symtabs_` 是 `mutable std::map<string_view, ElfW(Sym)*>`，允许 const 方法惰性初始化。`prefixLookupFirst` 用 `lower_bound` 找首个不小于 prefix 的元素，再 `starts_with` 校验——用于只知道 mangled 名前缀的场景。

## getSymbAddress 模板

```cpp
template <typename T = void *> requires(std::is_pointer_v<T>)
const T getSymbAddress(std::string_view name) const {
    auto gnu_hash = GnuHash(name);
    auto elf_hash = ElfHash(name);
    auto offset = getSymbOffset(name, gnu_hash, elf_hash);
    if (offset > 0 && base_ != nullptr) {
        return reinterpret_cast<T>(reinterpret_cast<uintptr_t>(base_) + offset - bias_);
    }
    return nullptr;
}

template <typename T = void *> requires(std::is_pointer_v<T>)
const T getSymbPrefixFirstAddress(std::string_view prefix) const;
```

约束 `is_pointer_v<T>` 让调用方能直接拿到函数指针类型（如 `int32_t(*)(void*,int)`）。最终地址 = `base_ + offset - bias_`（内存基址 + 符号偏移 - load bias）。

## 哈希函数

```cpp
static constexpr uint32_t ElfHash(std::string_view name);   // 经典 ELF hash
static constexpr uint32_t GnuHash(std::string_view name);   // h*33+p，DJB2 变体
```

两者都是 `constexpr`，调用方在传入前预计算 `gnu_hash`/`elf_hash`，避免级联查找时重复计算。

## 关键字段

| 字段 | 含义 |
| :--- | :--- |
| `path_`/`base_`/`file_map_`/`file_size_` | 路径、内存基址、文件映射、文件大小 |
| `bias_`/`bias_calculated_` | load bias 与是否已算 |
| `header_`/`header_debugdata_` | 主 ELF 头与 debugdata 头 |
| `dynsym_`/`dynsym_start_`/`strtab_start_` | dynsym 段头、符号起始、字符串表 |
| `nbucket_`/`bucket_`/`chain_` | ELF hash 表 |
| `gnu_*` | GNU hash 表各字段 |
| `symtab_start_`/`symtab_count_`/`symtab_str_start_` | 完整符号表（debugdata） |
| `symtabs_`（mutable） | 懒构建的符号名→Sym* map |

## 查找决策流

```mermaid
flowchart TD
    Start["getSymbAddress(name)"] --> Hash["预计算 gnu_hash/elf_hash"]
    Hash --> G["gnuLookup"]
    G -->|"offset>0"| Addr["base + offset - bias"]
    G -->|"0"| E["elfLookup"]
    E -->|"offset>0"| Addr
    E -->|"0"| L["linearLookup"]
    L -->|"ensureLinearMapInitialized<br/>懒构建 symtabs_ map"| LM["symtabs_.find(name)"]
    LM -->|"找到"| Addr
    LM -->|"未找到"| N["return nullptr"]
    Addr --> R["return 函数指针"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class G,E,L,LM class vec
    class Hash class hot
    class Start,Addr,N,R class plain
```

## 相关

- [resources_hook.cpp · 资源 hook](./resources-hook-cpp) — 用 `ElfImage` 解析 `libandroidfw.so` 符号
- [context.cpp · Context 抽象基类](./context) — 子类用 `ElfImage` 解析 ART 符号
- [native-elf · ELF 总览](../native-elf)
