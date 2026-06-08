# totp-vault — v2 架构与实施方案

> **状态**：v2 蓝图，2026-06-06 制定
> **范围**：纯浏览器扩展，**不依赖**桌面客户端、自建服务器、特定云服务商
> **替代关系**：取代 `docs/base-思路稿-v1.md`，后者归档为背景资料

---

## 0. 决策摘要（先看这一节就能拿去做开发）

| 决策点 | 选择 | 关键含义 |
|---|---|---|
| 产品形态 | 浏览器扩展（MV3） | 跨 Chrome / Edge / 其他 Chromium 内核 |
| 账号模型 | 完整凭证集 | `{username, password, totp?, url, notes}`，TOTP 可选绑定 |
| 主密码 | **必填** | 短好记的主密码 + KDBX 4.1 (Argon2id) |
| 存储格式 | KDBX 4.1（KDBXweb） | 与 KeePassXC / KeePassDX / Aegis 互通 |
| 同步后端 | **WebDAV** | 坚果云、自建 NAS、任何兼容 WebDAV 的服务 |
| License | 暂不定 | 项目根目录先不写 LICENSE 文件 |
| 手机端 | **消费方** | 装 KeePassDX/Aegis 打开云盘 KDBX，不依赖本扩展 |
| UI 库 | 不引第三方（手写 CSS） | < 30 账号规模不需要 |
| 状态管理 | React useState | 无 Redux/Zustand |
| 手机端 | **Android only**，Keepass2Android 为主推，KeePassDX 备用 | 用户**手动拉取**（打开 App 即自动拉一次），无后台轮询 |
| 同步体验 | "浏览器改 → 用户打开手机 App → 自动拉到 → 处理 → 写回" | 手机端**不主动推送**，无后台同步 |

---

## 1. 总览

```
┌─────────────────────────────────────┐
│         浏览器扩展 (MV3)             │
│                                     │
│  ┌──────────┐  ┌──────────────────┐ │
│  │ Popup    │  │ Options Page     │ │
│  │ (列账号,  │  │ (WebDAV 配  置,   │ │
│  │  解锁)    │  │  主密码, 导入)     │ │
│  └────┬─────┘  └────────┬─────────┘ │
│       │                 │          │
│  ┌────┴─────────────────┴──────┐   │
│  │  Service Worker (后台)       │   │
│  │  - KDBX 加解密               │   │
│  │  - WebDAV 客户端             │   │
│  │  - TOTP 计算                 │   │
│  │  - 账号搜索匹配              │   │
│  │  - 同步/冲突合并             │   │
│  └────────────┬────────────────┘   │
│               │ chrome.runtime      │
│  ┌────────────┴────────────────┐   │
│  │  Content Scripts             │   │
│  │  - 注册场景: 主动保存         │   │
│  │  - 登录场景: 自动填充         │   │
│  │  - MFA 场景: TOTP 自动填     │   │
│  └─────────────────────────────┘   │
└──────────────┬──────────────────────┘
               │ HTTPS / WebDAV (RFC 4918)
               ▼
      ┌─────────────────┐
      │  用户自建云盘     │
      │  (坚果云 / NAS)  │
      │  1 个 sync.kdbx │
      └─────────────────┘
               ▲
               │ 同一份 KDBX
               │
      ┌────────┴────────┐
      │  Android App    │
      │  Keepass2Android│ ← 主推, 打开 App 自动拉一次
      │  (或 KeePassDX) │ ← 备用, 需手动"重新打开"
      └─────────────────┘
```

**核心原则**：
- **数据库永远以加密形态离开浏览器**。内存中也只是已解密的 KDBX 内存对象，**不写盘明文**。
- **Service Worker 是唯一能解密的状态持有者**。Popup / Content 只持有 SW 颁发的短期 session 票据。
- **离线优先**：本地有缓存时（IndexedDB 存加密字节流）能开应用，联网后再同步。

---

## 2. 账号模型

### 2.1 单一对象

```typescript
// KDBX 内部以 Entry 表达，TypeScript 强类型在 libs/auth/types.ts 定义
type Account = {
  id: string;              // UUID v4，本地生成
  url: string;             // 主域名，例如 "https://github.com"
  username: string;        // 用户名/邮箱/手机号
  password: string;        // 明文，仅在内存中存在
  totp?: TOTPBinding;      // 可选，TOTP 绑定
  notes?: string;          // 自由文本
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  lastUsedAt?: string;     // 用于排序"最近使用"
};

type TOTPBinding = {
  secretBase32: string;    // 标准 base32 编码（RFC 4648）
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: 6 | 8;
  period: 30 | 60;         // 秒
  issuer?: string;         // 显示名，可与 url 解耦
};
```

### 2.2 TOTP 绑定的两种来源

| 来源 | 触发场景 | 入口 | 数据流 |
|---|---|---|---|
| **浏览器手动输** | 网站只给 secret 字符串，没有二维码 | 扩展 popup → 选中账号 → "添加 TOTP" → 输 secret + 选算法/位数/周期 | secret 写进 KDBX → 上传云 |
| **手机扫码后回写** | 网站给二维码 | 手机 KeePassDX/Aegis 扫 → 写入同一个 KDBX → 触发云同步 | KDBX 改 → 浏览器下次拉 |

**关键设计**：TOTP 是账号的**可选字段**，不是独立条目。这样：
- 同一个 GitHub 账号在浏览器和手机上 TOTP 一致
- 不用维护"密码库"和"TOTP 库"两份数据
- 用户从 TOTP-only 切到"密码+TOTP"零迁移成本

### 2.3 账号的生命周期状态

```
不存在 → 浏览器主动保存(注册场景) ─┐
                                    ├─→ 已存(无 TOTP) ─→ 补 TOTP ─→ 已存(完整)
                                    │                          ▲
       手动添加(Options Page) ──────┘                          │
                                                              │
                                手机 App 扫码后回写 ──────────┘
```

中间状态"已存(无 TOTP)"是合法且持久的——很多网站注册时不强制 MFA。

---

## 3. 存储：KDBX 4.1 + WebDAV

### 3.1 为什么是 KDBX

| 维度 | KDBX 4.1 | 自定义 JSON | 备注 |
|---|---|---|---|
| 加解密 | AES-256 + ChaCha20 + Argon2id | 要自己实现 | KDBXweb 现成 |
| TOTP 字段 | 原生 `otp` 属性 | 要自己定义 schema | KeePass 系标准 |
| 互通性 | KeePassXC/DX/Aegis 全开 | 仅本扩展 | **决定性优势** |
| 体积 | < 30 条约 10-20 KB | 更小 | 可忽略 |
| 学习成本 | 库 API 抽象良好 | 0 | — |

**结论**：选 KDBX 是因为**手机端用现成 App**这个需求。如果手机也是本扩展，P2 才考虑自定格式。

### 3.2 KDBX 4.1 关键参数

```
主密码 → Argon2id
  ├─ salt: 16 字节随机
  ├─ iterations: ≥ 3
  ├─ memory: 64 MB (KDBX 推荐)
  ├─ parallelism: 1
  └─ key length: 256 bit
       ↓
   AES-256-KDF 派生 header 密钥
       ↓
   整个 KDBX body 用 AES-256-CBC + HMAC-SHA256 加密
```

**性能预期**（在 M1/中等 x86 笔记本上）：
- Argon2id 派生：2~5 秒一次
- AES 解密 < 30 条：< 100ms
- 用户感知：**打开扩展输主密码 = 等 2~5 秒**，之后操作即时

### 3.3 文件布局（云盘上）

```
{webdav-root}/totp-vault/
  ├── sync.kdbx          # 主数据库（唯一被读写）
  ├── sync.kdbx.lock     # 软锁（详见 §3.6）
  └── .meta.json         # 同步元数据：etag, last_sync_at, device_id
```

**只有 `sync.kdbx` 是真实数据**。`.meta.json` 可选，仅用于多设备冲突诊断。

### 3.4 WebDAV 客户端

- 库：`webdav` (npm, 5.x)，纯 JS，无 native 依赖
- 协议：RFC 4918 子集（PROPFIND / PUT / GET / DELETE / MKCOL / LOCK）
- 鉴权：HTTP Basic over HTTPS，**用户名 + 应用专用密码**（不是云盘登录密码）
  - 坚果云：在 https://nutstore.xx/settings 生成
  - 自建 NAS：用对应服务的应用密码机制
- 端点：用户在 Options Page 填入 `{webdav-url}, {username}, {app-password}`，**主密码另存**

### 3.5 同步流程

**打开扩展（解锁流程）**：

```
Popup 启动
   ↓
读 chrome.storage.local 的"上次会话"标记
   ├─ 有 → 尝试 SW 静默续期(不输主密码,仅限 5 分钟)
   └─ 无 → 提示输主密码
            ↓
         SW 调 webdav.download("sync.kdbx")
            ↓
         校验 etag 是否与 .meta.json 一致
            ├─ 一致 → 用本地缓存(IndexedDB)的加密字节流
            └─ 不一致 → 下载最新,再解密
                       ↓
                    输主密码 → KDBXweb 解密 → 内存中持有
```

**保存/修改账号后**：

```
SW 内存中 KDBX 对象变更
   ↓
防抖 1.5 秒(合并连续编辑)
   ↓
webdav.upload("sync.kdbx", new_bytes)
   ├─ 成功 → 更新 .meta.json 的 etag
   └─ 失败(412 Precondition Failed) → 进入冲突流程
```

**手机端拉取**：由用户**主动打开 Android App** 触发。Keepass2Android 启动时会自动重新打开绑定的 WebDAV 数据库（即拉一次最新），不需要手动点刷新。**不做**后台轮询，省电且避免 iOS 风格的系统限制。

### 3.6 冲突处理

**单一用户多设备**场景下冲突极少，但不能不防。

**触发**：上传时带 `If-Match: <old-etag>`，服务端返回 412。

**策略**（v2 选"自动合并 + 提示"而非"先锁后写"）：

```
冲突触发
   ↓
下载远端最新 KDBX
   ↓
用主密码解锁远端(假设主密码相同)
   ↓
对比两个 KDBX 对象的 entry-level 差异:
   ├─ 只有本地改 → 保留本地
   ├─ 只有远端改 → 拉取远端
   ├─ 两边改同一字段:
   │     ├─ 简单字段(notes, password) → 保留最新更新时间戳
   │     └─ 重要字段(totp) → 弹窗让用户选
   └─ 结构性差异(条目删除/新增) → 合并双方
   ↓
生成新 KDBX 字节流
   ↓
上传(带新 etag)
```

**为什么不用 LOCK**：
- WebDAV LOCK 在坚果云等只读实现里不被支持
- 浏览器扩展 SW 可能随时休眠，"我持锁"不可靠
- 30 条规模下 entry 级合并是 O(1) 开销
- **手机端不主动轮询**，冲突窗口天然很小（用户在手机上写完就关 App）

---

## 4. 注册场景：主动保存

**这是 base.md v1 缺失的关键路径**。用户在浏览器里注册新网站时，扩展应当主动询问是否保存。

### 4.1 检测时机

Content Script 监听 `<form>` 提交事件，但**不自动保存**——避免误存"搜索框"等非登录表单。

**检测条件**（AND 关系）：
- 表单包含至少一个 `<input type="password">`（首次注册）或 `<input type="text">` + `<input type="password">`（常规注册）
- 表单 action 指向不同 origin（POST 出去才算"提交"）
- 当前 URL 的 origin 不在"已忽略域名"白名单

### 4.2 保存流程

```
表单 submit
   ↓
Content Script 阻止默认跳转(等 1 个 tick,确认服务器接受了)
   ↓
弹出"保存到 KDBX?"小卡片(in-page overlay)
   ├─ [保存] → 抓取 form 字段(username/password/csrf token 关联的 hidden input)
   │           ↓
   │         提取 url = location.origin
   │         ↓
   │         SW 收到 createOrUpdateAccount(account)
   │           ↓
   │         写入内存 KDBX → 触发上传(防抖)
   │           ↓
   │         显示"已保存"小提示,2 秒后消失
   ├─ [永不保存此站] → 域名加入 chrome.storage.local 的 ignoreList
   └─ [稍后再说] → 关闭卡片,本会话不再弹
```

### 4.3 字段提取启发式

按优先级（v2 仅做 P0/P1，复杂场景后续迭代）：

| 字段 | 检测方式 |
|---|---|
| `password` | 唯一或最显眼的 `<input type="password">` |
| `username` | 同 form 内 `autocomplete="username"`，否则第一个 `type="text/email/tel"` |
| `url` | `location.origin`（不带 path） |
| `notes` | 留空，用户事后在 popup 编辑 |

**P2 才考虑**：
- 多步注册表单（邮箱验证 → 完善资料 → 设密码）：等流程走完再扫
- CSRF 关联字段：暂不抓
- 注册时同站多账号：弹卡片让用户命名（GitHub 允许同一邮箱多账号）

---

## 5. TOTP 模块

### 5.1 时间源

base.md v1 列了 3 个 API 含一个凑数的。v2 收敛到 **2 个真正的时间服务 + 系统时间兜底**：

```
[TOTP 计算需要] 当前 Unix 秒
   ↓
优先: 缓存偏差量 (chrome.storage.local)
   ├─ 未过期(< 15 分钟) → Date.now() + offset
   └─ 过期或不存在 → 多 API 并发校准
        ├─ https://worldtimeapi.org/api/ip
        ├─ http://worldclockapi.com/api/json/utc/now
        └─ 中位数过滤 + 写入缓存
        ↓
     全部失败 → Date.now() (信任系统时钟)
```

**v2 调整**：
- 砍掉 `time.cloudflare.com`（不稳定）和 `googleapis.com/discovery/v1/apis`（凑数）
- 加 `worldclockapi.com`（提供 ISO 8601 UTC）
- 用 2 个而非 3 个，少一个网络握手，且中位数在偶数个时仍能求平均

### 5.2 验证码生成

库：`otpauth`（已验证可用），纯 JS，无 native 依赖。

```typescript
import { Secret, TOTP } from 'otpauth';

function generateTOTP(binding: TOTPBinding, unixSeconds: number): string {
  const totp = new TOTP({
    secret: Secret.fromBase32(binding.secretBase32),
    algorithm: binding.algorithm,
    digits: binding.digits,
    period: binding.period,
  });
  return totp.generate({ timestamp: unixSeconds * 1000 });
}
```

### 5.3 录入入口

**浏览器侧**（扩展内部使用）：
- popup → 选中账号 → "添加 TOTP" → 表单（secret 文本框 + 算法/位数/周期下拉）→ 校验 base32 → 写 KDBX

**校验**：
- 长度是 4 的倍数
- 字符集 `[A-Z2-7]`
- 至少能 decode 出 8 字节（防止 typo 出的短 secret 算出无效码）

### 5.4 自动填充 TOTP（登录后第二因子）

Content Script 检测到登录成功后 1~3 秒内：

```
[登录提交成功] → Content Script 等待 800ms
   ↓
扫页面查找 OTP 输入框(沿用原 MVP 的 P0~P4 启发式)
   ├─ 找到 → 计算当前 TOTP → 填入
   │          ↓
   │        按 [copy to clipboard] 的偏好设置决定
   │          ├─ 自动填 → 直接 set value + 派发 input/change 事件
   │          └─ 仅复制 → 写入剪贴板,弹"已复制,即将过期"提示
   └─ 未找到 → 浮动按钮(可选 P3 兜底)
```

---

## 6. 登录场景：自动填充

### 6.1 字段识别（P0~P2，v2 必做；P3~P4 后续）

| 优先级 | 启发式 | 适用站点 | 状态 |
|---|---|---|---|
| P0 | `autocomplete="current-password"` + 关联 `autocomplete="username"` | Google / GitHub / 大多数合规站点 | v2 必做 |
| P1 | 同 form 内 `<input type="password">` + 第一个 `text/email/tel` 兄弟 | 通用兜底 | v2 必做 |
| P2 | 跨 form：最近 password + 同 form/action 内 username | 多步登录（少见） | v2 必做 |
| P3 | 浮动"自动填充"按钮（无明确输入框） | 阿里云控制台 | v2 必做（最简版） |
| P4 | 用户框选 selector 后持久化 | 自定义组件 | v3 候选 |

### 6.2 同域名多账号选择器

**触发条件**：`location.origin` 命中 ≥ 2 个账号。

**UI**：浮动在 password 输入框右下角的小卡片，列出所有匹配账号。

```
┌────────────────────────────┐
│ 选择账号                    │
├────────────────────────────┤
│ 👤 user@gmail.com          │
│ 👤 work@company.com        │
│ 👤 +86 138****             │
│ + 显示全部 (5)             │
└────────────────────────────┘
```

**交互**：
- 键盘 `↑/↓` 切换，`Enter` 选中，`Esc` 关闭
- 鼠标悬停高亮
- 选中后填充并记录 `lastUsedAt`

### 6.3 注入安全（修复 base.md v1 内部矛盾）

base.md v1 §5 vs §7.4 互相打架。**v2 明确只用 ISOLATED world**：

```typescript
// content/index.ts
// 注意：不要在任何地方用 chrome.scripting.executeScript({ world: 'MAIN' })
// 原因：
//   1) MV3 下 MAIN world 注入要求注入脚本打包进扩展,体积膨胀
//   2) MAIN world 可被页面 JS 访问,填充的密码/TOTP 会被宿主页面读到
//   3) ISOLATED world 配合 nativeInputValueSetter 已能稳定处理 React/Vue 受控组件
```

**填充伪代码**：

```typescript
// libs/fill/nativeInputValueSetter.ts
export function setInputValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

---

## 7. 导入导出

### 7.1 导出

| 格式 | 用途 | 实现 |
|---|---|---|
| `.kdbx` (未另存) | "我想换设备" | 扩展直接下载内存中的 KDBX 字节流 |
| `.kdbx` 文件复制 | 备份 | 同上 |
| `accounts.json` | 人类可读 / 自家存档 | 解密后导出 JSON，**需要二次确认明文风险** |
| `otpauth-uris.txt` | 给 TOTP-only App 用（兼容原 MVP 设计） | 遍历所有 `account.totp`，输出 `otpauth://totp/...` 每行一个 |

### 7.2 导入

| 来源 | 处理 |
|---|---|
| 本地 `.kdbx` | 文件选择器 → 读字节流 → 用主密码解锁 → 检查与云端 KDBX 是否有重叠条目 → 合并上传 |
| `accounts.json`（本扩展导出的格式） | 反序列化 → 检查 schema 版本 → 同上合并 |
| Bitwarden JSON | v2 不做，留作 v3 候选（启发式字段映射复杂） |
| `.csv` | v2 不做，留作 v3 候选 |

**导入安全**：必须先在内存里让用户**逐条确认**，不能直接合并。

### 7.3 与原 MVP 导出的关系

原 MVP 导出的 `accounts.json`（无密码字段）→ 重新导入到 v2 时，每个条目变成 `{username: 原 account, password: 空, totp: 原 binding, url: 空}`。可正常使用，但需要用户补 `url` 才能触发自动填充。

---

## 8. 安全设计

### 8.1 密钥分层

```
用户主密码 (明文, 仅输入瞬间存在)
   ↓ Argon2id
KDBX 派生密钥 (内存中, 整个会话持有)
   ↓ 解密
KDBX 内存对象 (entries 含明文 username/password/totp.secret)
   ↓ 重启/锁屏
清空 (全部被 GC 回收)
```

**派生参数**：使用 KDBX 库默认 + 用户在首次解锁时可选"加强"（高 iterations = 更慢）。

### 8.2 短期自动锁定

```
设置: 5 分钟无操作自动锁
   ↓
实现: chrome.alarms 每 60 秒检查 lastActivityTime
   ↓
触发: 距 lastActivity > 5 分钟 → SW 清空内存 KDBX 对象 + 关闭所有 popup/content session
   ↓
下次访问: 必须重新输主密码
```

### 8.3 WebDAV 凭据保护

```
用户输入 {webdav-url, username, app-password}
   ↓
主密码派生一个 deviceKey (与 KDBX 密钥不同 salt)
   ↓
deviceKey 加密 {webdav-url, username, app-password}
   ↓
密文存 chrome.storage.local
   ↓
需要同步时: 用户输主密码 → 解出 webdav 凭据 → 调 webdav
```

**设备失窃时**：攻击者拿到 chrome.storage.local 的密文但没有主密码 → 无法解出 webdav 凭据 → 也无法在线调 webdav API（因为 app-password 单独存）。**双因素**。

### 8.4 Content Script 隔离

- **不注入 MAIN world**（见 §6.3）
- Content Script 不持有任何敏感数据，只通过 `chrome.runtime.sendMessage` 向 SW 请求
- 所有响应在 SW 端鉴权（确认是同扩展的合法 content script）

### 8.5 已知威胁模型

| 威胁 | 防御 |
|---|---|
| 设备物理失窃 | 主密码 + WebDAV 凭据双重加密，离线爆破 Argon2id 不可行 |
| 扩展商店供应链攻击 | 不上架（仅本地加载），开源后可考虑 |
| 页面 XSS 读密码 | ISOLATED world + 填充后立刻关闭 session |
| 云盘被脱库 | KDBX 文件本身就是密文，Argon2id 派生 |
| 浏览器恶意扩展读 `chrome.storage.local` | 主密码派生 deviceKey 加密 webdav 凭据 |
| 中间人 | HTTPS 强制 + HSTS |

---

## 9. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **WXT**（基于 Vite + TypeScript） | 比 Plasmo 轻、HMR 快、MV3 友好 |
| UI | **React 18** + 手写 CSS | 状态简单，不引组件库 |
| 状态管理 | React useState + Context（仅 popup 内共享） | 无 Redux 需要 |
| KDBX | `kdbxweb` | 唯一成熟选择，TS 友好 |
| TOTP | `otpauth` | RFC 6238，< 10KB |
| WebDAV | `webdav` (5.x) | 纯 JS，支持 PROPFIND/PUT |
| 加密 | Web Crypto API（`crypto.subtle`） | 浏览器自带，零依赖 |
| 通信 | `chrome.runtime` 消息总线 | MV3 标准 |
| 构建 | Vite（被 WXT 包装） | — |
| 测试 | Vitest（lib 层）+ Playwright（E2E） | — |

---

## 10. 推荐文件夹结构

```
totp-vault/
├── docs/                              # 设计/方案文档
│   ├── architecture.md                # 本文件
│   └── base-思路稿-v1.md              # 归档
├── src/
│   ├── entrypoints/                   # WXT 入口约定
│   │   ├── background.ts              # Service Worker
│   │   ├── content.ts                 # Content Script 入口
│   │   ├── popup/                     # 弹窗 (主交互界面)
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── AccountList.tsx
│   │   │   │   ├── AccountDetail.tsx
│   │   │   │   ├── AccountForm.tsx        # 手动添加/编辑
│   │   │   │   ├── TOTPBindingForm.tsx    # 添加/编辑 TOTP
│   │   │   │   ├── UnlockScreen.tsx       # 输主密码解锁
│   │   │   │   └── AccountPicker.tsx      # 同域名多账号选择
│   │   │   └── styles/
│   │   ├── options/                   # Options Page (配置页)
│   │   │   ├── WebDAVConfig.tsx
│   │   │   ├── AutoLockConfig.tsx
│   │   │   ├── ImportPanel.tsx
│   │   │   └── ExportPanel.tsx
│   │   └── inpage-overlay/            # 页面内浮动卡片 (注册场景)
│   │       └── SavePrompt.tsx
│   ├── libs/                          # 纯业务逻辑 (无 React 依赖)
│   │   ├── auth/                      # 主密码 / KDBX 解锁
│   │   │   ├── kdbx.ts
│   │   │   ├── credentials.ts         # deviceKey 派生
│   │   │   └── lock.ts                # 自动锁定
│   │   ├── kdbx/                      # KDBX 操作 (CRUD)
│   │   │   ├── repository.ts          # 内存 KDBX 对象操作
│   │   │   ├── types.ts               # Account, TOTPBinding
│   │   │   └── merge.ts               # 冲突合并
│   │   ├── webdav/                    # WebDAV 客户端
│   │   │   ├── client.ts
│   │   │   ├── config.ts              # 凭据加解密
│   │   │   └── sync.ts                # 同步流程
│   │   ├── totp/                      # TOTP 计算
│   │   │   ├── generate.ts
│   │   │   ├── timeSync.ts            # 多 API 时间校准
│   │   │   └── base32.ts
│   │   ├── fill/                      # 自动填充
│   │   │   ├── detector.ts            # 字段检测
│   │   │   ├── nativeInputValueSetter.ts
│   │   │   ├── formFiller.ts
│   │   │   ├── saveDetector.ts        # 注册场景检测
│   │   │   └── otpDetector.ts         # OTP 输入框检测
│   │   ├── messaging/                 # 消息协议
│   │   │   ├── protocol.ts            # 消息类型定义
│   │   │   ├── handlers/
│   │   │   │   ├── background.ts      # SW 侧处理
│   │   │   │   ├── content.ts         # Content 侧
│   │   │   │   └── popup.ts
│   │   │   └── session.ts             # 短期 session 票据
│   │   ├── storage/                   # chrome.storage.local 封装
│   │   │   ├── local.ts
│   │   │   ├── session.ts             # chrome.storage.session
│   │   │   └── schema.ts
│   │   └── i18n/                      # 国际化 (预留)
│   ├── shared/                        # 跨入口共享的常量/类型
│   │   ├── constants.ts
│   │   └── errors.ts
│   └── manifest.json                  # WXT 自动生成,这里只是参考
├── public/
│   ├── icons/
│   └── otpauth-uri-template.txt
├── tests/
│   ├── unit/                          # Vitest
│   └── e2e/                           # Playwright (加载到真实浏览器)
├── .gitignore
├── package.json
├── tsconfig.json
├── wxt.config.ts                      # WXT 配置
├── vite.config.ts                     # 被 WXT 调用
└── README.md
```

**关键约定**：
- `libs/` 下**绝对不依赖** React/UI 框架，可在 background/popup/content 任意复用
- 每个 `lib/<name>/` 自成一个 npm package 风格的子模块（独立 `index.ts` 出口）
- `entrypoints/` 是 WXT 约定目录，编译时自动识别

---

## 11. 实施路线图

### 阶段 1：地基（M1-M2，2~3 周）

**目标**：能解锁 + 能加账号 + 能同步云盘

- [ ] WXT 项目初始化（不要手动写 manifest.json）
- [ ] 选定 WebDAV 测试服务（坚果云免费版可用）
- [ ] `libs/auth/kdbx.ts`：用 kdbxweb 实现解锁/锁定
- [ ] `libs/webdav/client.ts`：能上传/下载
- [ ] `libs/webdav/sync.ts`：3.5 节同步流程
- [ ] `libs/webdav/config.ts`：deviceKey 加密 webdav 凭据
- [ ] `entrypoints/popup/UnlockScreen.tsx`：输主密码解锁
- [ ] `entrypoints/popup/AccountForm.tsx`：手动加账号
- [ ] `entrypoints/options/WebDAVConfig.tsx`：配 WebDAV 端点
- [ ] 端到端测试：在坚果云上看到 1 个 sync.kdbx，添加账号后能同步

### 阶段 2：双向录入（M3，1~2 周）

**目标**：浏览器和 Android 都能写 TOTP

- [ ] `libs/totp/`：TOTP 计算 + 时间校准
- [ ] `libs/totp/base32.ts`：校验
- [ ] `entrypoints/popup/TOTPBindingForm.tsx`：添加/编辑 TOTP
- [ ] Android 端打通：在坚果云 Android App 里打开 sync.kdbx，用 **Keepass2Android** 验证能正常读写 + **打开 App 自动拉最新**

### 阶段 3：自动填充（M4，2 周）

**目标**：登录时一键填充 + MFA 时自动填 TOTP

- [ ] `libs/fill/`：字段检测 + 填充
- [ ] `libs/fill/saveDetector.ts`：注册场景主动保存
- [ ] `entrypoints/content.ts`：调度 detector/filler
- [ ] `entrypoints/popup/AccountPicker.tsx`：同域名多账号选择
- [ ] `entrypoints/inpage-overlay/SavePrompt.tsx`：注册保存卡片
- [ ] E2E 测试：登录 GitHub → 自动填 → 拿到 TOTP → 填入 → 登录成功

### 阶段 4：完善（M5+）

- [ ] 自动锁定
- [ ] 导入/导出（KDBX 互通、JSON 导出）
- [ ] P3 浮动按钮
- [ ] 错误诊断日志（"为什么同步失败"）
- [ ] License 文件（届时再定）
- [ ] 暗色模式
- [ ] 搜索过滤

---

## 12. 关键难点与解决方案

| 难点 | 解决方案 |
|---|---|
| Service Worker 休眠导致 webdav session 丢失 | SW 每次唤醒重新建立连接；deviceKey 解密是同步操作（< 10ms），不阻塞 |
| 主密码输错 → 派生密钥不对 → KDBX 解密失败 | 密码 hash 校验：KDBX header 里有 `MasterSeed` + `TransformSeed` 的组合，可先试解密 header 不解 body，毫秒级报错 |
| 同一账号两边同时改 TOTP | 冲突合并策略（§3.6），TOTP 字段冲突时弹窗 |
| 某些网站 `<input type="password">` 是隐藏的 | 显隐切换监听 + MutationObserver 扫整个 DOM |
| 浏览器扩展的 `chrome.storage` 配额 (10MB) | sync.kdbx 加密后 < 20KB，距离上限远；webdav 凭据密文 < 200B |
| 用户误删 KDBX 文件（云盘） | 不做自动备份（v2 范围外），但导出按钮常驻 Options Page |
| 首次注册时主密码还没设（无法加账号） | 主密码在第一次"加账号"时强制要求设置，Options Page 引导 |
| 派生密钥在主密码错误时无差别报错（防计时攻击） | KDBXweb 已处理：派生函数对错误密码仍然跑完整时间 |
| WebDAV 服务不支持 LOCK | 不依赖 LOCK，entry 级合并 |
| React/Vue 站点 value 被 set 后被覆盖 | `nativeInputValueSetter` + `dispatchEvent('input')` + `dispatchEvent('change')`（§6.3） |

---

## 13. 弃用与归档

| 旧文件 | 处理 |
|---|---|
| `base.md` | → `docs/base-思路稿-v1.md`（已归档） |
| `SPEC.md` | 整文件作废。v2 不再有"未决问题"小节，决策在本文 §0 |
| `manifest.json` | 删，WXT 自动生成 |
| `src/lib/*` (types/totp/storage/messaging/urlMatcher/exporter/importer/base32) | 整目录废弃。`totp` 和 `base32` 模块的设计可参考，但 API 全部按 v2 重新定义 |
| `vite.config.ts` + `tsconfig.json` | 删，WXT 自带 |
| `package.json` | 重写，依赖换成 WXT + kdbxweb + webdav + otpauth + react |

---

## 14. 后续待定（非 v2 范围）

- [ ] License 文件
- [ ] 国际化（i18n）
- [ ] 暗色模式
- [ ] Bitwarden JSON 导入
- [ ] CSV 导入
- [ ] 二维码扫描（`jsQR` + `camera` permission，扩展内扫网站 MFA 二维码）
- [ ] P4 框选模式
- [ ] Android 后台自动同步（Keepass2Android 支持，需用户主动开启）—— **不推荐**，耗电
- [ ] iOS 支持（Strongbox/KeePassium）—— **不做**，用户已确认 Android only
- [ ] PWA 版本（iOS Safari 扩展受限时）—— **不做**，同上
- [ ] 跨设备"主密码重置"机制（社会恢复 / Shamir 秘密分享）—— 慎重考虑
