# 🌐 CloudflareDNS · NoSniFactory · 网络

> 📂 [`app/src/main/java/org/lsposed/manager/util/`](https://github.com/android-security-engineer/Vector-skills/blob/master/app/src/main/java/org/lsposed/manager/util/)
> 🟦 app 模块 · DoH 域名解析与无 SNI 的 TLS 工厂

## 包职责

为管理器的 OkHttp 客户端提供可选的 DNS-over-HTTPS（走 Cloudflare）和一套刻意去掉 SNI 的 `SSLSocketFactory`——后者用于 DoH 自身的引导连接，避免 SNI 触发中间盒拦截。

## 类清单

| 类 | 说明 |
| :--- | :--- |
| [`CloudflareDNS`](#cloudflaredns) | 实现 `okhttp3.Dns`，按偏好决定是否走 DoH |
| [`NoSniFactory`](#nosnifactory) | 清除 SNI hostname 的 `SSLSocketFactory` |

---

## CloudflareDNS

`public final class CloudflareDNS implements Dns` —— 构造时建一个 `DnsOverHttps` 实例指向 `https://cloudflare-dns.com/dns-query`，引导 IP 用 Cloudflare 公共 DNS。`lookup` 时按 `DoH && noProxy` 决定走 DoH 还是系统 DNS。

### 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `DoH` | `boolean` | 偏好 `doh` 开关，构造时快照 |
| `noProxy` | `boolean` | 默认 `ProxySelector` 对 DoH URL 是否无代理 |
| `cloudflare` | `Dns` | 内部 `DnsOverHttps` 实例 |
| `url` | `static HttpUrl` | `https://cloudflare-dns.com/dns-query` |

### 方法签名

```java
public CloudflareDNS()

@NonNull
@Override
public List<InetAddress> lookup(@NonNull String hostname) throws UnknownHostException
```

构造细节：Android Q 以下用 `supportsTlsExtensions(false)` 关掉 TLS 扩展；bootstrap 主机含 `1.1.1.1`/`1.0.0.1` 及 v6；DoH 客户端用 `NoSniFactory` 与平台 `TrustManager`、`RESTRICTED_TLS`、`App.getOkHttpCache()`。

---

## NoSniFactory

`public final class NoSniFactory extends SSLSocketFactory` —— 包装默认 `SSLSocketFactory`，对每个生成的 socket 调 `SSLCertificateSocketFactory.setHostname(socket, null)` 清除 SNI，并开启 session tickets。

### 关键字段

| 字段 | 类型 | 含义 |
| :--- | :--- | :--- |
| `defaultFactory` | `static SSLSocketFactory` | JDK 默认工厂 |
| `openSSLSocket` | `static SSLCertificateSocketFactory` | 用于清 SNI 的 Android 平台工厂 |

### 方法签名

```java
@Override public String[] getDefaultCipherSuites()
@Override public String[] getSupportedCipherSuites()
@Override public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException
@Override public Socket createSocket(String host, int port) throws IOException
@Override public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException
@Override public Socket createSocket(InetAddress host, int port) throws IOException
@Override public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException

// 清 SNI + 开 session tickets
private Socket config(Socket socket)
```

## DNS 决策

```mermaid
flowchart TD
    A["OkHttp lookup(host)"] --> B{"DoH && noProxy?"}
    B -->|是| C["cloudflare.lookup → DoH"]
    B -->|否| D["SYSTEM.lookup"]
    C --> E["NoSniFactory 引导 TLS"]
    E --> F["1.1.1.1 / 1.0.0.1"]
    F --> G["cloudflare-dns.com"]
    G --> H["解析结果"]

    classDef vec fill:#0e3a36,stroke:#3dd8c8,color:#fff
    classDef hot fill:#3a2a10,stroke:#e8a838,color:#fff
    classDef plain fill:#1a2030,stroke:#6b7689,color:#fff
    class C,E,F,G class vec
    class B class hot
    class A,D,H class plain
```

## 相关

- [app 模块总览](../../modules/app)
- [UpdateUtil · 更新检查](./update-util)（其请求经此网络栈）
