# SPEC 09: Popup UI

> **目的**：浏览器工具栏点击扩展图标后弹出的主交互界面
> **对应文件**：`src/entrypoints/popup/`（index.html, main.tsx, App.tsx, components/*）
> **依赖**：[01-types.md](./01-types.md), [02-kdbx.md](./02-kdbx.md), [04-totp.md](./04-totp.md), [06-messaging.md](./06-messaging.md), [07-storage.md](./07-storage.md)
> **被依赖**：[05-fill.md](./05-fill.md)（AccountPicker 契约）, [10-options.md](./10-options.md)

---

## 1. 屏幕尺寸

- 弹窗固定 400 × 600 px
- 滚动：内容超过 600 px 时弹窗内滚动，**不**撑大
- 字体：14 px / 行高 1.5
- 主题：浅色（v2 暂不做暗色，预留 theme 字段）

---

## 2. 状态机

```
[Start]
   ↓ SW isUnlocked?
   ├─ false → [Unlock]
   │           ↓ 输对密码
   │           ↓ → [Main]
   └─ true  → [Main]

[Main]  ← 唯一"主界面"
   ↓ 用户操作
   ├─ 点 [+] → [Edit] (新建账号)
   ├─ 点 [⚙] → 打开 Options Page
   ├─ 点账号行 → [Detail]
   ├─ 点 [复制] TOTP 码 → 复制到剪贴板 + Toast
   └─ 收到 sync.status / locked 推送 → 顶部状态条更新

[Edit]
   ├─ 点 [保存] → 触发 SW createAccount/updateAccount → [Main]
   ├─ 点 [取消] → [Main]
   └─ 点 [添加 TOTP] → [TOTPBing]
```

**约束**：
- **不**用 URL hash 路由（popup 简单，组件 state 即可）
- **不**做"返回上一页"逻辑（[Edit] / [TOTPBing] 都是 modal 形式覆盖在 [Main] 上）
- ESC 键关闭 [Edit] / [TOTPBing]

---

## 3. 组件清单

### 3.1 UnlockScreen

**Props**：
```typescript
type UnlockScreenProps = {
  onUnlocked: () => void;
};
```

**UI**：
```
┌────────────────────────────┐
│                            │
│       [扩展图标]            │
│                            │
│   ┌────────────────────┐   │
│   │ 主密码              │   │
│   └────────────────────┘   │
│                            │
│   [    解  锁    ]          │
│                            │
│   配置 WebDAV →             │
│                            │
└────────────────────────────┘
```

**交互**：
- 输密码 → 调 `unlock(password)` → 成功跳 [Main]
- 失败：密码框红边 + 抖动 + 错误提示"主密码错误"
- 输错 3 次后：5 秒内禁止重试（防爆破）
- "配置 WebDAV" 链接：跳到 Options Page 配 webdav 凭据

### 3.2 Main

**Props**：
```typescript
type MainProps = {
  accounts: Account[];
  syncStatus: SyncStatus;
  onSelectAccount: (id: string) => void;
  onCreate: () => void;
  onOpenOptions: () => void;
};
```

**UI**：
```
┌──────────────────────────────────────┐
│ 密码库  (30)            [+] [⚙]     │ ← 顶部栏
│ 状态: ● 已同步      上次同步: 10:23  │ ← 同步状态
├──────────────────────────────────────┤
│ 🔍 搜索...                          │ ← 搜索框(v3)
├──────────────────────────────────────┤
│ GitHub                              │
│   alice@example.com      287 082     │ ← TOTP 实时显示
│   [📋 复制] [详情]                  │
├──────────────────────────────────────┤
│ AWS                                 │
│   work@company.com       451 920     │
│   [📋 复制] [详情]                  │
├──────────────────────────────────────┤
│ ... (滚动)                           │
└──────────────────────────────────────┘
```

**TOTP 实时显示**：
- 每个带 TOTP 的账号**直接显示**当前验证码
- 每秒倒计时刷新（基于校准后时间）
- 临近过期（< 5s）时变橙色
- 点 [📋 复制] 把 TOTP 复制到剪贴板，2 秒后 Toast"已复制"

### 3.3 AccountDetail

**Props**：
```typescript
type AccountDetailProps = {
  account: Account;
  onEdit: () => void;
  onBindTOTP: () => void;
  onUnbindTOTP: () => void;
  onDelete: () => void;
};
```

**UI**：
```
┌──────────────────────────────────────┐
│ ← 返回       GitHub                  │
├──────────────────────────────────────┤
│ 用户名:  alice@example.com           │
│ 密码:    ●●●●●●●●  [👁 显示]        │
│ 网址:    https://github.com          │
│ 备注:    work account               │
│                                      │
│ TOTP:   287 082  (剩 18s)            │
│         [📋 复制] [🗑 解除绑定]      │
│                                      │
│ [编辑]  [删除]                       │
└──────────────────────────────────────┘
```

**密码显示/隐藏**：
- 默认 `●●●●●●●●`（8 个圆点，与长度无关）
- 点 [👁 显示] 切到明文，5 秒后自动隐藏
- 点明文 → 复制到剪贴板

**删除**：
- 弹"确认删除？账号 'GitHub alice@example.com' 将从 KDBX 移除"二次确认
- 选 [是] → 调 `deleteAccount` → 跳 [Main]

### 3.4 AccountPicker（同时用于 Content Script 注入）

详见 [05-fill.md §4.3](./05-fill.md)。Popup 内的 picker 与 Content 注入的 picker **共享视觉风格**，但 popup 内用 React 组件，Content 内用纯 DOM + ShadowRoot。

**简化版 props**（popup 内）：
```typescript
type PickerProps = {
  accounts: Account[];
  onSelect: (account: Account) => void;
};
```

### 3.5 ConflictResolver

**Props**：
```typescript
type ConflictResolverProps = {
  conflicts: ConflictRecord[];
  onResolve: (choice: { accountId: string; field: string; keep: 'local' | 'remote' }) => void;
};
```

**UI**：
```
┌──────────────────────────────────────┐
│ 同步冲突 (1)                          │
├──────────────────────────────────────┤
│ GitHub (alice@example.com)           │
│   TOTP secret 不一致:                │
│                                      │
│   本地:  •••• K3PX (更新于 10:15)     │
│   远端:  •••• 7XQR (更新于 10:18)     │
│                                      │
│   [保留本地] [保留远端]               │
└──────────────────────────────────────┘
```

**触发条件**：[03-webdav.md §4](./03-webdav.md) 的 merge 流程产生 conflicts。

### 3.6 AccountForm

**Props**：
```typescript
type AccountFormProps = {
  initial?: Account;  // 不传 = 新建
  onSave: (data: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
};
```

**字段**：
- 网址（必填，校验 origin 形式）
- 用户名（必填）
- 密码（必填，可"显示"切换）
- 备注（可选）
- 不显示 TOTP 字段 → 跳 TOTPBing 组件

### 3.7 TOTPBindingForm

**Props**：
```typescript
type TOTPBindingFormProps = {
  initial?: TOTPBinding;
  onSave: (binding: TOTPBinding) => void;
  onCancel: () => void;
};
```

**字段**：
- Secret (base32)（必填）
- 算法（SHA1 / SHA256 / SHA512）
- 位数（6 / 8）
- 周期（30s / 60s）
- Issuer（可选）

**输入辅助**：
- 接受 `otpauth://` URI 粘贴，自动解析
- 实时显示"当前码"预览

### 3.8 ImportExportPanel

**Props**：
```typescript
type ImportExportPanelProps = {
  onImport: (format: 'json' | 'kdbx') => void;
  onExport: (format: 'json' | 'kdbx' | 'otpauth-uri') => void;
};
```

详见 §5 导入导出。

### 3.9 ErrorToast

**Props**：
```typescript
type ErrorToastProps = {
  error: ErrorCode;
  message: string;
  onDismiss: () => void;
};
```

**约束**：
- 错误码 ↔ i18n key 映射（v2 简化为内嵌字典，不引 i18n 库）
- 5 秒后自动消失
- 关键错误（如 KDBX 损坏）持久显示直到用户关闭

---

## 4. 状态管理

```typescript
// popup/App.tsx
type AppState =
  | { view: 'unlock' }
  | { view: 'main' }
  | { view: 'detail'; accountId: string }
  | { view: 'edit'; accountId?: string }
  | { view: 'totp'; accountId: string }
  | { view: 'conflicts' };

type AppContext = {
  state: AppState;
  accounts: Account[];
  syncStatus: SyncStatus;
  settings: AppSettings;
  dispatch: (action: AppAction) => void;
};
```

**Action**：
```typescript
type AppAction =
  | { type: 'unlock.success' }
  | { type: 'lock' }
  | { type: 'open.detail'; accountId: string }
  | { type: 'open.edit'; accountId?: string }
  | { type: 'open.totp'; accountId: string }
  | { type: 'open.conflicts' }
  | { type: 'back.to.main' }
  | { type: 'accounts.set'; accounts: Account[] }
  | { type: 'sync.status'; status: SyncStatus };
```

**约束**：
- 用 `useReducer` 而非多个 `useState`
- 任何 UI 操作都发 action，**不**直接调 SW（除 fetch 业务数据外）

---

## 5. 导入导出 UI 流程

### 5.1 导出

入口：Main 顶部 [⚙] → 跳 Options Page → ExportPanel。

**v2 简化**：导出按钮**只在 Options Page**（不在 Popup）。原因：导出文件需要"下载"动作，Popup 弹窗下载交互差。

### 5.2 导出 JSON 二次确认

```typescript
async function exportJSON() {
  const confirmed = await showConfirmDialog({
    title: '导出明文 JSON',
    body: 'JSON 文件包含所有账号的明文密码。\n\n任何人拿到这个文件 = 拿到你所有密码。\n\n请确认:',
    confirmText: '我已了解风险,继续导出',
    dangerous: true,
  });
  if (!confirmed) return;

  const json = await sendMessage({ type: 'exportAccounts', format: 'json' });
  downloadFile(`totp-vault-${Date.now()}.json`, JSON.stringify(json, null, 2));
}
```

### 5.3 导出 otpauth URI

```typescript
async function exportOtpauth() {
  const uris = await sendMessage({ type: 'exportAccounts', format: 'otpauth-uri' });
  // uris 是字符串数组
  downloadFile('otpauth-uris.txt', uris.join('\n'));
}
```

### 5.4 导入

入口：Options Page → ImportPanel。

**流程**：
1. 用户选文件（`.json` / `.kdbx`）
2. 读字节流/解析 JSON
3. 显示预览："找到 30 个账号"
4. 用户选择合并策略（[覆盖] / [跳过] / [手动]）
5. 调 `importAccounts(accounts, mergeStrategy)`
6. SW 返回结果（"成功导入 28 个,跳过 2 个"）

---

## 6. 同步状态条

```typescript
function SyncStatusBar({ status }: { status: SyncStatus }) {
  return (
    <div className="sync-bar">
      <span className={`dot ${status}`} />
      {status === 'idle' && '已同步'}
      {status === 'syncing' && '同步中...'}
      {status === 'conflict' && <button>有冲突需解决</button>}
      {status === 'error' && '同步失败 (查看)'}
    </div>
  );
}
```

**颜色**：
- `idle` 绿
- `syncing` 灰（旋转）
- `conflict` 红
- `error` 黄

---

## 7. 键盘快捷键

| 键 | 作用 |
|---|---|
| `Enter` (UnlockScreen) | 解锁 |
| `↑` / `↓` (Main) | 上下选中账号 |
| `Enter` (Main 选中) | 打开 Detail |
| `Esc` (Detail/Edit) | 返回 Main |
| `Ctrl/Cmd + F` (Main) | 聚焦搜索框 |
| `Ctrl/Cmd + N` (Main) | 新建账号 |

**v2 范围**：v2 仅实现前 4 个，其余为 v3 候选。

---

## 8. 性能要求

- **冷启动**（点扩展图标 → 显示列表）：< 500ms
  - 已解锁时：直接显示缓存的列表
  - 未解锁时：显示 UnlockScreen（输密码后才去拉数据）
- **TOTP 实时刷新**：每秒更新一次，**不**全表 re-render（用 key 局部更新）
- **列表滚动**：60fps（< 30 条规模基本无压力）

---

## 9. 无障碍 (a11y)

v2 范围：
- ✅ 所有按钮有 `aria-label`
- ✅ 表单字段有 `<label>` 关联
- ✅ 键盘可完全操作
- ❌ 屏幕阅读器深度测试（v3 候选）

---

## 10. 测试要点

```typescript
// tests/unit/popup.test.tsx (Vitest + React Testing Library)
describe('Popup', () => {
  test('未解锁时显示 UnlockScreen', () => { /* ... */ });
  test('解锁成功后跳 Main, 列表渲染', () => { /* ... */ });
  test('点 [+] 跳 Edit', () => { /* ... */ });
  test('点 [保存] 调 createAccount, 跳回 Main', () => { /* ... */ });
  test('TOTP 倒计时正确刷新', () => { /* ... */ });
  test('locked 推送触发跳 Unlock', () => { /* ... */ });
});

// tests/e2e/popup.test.ts (Playwright)
describe('端到端', () => {
  test('点扩展图标 → 输密码 → 看到账号列表', async () => { /* ... */ });
  test('复制 TOTP 到剪贴板', async () => { /* ... */ });
});
```
