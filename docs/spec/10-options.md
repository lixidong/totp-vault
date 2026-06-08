# SPEC 10: Options Page

> **目的**：扩展的"设置"页，承载 WebDAV 配置、导入导出、安全设置
> **对应文件**：`src/entrypoints/options/`（index.html, main.tsx, App.tsx, WebDAVConfig.tsx, AutoLockConfig.tsx, ImportPanel.tsx, ExportPanel.tsx, ChangePasswordPanel.tsx）
> **依赖**：[01-types.md](./01-types.md), [03-webdav.md](./03-webdav.md), [06-messaging.md](./06-messaging.md), [07-storage.md](./07-storage.md), [08-security.md](./08-security.md)
> **被依赖**：无

---

## 1. 页面入口

- 入口：浏览器 `chrome://extensions` → 扩展详情 → "扩展程序选项"（或 popup 顶部的 [⚙] 链接）
- MV3 必须在 manifest.json 声明 `options_ui`：

```json
{
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- 独立 tab 打开（`open_in_tab: true`），不受 popup 400×600 限制

---

## 2. 布局

```
┌────────────────────────────────────────────────┐
│  [扩展图标] totp-vault             状态: ● 已同步 │
├────────────┬───────────────────────────────────┤
│            │                                   │
│  导航       │                                   │
│            │   主内容区（随导航切换）              │
│  ▸ 同步    │                                   │
│    WebDAV  │                                   │
│            │                                   │
│  ▸ 安全    │                                   │
│    主密码   │                                   │
│    自动锁定 │                                   │
│            │                                   │
│  ▸ 数据    │                                   │
│    导入     │                                   │
│    导出     │                                   │
│            │                                   │
│  ▸ 关于    │                                   │
│    版本     │                                   │
│    许可     │                                   │
│            │                                   │
└────────────┴───────────────────────────────────┘
```

- 左侧固定 200px 导航
- 右侧主内容滚动
- 顶部状态条显示同步状态（同 [09-popup.md §6](./09-popup.md)）

---

## 3. WebDAV 配置页

### 3.1 WebDAVConfig 组件

```typescript
type WebDAVConfigProps = {
  initialConfig: WebDAVConfig | null;
  onSave: (config: WebDAVConfig) => void;
  onTest: (config: WebDAVConfig) => Promise<TestResult>;
};
```

**UI（首次配置）**：
```
┌────────────────────────────────────────┐
│ WebDAV 配置                            │
├────────────────────────────────────────┤
│ 还没配置过 WebDAV 服务。                  │
│                                        │
│ 选一个服务:                              │
│   ○ 坚果云 (推荐)                       │
│   ○ 自建 NAS (WebDAV 协议)              │
│   ○ 其他                                │
│                                        │
│ 服务 URL *                              │
│ ┌────────────────────────────────────┐ │
│ │ https://dav.jianguoyun.com/dav/    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ 用户名 *                                │
│ ┌────────────────────────────────────┐ │
│ │ alice@example.com                  │ │
│ └────────────────────────────────────┘ │
│                                        │
│ 应用密码 * (不是登录密码)                │
│ ┌────────────────────────────────────┐ │
│ │ ••••••••••••            [👁 显示]  │ │
│ └────────────────────────────────────┘ │
│ ℹ 在坚果云"账户信息→安全选项"生成         │
│                                        │
│ KDBX 远程路径                            │
│ ┌────────────────────────────────────┐ │
│ │ totp-vault/sync.kdbx              │ │
│ └────────────────────────────────────┘ │
│                                        │
│ [测试连接]    [保存]                    │
└────────────────────────────────────────┘
```

**UI（已配置）**：
```
┌────────────────────────────────────────┐
│ WebDAV 配置       已连接 ✓              │
├────────────────────────────────────────┤
│ 服务 URL:  https://dav.jianguoyun.com/...│
│ 用户名:    alice@example.com           │
│ 应用密码:  ••••••••••••  [更改]        │
│ 远程路径:  totp-vault/sync.kdbx       │
│                                        │
│ 上次同步:  2026-06-06 10:23:45         │
│ 远端 ETag:  "abc123def"                │
│                                        │
│ [立即同步]  [测试连接]  [重置配置]      │
└────────────────────────────────────────┘
```

### 3.2 "重置配置"流程

```typescript
async function resetConfig() {
  // 1. 弹二次确认
  const ok = await showConfirm({
    title: '重置 WebDAV 配置',
    body: '将清除当前 webdav 凭据,所有本地数据保留。重置后需重新配置。',
    confirmText: '重置',
  });
  if (!ok) return;

  // 2. 调用 SW 清空
  await sendMessage({ type: 'resetWebDAVConfig' });

  // 3. 跳回"未配置"状态
  setState({ config: null });
}
```

**v2 简化**：重置**仅**清空 webdavConfig，**不**清空 KDBX 缓存。KDBX 在用户重连 webdav 后从云端拉回。

### 3.3 "测试连接"

```typescript
async function testConnection(config: WebDAVConfig) {
  // 1. 用临时 webdav 客户端试 stat 远程文件
  // 2. 成功 → 显示 "连接成功, 远端文件: sync.kdbx (1.2 MB)"
  // 3. 失败 → 显示具体错误(网络/认证/文件不存在)
}
```

---

## 4. 主密码修改页

### 4.1 ChangePasswordPanel

```typescript
type ChangePasswordPanelProps = {
  onChanged: () => void;
};
```

**UI**：
```
┌────────────────────────────────────────┐
│ 更改主密码                              │
├────────────────────────────────────────┤
│ 当前主密码 *                            │
│ ┌────────────────────────────────────┐ │
│ │                                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ 新主密码 *                              │
│ ┌────────────────────────────────────┐ │
│ │                                    │ │
│ └────────────────────────────────────┘ │
│ 强度: ███░░ 中等                       │
│                                        │
│ 确认新密码 *                            │
│ ┌────────────────────────────────────┐ │
│ │                                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ ⚠️ 警告:                                │
│  - 改主密码后,所有设备(浏览器+手机)都需重输 │
│  - 手机端 Keepass2Android 会保留旧密码的缓存│
│    需要手动重新打开 sync.kdbx              │
│                                        │
│ [取消]              [更改主密码]        │
└────────────────────────────────────────┘
```

### 4.2 改主密码流程（SW 侧）

```typescript
// libs/auth/password.ts
async function changeMasterPassword(oldPwd: string, newPwd: string) {
  // 1. 用旧密码解锁当前 KDBX
  const db = await loadKdbx(oldPwd);

  // 2. 创建新 KDBX,数据复制
  const newDb = kdbxweb.Kdbx.create(kdbxweb.Credentials.fromPassword(newPwd));
  // ... 遍历 db.groups, 复制到 newDb
  // ... (此处代码略, 实际要递归 groups + entries)

  // 3. 序列化为新字节流
  const newBytes = await newDb.save();

  // 4. 用旧 deviceKey 解密 webdav 凭据 (用旧密码派生)
  //    用新 deviceKey 重新加密 (用新密码派生)

  // 5. 上传新字节流
  await uploadKdbx(newBytes);

  // 6. 替换内存中的 repo
  setRepository(new KdbxRepository(newDb));

  // 7. 通知 UI 重新加载
  notifyAllUI({ type: 'locked' });  // 强制用户用新密码重输
}
```

**约束**：
- 改主密码 = 上传新 KDBX（v2 不能在客户端"重加密"）
- 改完**强制**重输新密码（清空 session，UI 跳 Unlock）
- 手机端 Keepass2Android 会保留旧 KDBX 的缓存（因为 KDF 参数变了），用户**必须**手动在手机 App 里重新打开 sync.kdbx

### 4.3 强度评估

```typescript
// libs/auth/strength.ts
export function evaluatePasswordStrength(pwd: string): {
  score: 0 | 1 | 2 | 3 | 4;  // 0=极弱 1=弱 2=中等 3=强 4=极强
  label: string;
  feedback: string;
};
```

**v2 简化为本地启发式**（不引 zxcvbn 大库）：
- 长度 ≥ 12 → 加分
- 包含大小写字母/数字/符号 → 加分
- 包含连续字符（`123456`、`abcdef`）→ 减分
- 包含常见密码（`password`、`qwerty`）→ 大减分

---

## 5. 自动锁定配置

```typescript
type AutoLockConfigProps = {
  initialMinutes: number;
  onChange: (minutes: number) => void;
};
```

**UI**：
```
┌────────────────────────────────────────┐
│ 自动锁定                                │
├────────────────────────────────────────┤
│ 无操作多久后自动锁定?                    │
│                                        │
│  ○ 1 分钟                              │
│  ● 5 分钟 (推荐)                        │
│  ○ 10 分钟                             │
│  ○ 30 分钟                             │
│  ○ 永不 (不推荐)                        │
│                                        │
│ ℹ 自动锁定后,需要重新输入主密码才能查看    │
│   账号列表。锁定期间已复制到剪贴板的        │
│   TOTP 仍可使用。                        │
└────────────────────────────────────────┘
```

**约束**：
- 立即保存到 `chrome.storage.local.settings.autoLockMinutes`
- SW 监听变更, 重新设置 alarm 周期

---

## 6. 导入导出页

### 6.1 ImportPanel

```typescript
type ImportPanelProps = {
  onImported: (result: ImportResult) => void;
};
```

**UI**：
```
┌────────────────────────────────────────┐
│ 导入数据                                │
├────────────────────────────────────────┤
│ 选文件 *                                │
│ ┌────────────────────────────────────┐ │
│ │ accounts.json                      │ │
│ └────────────────────────────────────┘ │
│ [浏览...]                              │
│                                        │
│ 合并策略:                                │
│  ○ 跳过已存在 (推荐)                     │
│  ● 覆盖已存在                           │
│  ○ 仅导入新账号                         │
│                                        │
│ 预览:                                   │
│   文件包含 30 个账号                     │
│   • 25 个是新增                         │
│   • 3 个会覆盖 (匹配 url + username)    │
│   • 2 个会跳过                          │
│                                        │
│ [取消]                  [开始导入]      │
└────────────────────────────────────────┘
```

**实现**：
```typescript
async function previewImport(file: File): Promise<ImportPreview> {
  if (file.name.endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    return previewJsonImport(parsed);
  } else if (file.name.endsWith('.kdbx')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return previewKdbxImport(bytes);
  }
  throw new Error('不支持的文件格式');
}
```

### 6.2 ExportPanel

```typescript
type ExportPanelProps = {
  accountCount: number;
  onExport: (format: 'json' | 'kdbx' | 'otpauth-uri') => void;
};
```

**UI**：
```
┌────────────────────────────────────────┐
│ 导出数据                                │
├────────────────────────────────────────┤
│ 当前共 30 个账号。                       │
│                                        │
│ 导出格式:                                │
│                                        │
│  [下载 .kdbx]                          │
│   与 KeePassXC / Keepass2Android 互通  │
│                                        │
│  [下载 accounts.json]                  │
│   ⚠️ 明文 JSON, 包含所有密码             │
│   妥善保管, 不要上传到公网                │
│                                        │
│  [下载 otpauth-uri.txt]                │
│   仅 TOTP 数据, 兼容 Authy / Authenticator│
│                                        │
└────────────────────────────────────────┘
```

详见 [09-popup.md §5](./09-popup.md) 关于明文导出的二次确认。

---

## 7. 关于页

```
┌────────────────────────────────────────┐
│ 关于                                    │
├────────────────────────────────────────┤
│ totp-vault                             │
│ 版本: 0.1.0                             │
│ 构建: 2026-06-06                        │
│                                        │
│ 开源协议: (待定)                         │
│                                        │
│ 致谢:                                    │
│   - kdbxweb (Apache 2.0)               │
│   - otpauth (MIT)                       │
│   - webdav (MIT)                        │
│                                        │
│ [查看源代码] [报告问题]                  │
└────────────────────────────────────────┘
```

---

## 8. 测试要点

```typescript
describe('Options', () => {
  test('首次配置 WebDAV 显示空表单', () => { /* ... */ });
  test('测试连接成功显示 "连接成功"', () => { /* ... */ });
  test('测试连接失败显示具体错误', () => { /* ... */ });
  test('改主密码后强制重输', () => { /* ... */ });
  test('导出 JSON 二次确认', () => { /* ... */ });
});
```
