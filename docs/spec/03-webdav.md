# SPEC 03: WebDAV 同步

> **目的**：定义 KDBX 文件怎么上传/下载/合并
> **对应文件**：`src/libs/webdav/`（client.ts, sync.ts, config.ts）
> **依赖**：[01-types.md](./01-types.md), [02-kdbx.md](./02-kdbx.md), [07-storage.md](./07-storage.md)
> **被依赖**：[08-security.md](./08-security.md), [10-options.md](./10-options.md), [12-roadmap.md](./12-roadmap.md)

---

## 1. 库选型

| 候选 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| `webdav` (npm, 5.x) | 纯 JS, 无 native, 活跃维护, TS 友好 | 包较大 (~50KB) | ✅ 选这个 |
| `dav` (npm) | 轻量 | 7 年没更新, 不支持 PROPFIND | ❌ |
| 自己用 fetch 写 | 0 依赖 | RFC 4918 子集自己处理 PROPFIND/LOCK 等 | ❌ 工作量大, 没必要 |

**安装**：
```bash
npm install webdav@5
```

---

## 2. 客户端封装（client.ts）

### 2.1 实例化

```typescript
import { createClient } from 'webdav';

export function createWebDAVClient(config: DecryptedWebDAVConfig) {
  return createClient(config.url, {
    username: config.username,
    password: config.appPassword,  // 应用专用密码,非登录密码
  });
}
```

**约束**：
- `config` **必须**是解密后的明文结构，**不**接受 EncryptedBlob
- 调用方负责先解密（见 §6）
- 客户端实例**不**长期持有，每次操作都新建（避免 SW 休眠后句柄失效）

### 2.2 核心方法

| 方法 | 用途 | 错误处理 |
|---|---|---|
| `client.getFileContents(remotePath)` | 下载 | 401/403 → `WEBDAV_AUTH_FAILED`；网络错误 → `WEBDAV_NETWORK_ERROR` |
| `client.putFileContents(remotePath, bytes, { onUploadProgress? })` | 上传 | 同上 |
| `client.stat(remotePath)` | 拿 ETag | 不存在 → 抛 WebDAVError |
| `client.exists(remotePath)` | 存在性检查 | — |
| `client.createDirectory(path, { recursive: true })` | 首次创建目录 | 已存在不报错 |

### 2.3 ETag 提取

```typescript
async function fetchETag(client: WebDAVClient, path: string): Promise<string | null> {
  try {
    const stat = await client.stat(path);
    return stat.etag ?? null;
  } catch {
    return null;
  }
}
```

**约束**：
- ETag 头可能是强 ETag（`"abc123"`）或弱 ETag（`W/"abc123"`），v2 强/弱都接受
- 上传时 `If-Match` 头用强 ETag 形式（即原样返回）

---

## 3. 同步流程（sync.ts）

### 3.1 状态机

```
[未配置] ──setWebDAVConfig()──> [已配置未解锁]
[已配置未解锁] ──unlock()──> [已解锁]
[已解锁] ──修改 KDBX──> [有未同步变更]
[有未同步变更] ──syncNow()──> [已同步]
[有未同步变更] ──5 分钟无操作──> [自动同步]
[任意状态] ──lock()──> [已锁定]
```

### 3.2 解锁时的下载逻辑

```typescript
async function downloadOnUnlock(): Promise<Uint8Array> {
  const client = createWebDAVClient(decryptedConfig);
  const localETag = await getLocalETag();

  try {
    const remoteStat = await client.stat(config.remotePath);
    const remoteETag = remoteStat.etag;

    if (localETag && localETag === remoteETag) {
      // 本地缓存仍是最新,直接用 IndexedDB 缓存的加密字节流
      return await getCachedBytes();
    }

    // 远端有更新, 下载
    const bytes = await client.getFileContents(config.remotePath);
    await cacheBytes(bytes);
    await setLocalETag(remoteETag);
    return new Uint8Array(bytes);
  } catch (e) {
    if (isNotFound(e)) {
      // 首次使用,创建空 KDBX
      const empty = kdbxweb.Kdbx.create(/* ... */);
      const bytes = await empty.save();
      await client.putFileContents(config.remotePath, bytes);
      return bytes;
    }
    throw e;
  }
}
```

**首次配置**：
- 检测到远端无 `sync.kdbx` → 本地创建空 KDBX → 上传 → 拿到 ETag → 存 `.meta.json`
- **不覆盖**用户远端已有的 `sync.kdbx`（即使本地空）

### 3.3 保存时的上传逻辑

```typescript
async function uploadOnChange(bytes: Uint8Array): Promise<void> {
  const client = createWebDAVClient(decryptedConfig);
  const localETag = await getLocalETag();

  // 乐观锁: 如果本地 ETag 不为空,带 If-Match
  const headers: Record<string, string> = {};
  if (localETag) headers['If-Match'] = localETag;

  try {
    const newETag = await client.putFileContents(config.remotePath, bytes, { headers });
    await setLocalETag(newETag);
    await cacheBytes(bytes);
  } catch (e) {
    if (isPreconditionFailed(e)) {
      // 412, 进入冲突合并流程
      await handleConflict(bytes);
    } else {
      throw e;
    }
  }
}
```

### 3.4 防抖

```typescript
let pendingBytes: Uint8Array | null = null;
let timer: number | null = null;

export function scheduleUpload(bytes: Uint8Array) {
  pendingBytes = bytes;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (pendingBytes) uploadOnChange(pendingBytes);
    pendingBytes = null;
    timer = null;
  }, 1500);  // 1.5 秒
}
```

**为什么 1.5 秒**：
- 太短（< 500ms）：连续编辑账号会触发多次上传
- 太长（> 3s）：用户关浏览器前最新修改可能没传上去
- 1.5 秒是经验值，覆盖"打字停顿"场景

### 3.5 自动同步

```typescript
chrome.alarms.create('auto-sync', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'auto-sync') return;
  if (!isUnlocked()) return;

  // 静默检查远端是否有新版本
  const remoteETag = await fetchETag(...);
  if (remoteETag && remoteETag !== await getLocalETag()) {
    // 静默下载, 提示用户"已自动同步新版本"
    await downloadOnUnlock();
  }
});
```

**约束**：
- 5 分钟一次，**仅做下载不做上传**（避免被手机端的"未保存修改"覆盖）
- 检测到新版本时**不自动切换**到新 KDBX（避免打断用户正在用的账号）
- 而是把新 KDBX 暂存，提示用户"检测到手机端有新变更，是否刷新？"（v2 范围外，**v3 再说**）

---

## 4. 冲突合并（handleConflict）

见 [02-kdbx.md](./02-kdbx.md) §6 的合并算法。

**完整流程**：
```
[本地有变更, 上传 412] → handleConflict(localBytes)
   ↓
1. 下载远端最新: remoteBytes = client.getFileContents(...)
   ↓
2. 解锁远端: remoteDb = kdbxweb.Kdbx.load(remoteBytes, password)
   ↓
3. entry 级合并: { merged, conflicts } = mergeKdbx(localDb, remoteDb)
   ↓
4. 如果 conflicts 为空:
     序列化为 bytes → 不带 If-Match 强上传 → 成功
   ↓
5. 如果 conflicts 不为空:
     暂存 conflicts 状态到 chrome.storage.local
     chrome.runtime.sendMessage({ type: 'sync.conflict', conflicts }) → Popup 弹窗
     用户在 Popup 解决 → 重新触发上传
```

**用户操作**：
- 在 Popup 看到"TOTP 冲突：GitHub 账号，两端都改了"
- 选项：[保留本地] / [保留远端] / [手动合并]
- 选定后调用 `mergeKdbx(..., userChoice)` 重做合并

---

## 5. .meta.json

```json
{
  "schemaVersion": 1,
  "deviceId": "uuid-of-this-device",
  "lastSyncAt": "2026-06-06T10:00:00Z",
  "lastETag": "\"abc123def456\"",
  "lastKdfParams": {
    "function": "Argon2id",
    "memory": 65536,
    "iterations": 3,
    "parallelism": 1
  }
}
```

**约束**：
- **不存**主密码或任何敏感信息
- `lastKdfParams` 缓存派生参数，下次解锁时延后调整 KDF 时使用
- `deviceId` 用 `crypto.randomUUID()` 生成，本地持久化

**存哪里**：
- v2 简化：`.meta.json` **不上传**，仅存本地 `chrome.storage.local`
- 远端 ETag 直接从响应头拿，**不**依赖元数据文件
- 真要诊断多设备冲突时，再写一个远程 `.meta.json` 即可（v2 范围外）

---

## 6. WebDAV 凭据加解密（config.ts）

详见 [08-security.md](./08-security.md) §3.2 deviceKey 机制。

**简述**：
```typescript
// 设置时
export async function setWebDAVConfig(
  config: WebDAVConfig,
  masterPassword: string
): Promise<void> {
  const deviceKey = await deriveDeviceKey(masterPassword);
  const encrypted = await encryptJSON(config, deviceKey);
  await chrome.storage.local.set({ webdavConfig: encrypted });
}

// 读取时
export async function getWebDAVConfig(
  masterPassword: string
): Promise<WebDAVConfig | null> {
  const stored = await chrome.storage.local.get('webdavConfig');
  if (!stored.webdavConfig) return null;
  const deviceKey = await deriveDeviceKey(masterPassword);
  return await decryptJSON(stored.webdavConfig, deviceKey);
}
```

**约束**：
- **每次**同步操作都需要 `masterPassword` 解密 deviceKey
- 这意味着 SW 持有主密码的状态**不可被回收**——这是 v2 接受的设计（5 分钟无操作清空）
- **不允许**在 Service Worker 之外解密（Content Script 永远拿不到明文凭据）

---

## 7. 错误处理

| WebDAV 错误 | ErrorCode | 用户提示 |
|---|---|---|
| 401 / 403 | `WEBDAV_AUTH_FAILED` | "WebDAV 账号或应用密码错误" |
| 404 (stat 时) | 视情况 | 首次解锁会创建新库；其他情况提示"文件不存在" |
| 412 Precondition Failed | `WEBDAV_CONFLICT` | 静默触发合并流程，不直接弹错误 |
| 5xx | `WEBDAV_NETWORK_ERROR` | "WebDAV 服务异常，请稍后重试" |
| 网络断开 | `WEBDAV_NETWORK_ERROR` | "网络不可用，已缓存到本地，联网后自动同步" |
| 磁盘配额 | `WEBDAV_QUOTA_EXCEEDED` | "云盘空间不足" |

**重试策略**：
- 网络错误：指数退避，最多 3 次（1s / 4s / 16s）
- 401：直接报错，不重试（重试无意义）
- 412：不重试，进入冲突流程
- 5xx：指数退避 3 次后报错

---

## 8. 同步状态通知

```typescript
// libs/webdav/sync.ts
type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'error';

chrome.runtime.sendMessage({ type: 'sync.status', status: 'syncing' });
// ... 操作
chrome.runtime.sendMessage({ type: 'sync.status', status: 'idle' });
```

**Popup 监听** `sync.status` 消息，刷新顶部状态栏（小图标 / 文字）：
- 静止：绿点 "已同步"
- 同步中：旋转图标 "同步中..."
- 冲突：红点 "有冲突需解决"
- 错误：黄点 "同步失败"

---

## 9. 测试要点

```typescript
// tests/unit/webdav.test.ts
describe('WebDAV sync', () => {
  test('首次配置：远端无文件, 本地创建并上传', async () => { /* ... */ });
  test('解锁：远端 ETag 一致, 用本地缓存', async () => { /* ... */ });
  test('解锁：远端 ETag 不一致, 下载新版本', async () => { /* ... */ });
  test('上传：本地 ETag 一致, 成功', async () => { /* ... */ });
  test('上传：412 Precondition Failed, 触发合并', async () => { /* ... */ });
  test('冲突合并：entry 级别不重叠, 全部保留', async () => { /* ... */ });
  test('冲突合并：totp 冲突, 进入用户决策队列', async () => { /* ... */ });
});

// tests/e2e/webdav.test.ts (Playwright + 本地 httpdav server)
describe('端到端', () => {
  test('扩展加载 → 配置坚果云 mock → 添加账号 → 重启扩展 → 数据保持', async () => { /* ... */ });
});
```
