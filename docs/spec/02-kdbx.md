# SPEC 02: KDBX 存储

> **目的**：定义 KDBX 4.1 文件怎么读、写、合并
> **对应文件**：`src/libs/kdbx/`（repository.ts, merge.ts）
> **依赖**：[01-types.md](./01-types.md)
> **被依赖**：[03-webdav.md](./03-webdav.md), [08-security.md](./08-security.md), [09-popup.md](./09-popup.md)

---

## 1. 为什么是 KDBX 4.1

- **开放标准**：KeePass 团队维护，独立安全审计
- **互通**：KeePassXC / KeePassDX / Aegis / Strongbox / Keepass2Android **全部**能开
- **TOTP 原生字段**：KDBX 4.1 自带 `otp` / `otpAlgorithm` / `otpLength` / `otpPeriod`，不需自定 schema
- **加密成熟**：AES-256 + ChaCha20 + Argon2id，多种组合可选
- **库成熟**：`kdbxweb` 是社区事实标准，TypeScript 友好

**决策**：
- 文件格式：KDBX 4.1
- 主密码派生：Argon2id（KDBX 库默认）
- 内层加密：AES-256-CBC + HMAC-SHA256（`kdbxweb` 4.x 默认）

---

## 2. KDBX 4.1 关键参数

### 2.1 创建新数据库（首次解锁流程）

```typescript
const db = kdbxweb.Kdbx.create(
  kdbxweb.Credentials.fromPassword('user-master-password'),
  'totp-vault v2 database'  // 内置备注
);
```

**KDBXweb 会自动选择**：
- KDF：Argon2id
- Cipher：AES-256-CBC
- 派生参数：KDBXweb 默认（v0.x 默认 memory=64MB, iterations=3）

**用户首次设主密码时弹窗**："首次解锁需 2~5 秒，是否加强安全？" → "标准" / "加强"（memory=128MB, iterations=6）

### 2.2 打开已有数据库

```typescript
const db = await kdbxweb.Kdbx.load(
  bytes,  // Uint8Array, 从 WebDAV 下载
  kdbxweb.Credentials.fromPassword('user-master-password')
);
```

**性能预期**（30 条规模）：
- 下载 + 解密 header：< 200ms
- Argon2id 派生：2~5 秒
- 解密 body + 解析：< 100ms
- **用户感知**：输主密码后等 2~5 秒一次

### 2.3 派生参数

| 模式 | memory (KB) | iterations | parallelism | 派生耗时 |
|---|---|---|---|---|
| 标准（默认） | 65536 | 3 | 1 | ~2 秒 |
| 加强 | 131072 | 6 | 1 | ~5 秒 |
| 自定义 | 16384~262144 | 1~10 | 1~4 | 用户测试时告知 |

**v2 范围**：仅实现"标准"和"加强"两档。**不**开放自定义滑块（避免误配置导致解锁过慢/过快）。

---

## 3. 库 API（kdbxweb）核心概念

### 3.1 数据结构

```typescript
kdbxweb.Kdbx              // 顶层数据库对象
  .credentials            // 派生凭据
  .meta                   // 数据库元数据（生成器、回收站设置等）
  .groups                 // 根 Group 数组
  .getDefaultGroup()      // 默认 Group（"Database" / "Root"）

kdbxweb.Group             // 条目分组
  .entries                // Entry 数组
  .groups                 // 子 Group 数组
  .addEntry(entry)
  .removeEntry(entry)

kdbxweb.Entry             // 单条凭证
  .fields                 // ProtectedValue 集合
  .times                  // 时间信息
  .binaries                // 附件
  .customProperties       // 自定义字段（KDBX 4.x）
  .otp                    // KDBX 4.1 OTP 配置对象
```

### 3.2 Entry 字段操作

**标准字段**（用 `fields.get/set`）：
```typescript
entry.fields.set('UserName', 'alice@example.com');
entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cret'));
entry.fields.set('URL', 'https://github.com');
entry.fields.set('Notes', 'work account');
```

**TOTP 字段**（用专用 setter，**不要**走 customProperties）：
```typescript
entry.otp = {
  secret: kdbxweb.ByteUtils.base64ToBytes(b64Secret),  // 注意是 bytes
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
};
```

**关键约束**：
- `entry.otp.secret` 接受 **bytes**，不是 base32 字符串
- **必须**自己写 base32 → bytes 的转换，详见 [04-totp.md](./04-totp.md) §2
- 写入前**必须**用 `isValidBase32()` 校验，校验失败抛 `BASE32_INVALID` ErrorCode

### 3.3 时间字段

```typescript
entry.times.creationTime = new Date('2026-06-06T00:00:00Z');
entry.times.lastModificationTime = new Date();
entry.times.lastAccessTime = new Date();
```

**v2 约定**：
- `creationTime` / `lastModificationTime`：CRUD 时维护
- `lastAccessTime`：仅在"用户主动填充/复制 TOTP"时更新

### 3.4 序列化回字节流

```typescript
const bytes = await db.save();
// 或
const bytes = await db.save({ version: kdbxweb.FileVersion.Kdbx4_1 });
```

返回 `Uint8Array`，可直接上传到 WebDAV。

---

## 4. Repository 层接口

封装 KDBX 操作为业务接口，**屏蔽 KDBXweb 库 API 细节**。

### 4.1 Repository 类

```typescript
// libs/kdbx/repository.ts
export class KdbxRepository {
  /** 持有已解密的 Kdbx 对象引用（不复制） */
  constructor(private db: kdbxweb.Kdbx) {}

  listAccounts(): Account[] { /* ... */ }
  getAccount(id: string): Account | null { /* ... */ }

  createAccount(input: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>): Account { /* ... */ }
  updateAccount(id: string, patch: Partial<Account>): Account { /* ... */ }
  deleteAccount(id: string): void { /* ... */ }

  bindTOTP(accountId: string, binding: TOTPBinding): void { /* ... */ }
  unbindTOTP(accountId: string): void { /* ... */ }

  /** 序列化为字节流，用于 WebDAV 上传 */
  async save(): Promise<Uint8Array> { /* ... */ }
}
```

### 4.2 单例持有

```typescript
// libs/kdbx/index.ts
let _repo: KdbxRepository | null = null;

export function setRepository(repo: KdbxRepository) { _repo = repo; }
export function getRepository(): KdbxRepository { /* 抛 NOT_UNLOCKED */ }
export function clearRepository() { _repo = null; }  // 锁定时调用
```

**约束**：
- **仅** Service Worker 可调用 `setRepository` / `clearRepository`
- Content Script / Popup **不能**直接持有 Repository 引用
- 业务请求通过 `chrome.runtime.sendMessage` 经 SW 转发（见 [06-messaging.md](./06-messaging.md)）

### 4.3 ID 生成

```typescript
function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '');  // KDBX 内部用无横线
}
```

**约束**：
- `crypto.randomUUID()` 在 MV3 Service Worker 默认可用
- Content Script 环境**不**直接调用此函数，所有写入走 SW

### 4.4 与 Account 的双向转换

```typescript
// libs/kdbx/convert.ts
export function entryToAccount(entry: kdbxweb.Entry): Account;
export function accountToEntryFields(account: Account): kdbxweb.Entry;  // 不创建,只填字段
```

**关键**：
- `entry.uuid` 字段（KDBX 内部 ID）映射 `account.id`（**注意是无横线 UUID**）
- `entry.fields.get('UserName')` 可能是 `ProtectedValue` 或 `string`，**必须**先 `getText()` 取明文
- **不允许**任何路径上把明文密码写入日志

---

## 5. 内存对象生命周期

```
[用户输主密码] → SW 调 webdav.download() → 拿到字节流
                                       ↓
                          kdbxweb.Kdbx.load(bytes, password)
                                       ↓
                          new KdbxRepository(db)
                                       ↓
                          setRepository(repo)  ← 全局单例
                                       ↓
                          chrome.runtime.sendMessage 接收业务请求
                                       ↓
                  [锁定] → clearRepository() → repo 置 null → 等 GC
```

**关键**：
- `db` 对象是 KDBXweb 内部表示，**已解密**但**仍在内存**
- 锁定时**仅**置 `_repo = null`，依赖 JS GC 回收（无显式 free）
- 真正的安全保证依赖：**SW 进程被回收 = 整个内存清空**（这是 MV3 强保证）

---

## 6. 冲突合并（merge.ts）

WebDAV 上传时遇到 412 Precondition Failed 时触发，详见 [03-webdav.md](./03-webdav.md) §5。本节只描述 KDBX 级别的合并算法。

### 6.1 输入

```typescript
type MergeInput = {
  local: kdbxweb.Kdbx;   // 本地内存中已修改
  remote: kdbxweb.Kdbx;  // 从 WebDAV 下载的最新
  password: string;      // 主密码（解锁 remote 用）
};

type MergeResult = {
  merged: kdbxweb.Kdbx;  // 合并后,准备重新上传
  conflicts: ConflictRecord[];  // 需要用户确认的冲突
};

type ConflictRecord = {
  accountId: string;
  field: 'password' | 'totp' | 'url' | 'username' | 'notes';
  localValue: string;
  remoteValue: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
};
```

### 6.2 合并策略（entry 级别）

**步骤**：
1. 用 `id` (UUID) 索引 local / remote 的所有 Entry
2. 遍历 `local only` / `remote only` / `both` 三类：
   - `local only`：保留（用户在本地加的）
   - `remote only`：保留（用户在另一端加的）
   - `both`：进入字段级合并
3. 字段级合并：
   - **简单字段**（url / username / notes）：保留 `updatedAt` 较新者
   - **password**：保留 `updatedAt` 较新者（v2 不弹窗，**完全自动化**）
   - **totp**：**不**自动合并，加入 `conflicts[]` 让用户选
4. 输出 `merged` 数据库 + `conflicts[]`

**v2 范围**：
- ✅ entry 级别合并（local only / remote only / both）
- ✅ 简单字段自动合并
- ✅ totp 冲突弹窗（前端用 [09-popup.md](./09-popup.md) §3.5 的 ConflictResolver 组件）
- ❌ 删除合并（v2 不做，被删的条目以"另一端 add"形式重新出现即可）

### 6.3 合并后上传

```
merged.save() → bytes
   ↓
webdav.upload(bytes)  // 不带 If-Match, 强制覆盖
   ↓
更新 .meta.json 的 etag 为新响应的 etag
```

**为什么这里不带 If-Match**：合并是基于远端最新版本做的，理论上不应再有冲突。如果再次 412，提示"同步异常，请稍后重试"。

---

## 7. 错误处理

| KDBXweb 抛出 | 转换为 ErrorCode |
|---|---|
| `InvalidKdbxError` | `KDBX_CORRUPTED` |
| `KdbxError` (密码错) | `INVALID_PASSWORD` |
| 其他 | `UNKNOWN` |

**v2 不做**：
- ❌ 自动从备份恢复（依赖云盘自身版本控制）
- ❌ KDBX 格式版本升级提示（v2 只写 KDBX 4.1，导入 KDBX 3.x 时弹窗"请用桌面客户端另存为 4.1"）

---

## 8. 测试要点

```typescript
// tests/unit/kdbx.test.ts
describe('KdbxRepository', () => {
  test('create + list + get + update + delete CRUD', async () => {
    const db = kdbxweb.Kdbx.create(kdbxweb.Credentials.fromPassword('test'));
    const repo = new KdbxRepository(db);

    const created = repo.createAccount({ url: 'https://a.com', username: 'a', password: 'b' });
    expect(repo.listAccounts()).toHaveLength(1);
    expect(repo.getAccount(created.id)?.username).toBe('a');

    repo.updateAccount(created.id, { password: 'c' });
    expect(repo.getAccount(created.id)?.password).toBe('c');

    repo.deleteAccount(created.id);
    expect(repo.listAccounts()).toHaveLength(0);
  });

  test('bindTOTP 写入后能读出', async () => {
    const db = kdbxweb.Kdbx.create(kdbxweb.Credentials.fromPassword('test'));
    const repo = new KdbxRepository(db);
    const account = repo.createAccount({ url: 'https://a.com', username: 'a', password: 'b' });

    repo.bindTOTP(account.id, {
      secretBase32: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    const reloaded = repo.getAccount(account.id);
    expect(reloaded?.totp?.secretBase32).toBe('JBSWY3DPEHPK3PXP');
  });

  test('merge 保留 local only 和 remote only', async () => {
    // local: 账号 A
    // remote: 账号 B
    // 合并后: 账号 A + 账号 B
  });
});
```
