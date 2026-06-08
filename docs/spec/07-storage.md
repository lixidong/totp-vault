# SPEC 07: chrome.storage 封装

> **目的**：统一封装 `chrome.storage.local` / `chrome.storage.session`，处理加密、配额、schema
> **对应文件**：`src/libs/storage/`（local.ts, session.ts, schema.ts, quota.ts）
> **依赖**：[01-types.md](./01-types.md), [08-security.md](./08-security.md)（deviceKey）
> **被依赖**：[03-webdav.md](./03-webdav.md)（webdavConfig 加密存储）, [06-messaging.md](./06-messaging.md)（session）, [09-popup.md](./09-popup.md)（settings）

---

## 1. 三种存储

| API | 持久性 | 容量 | 加密 | 用途 |
|---|---|---|---|---|
| `chrome.storage.local` | 持久（卸载扩展时清空） | 10 MB | **需要**（敏感数据） | WebDAV 凭据、时间偏移、设置、KDBX 缓存字节流 |
| `chrome.storage.session` | 进程内（SW 休眠即清空） | 10 MB | 可选 | Session 票据、解密中的 KDBX 字节流 |
| `IndexedDB` | 持久 | 数十~数百 MB | 可选 | 大文件缓存（v2 范围外） |

**v2 决策**：
- ✅ 使用 `local` 和 `session`
- ❌ **不**用 IndexedDB（< 30 条规模不需要）

---

## 2. local.ts

### 2.1 存储项清单

```typescript
// libs/storage/schema.ts
type StorageSchema = {
  // === 明文项 ===

  /** 用户设置 */
  'settings': AppSettings;

  /** 永不保存的域名 */
  'ignoreList': string[];

  /** 时间偏移缓存（不是密钥,可明文） */
  'timeOffset': CachedOffset;

  /** 设备 ID（首次安装时生成,UUID） */
  'deviceId': string;

  /** .meta.json 缓存（仅本地用） */
  'syncMeta': {
    lastETag: string;
    lastSyncAt: string;
  };

  // === 加密项 ===

  /** WebDAV 配置(加密) */
  'webdavConfig.encrypted': EncryptedBlob;

  /** KDBX 加密字节流缓存（用于离线解锁,详见 [02-kdbx.md] §3.2） */
  'kdbxCache.encrypted': EncryptedBlob | null;  // v2 暂不实现,见 §5

  /** 备份 KDBX（可选,用户手动备份时写入） */
  'kdbxBackup.encrypted': EncryptedBlob | null;  // v2 暂不实现
};
```

### 2.2 通用读写

```typescript
// libs/storage/local.ts
export async function getItem<K extends keyof StorageSchema>(
  key: K
): Promise<StorageSchema[K] | null> {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function setItem<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeItem(key: keyof StorageSchema): Promise<void> {
  await chrome.storage.local.remove(key);
}
```

### 2.3 默认值

```typescript
const DEFAULTS: Partial<StorageSchema> = {
  settings: DEFAULT_SETTINGS,
  ignoreList: [],
};

export async function initStorage(): Promise<void> {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const toSet: Partial<StorageSchema> = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in existing)) {
      toSet[k] = v as any;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }

  // 生成 deviceId（如果不存在）
  if (!existing.deviceId) {
    await chrome.storage.local.set({ deviceId: crypto.randomUUID() });
  }
}
```

**调用时机**：`initStorage()` 在 SW 启动时调用一次。

### 2.4 配额监控

```typescript
// libs/storage/quota.ts
export async function checkQuota(): Promise<{
  usedBytes: number;
  totalBytes: number;
  percent: number;
}> {
  const bytes = await chrome.storage.local.getBytesInUse();
  // chrome.storage.local 配额 = 10MB = 10485760 bytes
  const total = chrome.storage.local.QUOTA_BYTES ?? 10485760;
  return {
    usedBytes: bytes,
    totalBytes: total,
    percent: (bytes / total) * 100,
  };
}
```

**v2 范围**：
- 配额仅**监控**不预警（< 30 条规模不会触达 10MB）
- Options Page 显示当前用量（debug 用途）
- 触达 90% 时弹"建议清理 ignoreList"提示

---

## 3. session.ts

### 3.1 用途

存放**短生命周期**数据：
- Session 票据（见 [06-messaging.md](./06-messaging.md) §3）
- 解锁期间的明文 KDBX 字节流（**不推荐**用 session，详见 §5）

### 3.2 接口

```typescript
// libs/storage/session.ts
export async function getSessionItem<T = unknown>(key: string): Promise<T | null>;
export async function setSessionItem<T = unknown>(key: string, value: T): Promise<void>;
export async function removeSessionItem(key: string): Promise<void>;
export async function clearSession(): Promise<void>;  // 锁定时调用
```

### 3.3 锁定时清空

```typescript
// libs/auth/lock.ts
import { clearSession } from '@/libs/storage/session';
import { clearRepository } from '@/libs/kdbx';

export async function lock(): Promise<void> {
  clearRepository();
  await clearSession();
  notifyAllUI({ type: 'locked' });
}
```

**约束**：
- `clearSession` 会清空**所有** session 项
- 锁定时调用一次，等同于"丢弃所有短期数据"

---

## 4. 加密项的存储约定

### 4.1 加密项 key 命名

`.encrypted` 后缀明确标识：
```typescript
'webdavConfig.encrypted': EncryptedBlob;
'kdbxCache.encrypted': EncryptedBlob | null;
```

### 4.2 加密项读写

```typescript
// libs/storage/encrypted.ts
import { decryptJSON, encryptJSON } from '@/libs/auth/crypto';
import { deriveDeviceKey } from '@/libs/auth/credentials';

export async function getEncryptedItem<T>(
  key: string,
  masterPassword: string
): Promise<T | null> {
  const blob = await chrome.storage.local.get<EncryptedBlob>(key);
  if (!blob) return null;
  const deviceKey = await deriveDeviceKey(masterPassword);
  return await decryptJSON<T>(blob, deviceKey);
}

export async function setEncryptedItem<T>(
  key: string,
  value: T,
  masterPassword: string
): Promise<void> {
  const deviceKey = await deriveDeviceKey(masterPassword);
  const blob = await encryptJSON(value, deviceKey);
  await chrome.storage.local.set({ [key]: blob });
}
```

详见 [08-security.md](./08-security.md) §3.2 关于 deviceKey 的细节。

---

## 5. KDBX 字节流缓存（v2 范围外，先占位）

**设计意图**：离线时也能解锁扩展。

**流程**：
1. 解锁成功后，**可选**地把解密后的 KDBX 字节流用 deviceKey 重新加密，存 `kdbxCache.encrypted`
2. 下次解锁时，如果远端 ETag 与本地一致，直接用缓存的密文（省一次下载）
3. 缓存是**同一份 KDBX 字节流重新加密**，**不**是明文

**v2 决策**：**不实现**。原因：
- 30 条规模下载只需 < 1 秒
- 缓存机制增加复杂度（缓存失效、内存同步）
- v3 视需要再加

**占位**：
```typescript
// libs/storage/local.ts 顶部注释
// kdbxCache.encrypted 字段保留 key,但 v2 永远写 null
```

---

## 6. 设置变更监听

```typescript
// libs/storage/local.ts
export function onSettingChange<K extends keyof StorageSchema>(
  key: K,
  callback: (newValue: StorageSchema[K], oldValue: StorageSchema[K] | null) => void
): () => void {
  const listener = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== 'local') return;
    if (!(key in changes)) return;
    callback(changes[key].newValue as StorageSchema[K], changes[key].oldValue as StorageSchema[K] | null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
```

**使用**：
```typescript
// SW 启动时
onSettingChange('settings', (newSettings) => {
  // 重新设置自动锁定时间
  rescheduleAutoLock(newSettings.autoLockMinutes);
});
```

---

## 7. Schema 校验（v2 简化）

```typescript
// libs/storage/schema.ts
import { z } from 'zod';  // v2 新增依赖

const SettingsSchema = z.object({
  autoLockMinutes: z.number().min(0).max(60),
  autoFillTOTP: z.boolean(),
  copyTOTPToClipboard: z.boolean(),
  ignoreList: z.array(z.string()),
  theme: z.enum(['light', 'auto']),
});

// 启动时校验
export async function validateStorage(): Promise<void> {
  const settings = await getItem('settings');
  if (settings) {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
      console.warn('settings schema 校验失败,使用默认', parsed.error);
      await setItem('settings', DEFAULT_SETTINGS);
    }
  }
}
```

**为什么用 zod**：
- 跨版本迁移需要 schema 校验
- 用户从老版本升级时,旧数据可能缺字段
- zod 提供运行时校验 + TS 类型推断,一套解决

**安装**：
```bash
npm install zod
```

---

## 8. 测试要点

```typescript
describe('storage', () => {
  test('initStorage 设置默认值', async () => { /* ... */ });
  test('getItem / setItem 读写一致', async () => { /* ... */ });
  test('加密项密文存储,明文不可见', async () => {
    await setEncryptedItem('test', { secret: 'hello' }, 'master');
    const raw = await chrome.storage.local.get('test.encrypted');
    expect(raw['test.encrypted'].ciphertext).not.toContain('hello');
  });
  test('clearSession 清空所有 session 项', async () => { /* ... */ });
  test('quota 检查', async () => { /* ... */ });
});
```
