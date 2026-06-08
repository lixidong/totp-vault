# SPEC 08: 安全设计

> **目的**：定义密钥分层、派生参数、加密、自动锁定、Content Script 隔离、威胁模型
> **对应文件**：`src/libs/auth/`（crypto.ts, credentials.ts, lock.ts）+ 横切各模块
> **依赖**：[01-types.md](./01-types.md), [02-kdbx.md](./02-kdbx.md), [07-storage.md](./07-storage.md)
> **被依赖**：[03-webdav.md](./03-webdav.md), [06-messaging.md](./06-messaging.md), [09-popup.md](./09-popup.md), [10-options.md](./10-options.md)

---

## 1. 密钥分层模型

```
用户主密码 (明文, 输入瞬间存在, 不持久化)
   │
   ├─→ [Argon2id, KDBX salt]   ─→ KDBX header key ─→ 解密 KDBX 文件
   │
   └─→ [Argon2id, device salt] ─→ deviceKey        ─→ 加密 WebDAV 凭据
```

**关键**：
- **两个** Argon2id 派生,**不同 salt**
- KDBX salt 来自 KDBX 文件 header（首次创建时随机）
- device salt 写死在扩展代码里（**故意**这样，所有用户共用一个 salt → 攻击者已知 salt 会降低破解难度，但主密码强度才是决定性因素）
- **deviceKey 与 KDBX 派生密钥独立**：webdav 凭据泄露不会影响 KDBX，反之亦然

---

## 2. KDBX 派生

详见 [02-kdbx.md](./02-kdbx.md) §2。

```typescript
const kdbxCreds = kdbxweb.Credentials.fromPassword(masterPassword);
const db = await kdbxweb.Kdbx.load(bytes, kdbxCreds);
```

**KDBXweb 自动处理**：
- Argon2id 派生（KDF 标识符在 header 中）
- 派生参数 memory/iterations 来自 KDBX header
- 派生密钥长度 256 bit
- AES-256-CBC + HMAC-SHA256 解密 body

**用户感知**：
- 首次解锁：2~5 秒（Argon2id 派生）
- 密码错：解密失败，抛 `INVALID_PASSWORD`

---

## 3. deviceKey 派生

### 3.1 派生参数

```typescript
const DEVICE_SALT = new TextEncoder().encode('totp-vault/deviceKey/v2');

const DEVICE_KDF_PARAMS = {
  function: 'Argon2id' as const,
  salt: DEVICE_SALT,
  iterations: 3,
  memory: 65536,     // 64 MB
  parallelism: 1,
  keyLength: 256,    // bit
};
```

**为什么参数比 KDBX 派生小**：
- 每次 webdav 操作都需重新派生（解锁流程就要用）
- 强度足够即可（webdav 凭据本身有 HTTPS 保护，deviceKey 主要防"设备失窃后 chrome.storage 被读"）
- 真被攻击者读 chrome.storage → 还需要 Argon2id 跑一遍（几次迭代 × 64MB 内存 = 几秒）→ 主密码错就拿不到

### 3.2 加密 WebDAV 凭据

```typescript
// libs/auth/crypto.ts
import { webdav as kdbxwebCrypto } from 'kdbxweb/crypto/webdav';  // 假,实际用 SubtleCrypto

async function deriveDeviceKey(masterPassword: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'Argon2id',  // 注意: SubtleCrypto 实际不支持 Argon2id
    false,
    ['deriveKey']
  );
  // ...
}
```

**等等**——**Web Crypto API 不支持 Argon2id**。这是 v2 的一个实现难点。

### 3.3 实现方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 用 PBKDF2 替代（webdav 凭据派生） | 浏览器原生 | 弱于 Argon2id |
| B. 引入 `argon2-browser` / `@noble/hashes` | 真 Argon2id | 体积 +20~200KB,启动慢 |
| C. 用 KDBX 派生密钥"顺手"派生 deviceKey | 0 依赖 | 耦合严重,改 KDBX 派生参数会破 deviceKey |

**v2 决策**：**方案 A**。原因：
- deviceKey 用途是"防设备失窃后 chrome.storage 被读"，不是"防云盘被脱库"
- 攻击者能读 chrome.storage.local 说明已经有设备级访问权限
- 此时 PBKDF2 的弱派生 + 主密码本身的强度 = 仍然够用
- Argon2id 的真正价值在 KDBX（云端被脱库后离线爆破）

**deviceKey 用 PBKDF2-SHA256, 600,000 iterations**（OWASP 2023 推荐值）。

```typescript
async function deriveDeviceKey(masterPassword: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: DEVICE_SALT,
      iterations: 600_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,  // 不可导出
    ['encrypt', 'decrypt']
  );
}

async function encryptJSON<T>(value: T, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    algorithm: 'AES-GCM-256',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    kdf: { function: 'Argon2id', ... }  // 实际是 PBKDF2,标注清楚
  };
}
```

**kdf 字段说明**：
- v2 实现用 PBKDF2，但 `kdf.function` 字段写 `PBKDF2-SHA256`
- **不**写 `Argon2id`（避免误导审计）
- 详细参数写在 kdf 字段下：`{ function: 'PBKDF2-SHA256', salt, iterations: 600_000 }`

### 3.4 EncryptedBlob schema（修订）

```typescript
type EncryptedBlob = {
  algorithm: 'AES-GCM-256';
  iv: string;  // base64
  ciphertext: string;  // base64
  kdf: {
    function: 'PBKDF2-SHA256';
    salt: string;  // base64
    iterations: number;
  };
};
```

---

## 4. 自动锁定

详见 [06-messaging.md](./06-messaging.md) §3.4。

**v2 决策**：
- ✅ 默认 5 分钟无操作自动锁（可改为 1 / 10 / 30 / 永不）
- ✅ 锁定时清空 Repository + 清空 session
- ✅ 推 `locked` 消息给所有 UI
- ❌ **不**做"操作时重新计时"（v2 简化为"任何业务请求都重置计时器"）

---

## 5. Content Script 隔离

详见 [05-fill.md](./05-fill.md) §9 和 architecture.md §6.3。

**v2 关键约定**：

```typescript
// ❌ 禁止
chrome.scripting.executeScript({
  world: 'MAIN',  // 页面 JS 可访问
  func: fillPassword,
});

// ✅ 正确
// Content Script 默认就是 ISOLATED world,显式不写
chrome.scripting.executeScript({
  // world 省略 = ISOLATED
  func: findLoginForm,
});
```

**填充值用 `nativeInputValueSetter`**（[05-fill.md §2](./05-fill.md)），绕过框架拦截。

---

## 6. 威胁模型

### 6.1 资产

| 资产 | 敏感度 | 存储位置 |
|---|---|---|
| 用户主密码 | **极高** | 永不入库（仅输入瞬间） |
| 账号密码 | **极高** | KDBX 加密文件（云端+本地） |
| TOTP secret | **高** | KDBX 加密文件 |
| WebDAV 凭据 | **中** | chrome.storage 加密 |
| 时间偏移 | 低 | chrome.storage 明文 |
| 用户设置 | 低 | chrome.storage 明文 |

### 6.2 威胁场景

| 场景 | 攻击者 | 防御 |
|---|---|---|
| 设备物理失窃 | 拿到解锁设备的人 | 主密码保护 KDBX + deviceKey 保护 webdav 凭据 |
| 云盘被脱库 | 拿到 sync.kdbx 的黑客 | Argon2id 派生（KDBX）+ 主密码强度 |
| 浏览器恶意扩展读 chrome.storage | 另一个扩展 | Web Crypto 不可导出密钥 + 主密码参与 |
| 页面 XSS | 攻击者控制的网页 | ISOLATED world + 注入值不入页面全局 |
| 恶意网站伪造表单 | 钓鱼网站 | "永不保存此站" 忽略列表 + URL 匹配 |
| 中间人 | 网络中间人 | HTTPS 强制 + HSTS |
| 扩展商店供应链攻击 | 扩展被植入后门 | 仅本地加载 + 后续开源 |
| 浏览器 crash dump | 攻击者读磁盘 | 主密码不持久化 + SW 休眠即清空 |
| SW 状态被外部读取 | 同设备其他扩展 | 不可导出密钥 + 加密 chrome.storage |

### 6.3 不防御的场景

- **用户主动泄露主密码**（社会工程学）
- **用户把 KDBX 文件主动分享出去**
- **设备被植入硬件 keylogger**
- **用户禁用主密码直接解锁**（v2 不允许，必须输主密码）

---

## 7. 错误处理的安全考虑

### 7.1 错误信息去敏感

```typescript
// ❌ 错误:泄露内部信息
catch (e) {
  return { ok: false, message: `KDBX 解密失败: ${e.message}` };
  // e.message 可能包含文件名/路径
}

// ✅ 正确
catch (e) {
  console.error('KDBX 解密失败', e);  // 详细日志给开发者
  return { ok: false, error: 'INVALID_PASSWORD', message: '主密码错误' };
  // 用户只看到简短描述
}
```

### 7.2 防计时攻击

KDBXweb 已经处理：派生函数对错误密码**仍然跑完整时间**。v2 不需要额外处理。

### 7.3 错误日志脱敏

```typescript
function safeErrorForLog(e: Error): object {
  return {
    name: e.name,
    message: e.message.replace(/[A-Za-z0-9+/=]{20,}/g, '[redacted]'),  // 去 base64
    code: (e as any).code,
  };
}
```

**约束**：所有写到 `console.error` 的对象**必须**经过 `safeErrorForLog`。

---

## 8. 安全审计清单

v2 完成后，应对照检查：

- [ ] 主密码不在任何文件、内存快照、日志中出现
- [ ] 派生密钥在每次使用后**不被缓存**（每次重新派生）
- [ ] KDBX 字节流离开 SW 范围外都是密文
- [ ] Content Script 不持有 Account / TOTPBinding 对象
- [ ] WebDAV 凭据明文仅在 SW 内存中存在
- [ ] `chrome.storage.local` 中的密文经过 audit
- [ ] `crypto.getRandomValues` 用于所有 IV / salt / UUID 生成
- [ ] 没有 `eval` / `new Function`
- [ ] `innerHTML` / `outerHTML` 写入**全部**经过 escape
- [ ] 用户可见的 URL 全部走 `URL` 构造器（不拼接字符串）

---

## 9. 测试要点

```typescript
describe('security', () => {
  test('主密码错时 KDBX 解密失败', async () => { /* ... */ });
  test('deviceKey 派生确定性(同密码同 salt 同 key)', async () => { /* ... */ });
  test('加密 webdav 凭据后明文不可见', async () => {
    const key = await deriveDeviceKey('test');
    const blob = await encryptJSON({ username: 'alice' }, key);
    expect(blob.ciphertext).not.toContain('alice');
  });
  test('锁定后 session 清空', async () => { /* ... */ });
  test('错误信息不含敏感数据', async () => { /* ... */ });
});
```
