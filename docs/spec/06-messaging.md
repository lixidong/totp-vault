# SPEC 06: 消息协议

> **目的**：Content Script / Popup / Options Page 与 Service Worker 之间的通信契约
> **对应文件**：`src/libs/messaging/`（protocol.ts, handlers/background.ts, handlers/content.ts, handlers/popup.ts, session.ts）
> **依赖**：[01-types.md](./01-types.md)
> **被依赖**：[05-fill.md](./05-fill.md), [09-popup.md](./09-popup.md), [10-options.md](./10-options.md)

---

## 1. 通道总览

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Popup        │         │ Content      │         │ Options      │
│ (UI)         │         │ (注入页面)    │         │ (UI)         │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       │  chrome.runtime.sendMessage                     │
       └────────────────────────┼────────────────────────┘
                                ▼
                       ┌────────────────┐
                       │ Service Worker │
                       │ (唯一能解密)    │
                       └────────────────┘
```

**单一入口**：所有 UI 都通过 `chrome.runtime.sendMessage` 与 SW 通信。
**不直连**：UI 之间（Popup ↔ Content）**不**直接通信，必须经 SW 中转。

---

## 2. 消息类型

详见 [01-types.md](./01-types.md) §3，本 SPEC 只描述**运行时行为**。

### 2.1 同步 vs 异步

| 模式 | 适用 | 备注 |
|---|---|---|
| 同步（`sendResponse`） | 简单查询（`isUnlocked` / `getSettings`） | < 100ms 完成 |
| 异步（返回 Promise） | 复杂操作（`unlock` / `listAccounts` / `createAccount`） | 涉及 KDBX 解密/上传 |

**约定**：
- SW handler 总是**异步**返回 Promise
- 发送方**必须** `return true` 保留 sendResponse 通道（如果用 callback）
- 或用 Promise-based API（推荐）

### 2.2 错误传播

```typescript
// SW 内部
chrome.runtime.onMessage.addListener(async (msg, sender) => {
  try {
    const data = await handle(msg);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.code || 'UNKNOWN', message: e.userMessage };
  }
});
```

```typescript
// 调用方
const response = await chrome.runtime.sendMessage(msg);
if (!response.ok) {
  showError(response.error, response.message);
}
```

详见 [01-types.md](./01-types.md) §3.2 ErrorCode 列表。

---

## 3. 短期 Session 票据

**问题**：SW 持有主密码派生的密钥，但 Content Script 不能直接调用 SW 的密钥派生函数（异步 + 跨上下文）。

**方案**：SW 解锁后，颁发一个**短期票据**给请求方，请求方在票据有效期内可调用部分 API。

### 3.1 票据结构

```typescript
type SessionToken = {
  /** 颁发时间 */
  issuedAt: number;
  /** 过期时间（默认 5 分钟后） */
  expiresAt: number;
  /** 票据 ID（用于日志追踪） */
  tokenId: string;
  /** 颁发给的 sender.tab.id 或 sender */
  scope: 'popup' | 'content' | 'options';
};
```

**存哪里**：
- **Popup**：在内存中（popup 关闭即失效）
- **Content**：**不存** Content Script 不需要票据，每次操作都发请求
- **Options**：在内存中（同 popup）

### 3.2 颁发流程

```typescript
// SW 侧
const SESSION_TTL_MS = 5 * 60 * 1000;  // 5 分钟

async function issueSession(scope: 'popup' | 'options'): Promise<SessionToken> {
  const now = Date.now();
  const token: SessionToken = {
    issuedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    tokenId: crypto.randomUUID(),
    scope,
  };
  // 存到 chrome.storage.session
  const key = `session.${token.tokenId}`;
  await chrome.storage.session.set({ [key]: token });
  return token;
}

function isValidSession(token: SessionToken | null): boolean {
  if (!token) return false;
  return token.expiresAt > Date.now();
}
```

### 3.3 使用流程

```typescript
// Popup 启动
const token = await chrome.runtime.sendMessage({ type: 'session.issue', scope: 'popup' });
// 之后所有请求带 token
const accounts = await chrome.runtime.sendMessage({
  type: 'listAccounts',
  sessionToken: token,
});
```

**约束**：
- **不强制**每个请求都验证（v2 简化：UI 启动时验证一次就行）
- SW 内部 `_repo` 为空时，**所有**业务请求返回 `NOT_UNLOCKED`，**不论有没有 token**
- 5 分钟后 token 过期，UI 自动跳回解锁页

### 3.4 自动锁定

```typescript
let lastActivity = Date.now();
chrome.alarms.create('activity-check', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'activity-check') return;
  if (Date.now() - lastActivity > settings.autoLockMinutes * 60 * 1000) {
    clearRepository();
    notifyAllUI({ type: 'locked' });
  }
});

// 收到任何业务请求都更新 lastActivity
chrome.runtime.onMessage.addListener((msg) => {
  lastActivity = Date.now();
});
```

---

## 4. Content Script 消息

### 4.1 Content → SW

```typescript
type ContentMessage =
  | { type: 'matchAccountsForUrl'; url: string }
  | { type: 'getCurrentTOTP'; accountId: string }
  | { type: 'account.touchLastUsed'; id: string }  // 用户刚用了,更新 lastUsedAt
  | { type: 'save.request'; data: { url: string; username: string; password: string } }
  | { type: 'fill.request'; accountId: string };  // 用户在 picker 选了一个
```

### 4.2 SW → Content

```typescript
type ContentPush =
  | { type: 'locked' }  // 触发 UI 重置
  | { type: 'sync.status'; status: 'idle' | 'syncing' | 'conflict' | 'error' };
```

**推送方式**：
```typescript
// SW 侧
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'locked' }).catch(() => {});
  }
});
```

**约束**：
- Content Script **不**接收 `lock` 推送
- 锁定时，Content Script 下次请求会自然得到 `NOT_UNLOCKED`

---

## 5. Popup / Options 消息

### 5.1 UI → SW

**所有** [01-types.md](./01-types.md) §3.1 的 Request 都可以从 UI 发。

**额外**：
```typescript
| { type: 'session.issue'; scope: 'popup' | 'options' }
| { type: 'session.revoke'; tokenId: string }
| { type: 'verifyMasterPassword'; password: string }  // 用于"修改主密码"流程
| { type: 'changeMasterPassword'; oldPassword: string; newPassword: string }
```

### 5.2 SW → UI

```typescript
type UIPush =
  | { type: 'locked' }
  | { type: 'sync.status'; status: SyncStatus; detail?: string }
  | { type: 'account.created'; account: Account }
  | { type: 'account.updated'; account: Account }
  | { type: 'account.deleted'; id: string }
  | { type: 'sync.conflict'; conflicts: ConflictRecord[] };
```

**UI 侧**：
```typescript
// popup/options 入口
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'locked') {
    setState('unlock');
  } else if (msg.type === 'sync.status') {
    setSyncStatus(msg.status);
  } else if (msg.type === 'account.created') {
    addAccountToList(msg.account);
  } // ...
});
```

---

## 6. 长连接（可选）

**问题**：Popup 列表需要实时反映后台变更（用户在 content 注册新账号后，popup 也要看到）。

**方案**：
- v2 简化：Popup 打开时拉一次 `listAccounts`，**不**订阅
- 用户手动刷新 = 关闭再打开 popup
- v3 候选：长连接 / chrome.runtime.connect

**约束**：避免实现复杂的订阅机制，v2 接受"popup 反映稍微滞后"。

---

## 7. 错误处理示例

```typescript
// libs/messaging/send.ts
export async function sendMessage<T = unknown>(msg: Request): Promise<T> {
  const response: Response = await chrome.runtime.sendMessage(msg);
  if (!response.ok) {
    const err = new Error(response.message);
    (err as any).code = response.error;
    throw err;
  }
  return response.data as T;
}

// 使用
try {
  const accounts = await sendMessage<Account[]>({ type: 'listAccounts' });
} catch (e: any) {
  if (e.code === 'NOT_UNLOCKED') {
    setState('unlock');
  } else if (e.code === 'WEBDAV_NETWORK_ERROR') {
    showToast('网络不可用，已缓存到本地', 'warning');
  } else {
    showToast('出错了：' + e.message, 'error');
  }
}
```

---

## 8. 测试要点

```typescript
describe('messaging', () => {
  test('未解锁时调用 listAccounts 返回 NOT_UNLOCKED', async () => {
    const res = await sendMessage({ type: 'listAccounts' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('NOT_UNLOCKED');
  });

  test('解锁后 listAccounts 正常返回', async () => { /* ... */ });

  test('session.issue 颁发后 5 分钟内有效', async () => { /* ... */ });

  test('Content Script 不能直接调用 getRepository', () => {
    // SW 端测试: 验证只有 background.ts 能 import libs/kdbx
    // 静态检查：tsconfig + ESLint 规则限制 import 路径
  });
});
```
