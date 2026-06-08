# SPEC 01: 类型定义

> **目的**：定义 v2 中所有跨模块共享的数据类型，是其他所有 SPEC 的根基
> **对应文件**：`src/libs/auth/types.ts`（与 `src/shared/types.ts` 重导出）
> **依赖**：无
> **被依赖**：02, 03, 04, 05, 06, 07, 09, 10

---

## 1. 核心类型

### 1.1 Account

```typescript
type Account = {
  /** UUID v4，本地生成，跨设备稳定 */
  id: string;

  /** 主域名，例如 "https://github.com"。无 path、无 query。 */
  url: string;

  /** 用户名/邮箱/手机号。最长 256 字符。 */
  username: string;

  /** 明文密码，最长 1024 字符。仅在内存中存在。 */
  password: string;

  /** TOTP 绑定，可选 */
  totp?: TOTPBinding;

  /** 自由文本备注，最长 8192 字符 */
  notes?: string;

  /** ISO 8601 UTC */
  createdAt: string;

  /** ISO 8601 UTC */
  updatedAt: string;

  /** ISO 8601 UTC，用于排序"最近使用" */
  lastUsedAt?: string;
};
```

**约束**：
- `id` 必须用 `crypto.randomUUID()` 生成，**禁止**从 username/url 派生
- `url` 必须是 origin 形式（protocol + host + port），**禁止**保留 path
- `username`、`password` 写入前**必须**调用 `validateAccount()` 校验

### 1.2 TOTPBinding

```typescript
type TOTPAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

type TOTPDigits = 6 | 8;

type TOTPPeriod = 30 | 60;

type TOTPBinding = {
  /** 标准 base32 编码（RFC 4648），不含填充符 */
  secretBase32: string;

  /** 哈希算法，默认 SHA1 */
  algorithm: TOTPAlgorithm;

  /** 验证码位数，默认 6 */
  digits: TOTPDigits;

  /** 周期（秒），默认 30 */
  period: TOTPPeriod;

  /** 显示名，可与 url 解耦（例如 url="https://github.com", issuer="Work Account"） */
  issuer?: string;
};
```

**约束**：
- `secretBase32` **必须**通过 `isValidBase32()` 校验后才允许写入 KDBX
- 校验失败时弹出"secret 无效"提示，**不**写入 KDBX
- 解析 otpauth URI 时所有字段都是可选的，缺失则用默认值（SHA1 / 6 / 30）

---

## 2. 设置与配置

### 2.1 WebDAVConfig

```typescript
type WebDAVConfig = {
  /** WebDAV 服务根 URL，例如 "https://dav.jianguoyun.com/dav/" */
  url: string;

  /** 用户名（不是登录密码，是子账号或邮箱） */
  username: string;

  /** 应用专用密码（坚果云在用户中心生成；自建 NAS 用对应机制） */
  appPassword: string;

  /** KDBX 文件在 WebDAV 上的相对路径，默认 "totp-vault/sync.kdbx" */
  remotePath: string;
};
```

**安全约束**：这个结构**永远不能**以明文存进 `chrome.storage.local`。必须用 `EncryptedBlob` 包装。

### 2.2 EncryptedBlob

```typescript
type EncryptedBlob = {
  /** 加密算法标识 */
  algorithm: 'AES-GCM-256';

  /** 12 字节 IV，base64 编码 */
  iv: string;

  /** 密文，base64 编码 */
  ciphertext: string;

  /** 派生参数描述（仅 WebDAV 凭据加密场景） */
  kdf: {
    function: 'Argon2id';
    salt: string;     // base64
    iterations: number;
    memory: number;   // KB
    parallelism: number;
  };
};
```

详见 [08-security.md](./08-security.md) §3.2。

### 2.3 AppSettings

```typescript
type AppSettings = {
  /** 自动锁定时间（分钟），0 表示永不自动锁 */
  autoLockMinutes: number;

  /** 登录后是否自动填 TOTP */
  autoFillTOTP: boolean;

  /** 填 TOTP 时是否同时复制到剪贴板 */
  copyTOTPToClipboard: boolean;

  /** 永不保存的域名列表 */
  ignoreList: string[];

  /** 主题（v2 暂不实现暗色，预留字段） */
  theme: 'light' | 'auto';
};
```

**默认值**：
```typescript
const DEFAULT_SETTINGS: AppSettings = {
  autoLockMinutes: 5,
  autoFillTOTP: true,
  copyTOTPToClipboard: false,
  ignoreList: [],
  theme: 'auto',
};
```

---

## 3. 消息协议

### 3.1 消息总线请求类型

```typescript
type Request =
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'isUnlocked' }
  | { type: 'listAccounts' }
  | { type: 'getAccount'; id: string }
  | { type: 'createAccount'; account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'> }
  | { type: 'updateAccount'; id: string; patch: Partial<Account> }
  | { type: 'deleteAccount'; id: string }
  | { type: 'bindTOTP'; accountId: string; binding: TOTPBinding }
  | { type: 'unbindTOTP'; accountId: string }
  | { type: 'getCurrentTOTP'; accountId: string }
  | { type: 'getWebDAVConfig' }
  | { type: 'setWebDAVConfig'; config: Omit<WebDAVConfig, 'appPassword'> & { appPassword: string } }
  | { type: 'syncNow' }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Partial<AppSettings> }
  | { type: 'matchAccountsForUrl'; url: string }
  | { type: 'importAccounts'; accounts: Account[]; mergeStrategy: 'overwrite' | 'skip' | 'merge' }
  | { type: 'exportAccounts'; format: 'json' | 'kdbx' | 'otpauth-uri' };
```

### 3.2 消息总线响应类型

```typescript
type Response =
  | { ok: true; data?: unknown }
  | { ok: false; error: ErrorCode; message: string };

type ErrorCode =
  | 'NOT_UNLOCKED'
  | 'INVALID_PASSWORD'
  | 'KDBX_CORRUPTED'
  | 'WEBDAV_NETWORK_ERROR'
  | 'WEBDAV_AUTH_FAILED'
  | 'WEBDAV_CONFLICT'
  | 'WEBDAV_QUOTA_EXCEEDED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'INVALID_INPUT'
  | 'BASE32_INVALID'
  | 'ACCOUNT_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';
```

### 3.3 错误处理约定

- **绝不**在响应里返回栈追踪（泄露内部路径）
- `message` 字段是**用户可读**的简短描述
- 详细错误日志写 `console.error` 供开发者排查
- `ERROR_CODE` 与 i18n key 一一对应，前端用 09 中的错误展示组件统一渲染

---

## 4. KDBX 字段映射

| TS 字段 | KDBX 字段名 | KDBX 类型 | 备注 |
|---|---|---|---|
| `id` | `AccountID` (custom) | String | UUID，无横线 |
| `url` | `URL` | String | 标准字段 |
| `username` | `UserName` | String | 标准字段 |
| `password` | `Password` | Protected (String) | 标准字段，KDBX 自动加密 |
| `notes` | `Notes` | String | 标准字段 |
| `createdAt` | `Times.CreationTime` | DateTime | 标准字段 |
| `updatedAt` | `Times.LastModificationTime` | DateTime | 标准字段 |
| `lastUsedAt` | `Times.LastAccessTime` | DateTime | 标准字段 |
| `totp.secretBase32` | `otp` (custom) | String | KDBX 4.1 标准 otp 字段 |
| `totp.algorithm` | `otpAlgorithm` (custom) | String | KDBX 4.1 标准 otpAlgorithm 字段 |
| `totp.digits` | `otpLength` (custom) | UInt32 | KDBX 4.1 标准 otpLength 字段 |
| `totp.period` | `otpPeriod` (custom) | UInt32 | KDBX 4.1 标准 otpPeriod 字段 |
| `totp.issuer` | (前缀到 Title) | String | 暂不存独立字段，写到 Title |

**重要约束**：
- **禁止**用 KDBX 库的 `Entry.fields.set('otp', value)` 直接覆盖已存在的 `otp` 字段——会丢算法/位数/周期
- 必须用 KDBX 库提供的 `entry.otp` setter（KDBXweb 0.x 有专门的 OTP API），具体 API 见 [02-kdbx.md](./02-kdbx.md)
- `lastUsedAt` 每次解锁后读取就更新太频繁，v2 限定为：**用户主动填充/复制 TOTP 时**才更新

---

## 5. 导出 JSON Schema（草稿）

`exportAccounts({ format: 'json' })` 输出的 JSON 结构：

```typescript
type ExportJSON = {
  /** schema 版本，便于未来迁移 */
  version: 1;

  /** 导出时间 ISO 8601 UTC */
  exportedAt: string;

  /** 来源扩展版本 */
  exporterVersion: string;

  /** 主密码哈希指纹（不存主密码，仅用于检测"导入到空数据库时是否需要再设主密码"） */
  masterPasswordFingerprint: string;

  accounts: Account[];
};
```

**安全提示**：UI 在导出 JSON 时**必须**弹"明文敏感数据"二次确认框，详见 [09-popup.md](./09-popup.md) §5.3。

---

## 6. 校验函数签名

```typescript
// libs/auth/validation.ts（v2 实现）
export function validateAccount(input: unknown): Account;
export function validateTOTPBinding(input: unknown): TOTPBinding;
export function isValidBase32(s: string): boolean;
export function isValidUrl(s: string): boolean;
export function isValidOtpauthUri(uri: string): { account: TOTPBinding; label: string } | null;
```

**约定**：
- `validateXxx` 函数对**无效输入**抛 `ValidationError`，**不**返回 null
- 上层（content script / popup）必须用 try/catch 包裹，捕获后转成 §3.2 的 ErrorCode 响应

---

## 7. 不在本 SPEC 范围

- KDBX 库的 Entry 对象怎么用 → [02-kdbx.md](./02-kdbx.md)
- WebDAV 凭据怎么加密/解密 → [08-security.md](./08-security.md) §3.2
- otpauth URI 解析/生成 → [04-totp.md](./04-totp.md) §3
- 消息总线实现 → [06-messaging.md](./06-messaging.md)
