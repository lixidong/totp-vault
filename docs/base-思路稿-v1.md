> ⚠️ **归档说明 (2026-06-06)**
>
> 本文档是 v1 思路稿，**已被 [`architecture.md`](./architecture.md) 替代**。
>
> 保留原因：v1 思路里的 OAuth 多云盘、Argon2id、KDBX 选型、TOTP 多时间源、ISOLATED world 注入、nativeInputValueSetter 等技术决策仍是 v2 的核心，文字可作背景阅读。
>
> 不一致点（v2 方案与本文档的差异）：
> - 账号模型：v1 隐含"完整凭证集"未明示，v2 显式确定为 `{username, password, totp?, url, notes}`
> - 云盘：v1 假设 OAuth + OneDrive/Google Drive/Dropbox，v2 改为 **WebDAV**（坚果云/自建 NAS 友好）
> - License：v1 暗示开源，v2 暂不定
> - 缺失：v1 没写"注册场景的主动保存"和"同域名多账号选择器"，v2 补
>
> 阅读时请以 `architecture.md` 为准。

基于我们所有的讨论，你的需求已经非常精确：**一个纯浏览器扩展形态的密码管理器，数据存于你自己的云盘，在本地完成所有加解密和 TOTP 计算，完全免费，不依赖任何特定服务商，且可导出为标准格式。**

以下是一份完整的、可直接作为开发蓝图的技术实施方案。

---

## 1. 总体架构

```
┌──────────────────────────────────┐
│           浏览器扩展               │
│                                  │
│  ┌────────────┐  ┌─────────────┐ │
│  │ Service     │  │ Content     │ │
│  │ Worker      │  │ Scripts     │ │
│  │ (后台核心)   │  │ (页面注入)   │ │
│  └──────┬─────┘  └──────┬──────┘ │
│         │               │        │
│  ┌──────┴───────────────┴──────┐ │
│  │      消息通信 (chrome.runtime) │
│  └──────────────────────────────┘ │
└──────────────────────────────────┘
           │  HTTPS REST API
           ▼
    ┌──────────────┐
    │  用户自选的云盘 │ (OneDrive / Google Drive / Dropbox / WebDAV)
    │  存储 .kdbx 文件 │
    └──────────────┘
```

- **Service Worker**：负责数据库加解密、云盘 API 通信、TOTP 种子管理与计算、密码条目的搜索匹配。
- **Content Scripts**：注入登录页面，识别表单，请求 Service Worker 获取填充数据，并执行填充。
- **云盘 API**：直接通过 OAuth 2.0 授权访问用户自己的云盘，读写加密的密码库文件（`.kdbx`）。

**无任何本地桌面进程或自建服务器，所有逻辑都在浏览器沙箱内完成。**

---

## 2. 密码库格式：直接兼容 KeePass

**选型：`.kdbx` (KDBX 4.1 格式)**
- **理由**：开放标准，经大量安全审计，原生支持 TOTP 种子存储，可被 KeePassXC、KeePassDX 等所有主流客户端直接打开。你的导出功能天然就是“把 .kdbx 文件复制出来”。
- **实现**：使用纯 JavaScript 的 **KDBXweb** 库（开源，支持浏览器端读写 .kdbx），它封装了加解密和条目解析。

---

## 3. 云盘交互模块

为了让用户“装一个扩展就行”，必须支持多种云盘。初期至少覆盖 **OneDrive** 和 **Google Drive**，后期扩展 **Dropbox** 和 **WebDAV**（可连接坚果云等）。

- **授权**：使用 `chrome.identity.launchWebAuthFlow` 完成 OAuth 2.0 授权流程，获取 access token 和 refresh token，加密后存入扩展的 `chrome.storage.local`。
- **文件操作**：
    - **打开数据库**：下载最新的 `.kdbx` 文件到内存。
    - **保存数据库**：将修改后的加密数据上传，使用 ETag 做乐观锁，防止覆盖他人修改。
    - **冲突处理**：若发现冲突（上传时 ETag 不匹配），重新下载远程文件，与本地最近修改合并（KDBX 格式支持条目级合并），提示用户手动解决冲突。
- **定期刷新**：Service Worker 可在后台定时唤醒，检查云盘文件是否有新版本，若有则自动同步，减少冲突概率。

---

## 4. TOTP 模块：多 API 时间校准 + 本地兜底

种子存储在 `.kdbx` 条目的 `otp` 属性中（标准 KeePass 字段）。

**时间获取策略：**

1. **主路径：多个 HTTP 时间 API 并发请求**
    - 内置 3 个时间源：`https://time.cloudflare.com`、`https://worldtimeapi.org/api/ip`、`https://www.googleapis.com/discovery/v1/apis`（只取响应头中的 Date 字段）。
    - 并发请求这 3 个接口，采用最先成功的响应，或对结果取中位数过滤异常。
2. **缓存偏差量**
    - 计算 `偏差 = 服务器时间 - Date.now()`，加密保存在 `chrome.storage.local`，有效期 15 分钟。
    - 每次 TOTP 计算优先使用 `Date.now() + 偏差`，无需网络请求。仅在缓存过期后才发起新的多 API 校准。
3. **降级路径**
    - 若所有 API 均不可用，且缓存已过期，则直接使用 `Date.now()`（即信任系统时间）。此时行为与 KeePassXC 完全一致。
4. **TOTP 生成**
    - 使用标准 `OTP.js` 库，输入种子、当前精确时间、算法（SHA1/SHA256）和周期（30秒），输出 6 位验证码。
    - 自动填充密码后，验证码自动复制到剪贴板，或提供“一键粘贴”按钮。

---

## 5. 自动填充模块

- **表单识别**：Content Script 扫描页面 DOM，寻找 `<input type="password">` 或 `autocomplete="current-password"`，关联相邻的用户名字段。
- **匹配逻辑**：将当前域名与数据库中的所有条目 URL 字段做模糊匹配。
- **填充流程**：
    1. Content Script 向 Service Worker 发送 `{action: "get_credentials", url: location.hostname}`。
    2. Worker 查询内存中的密码库，返回最佳匹配的账号、密码、TOTP（如果存在）。
    3. Content Script 执行自动填充，或弹出选择器供用户选择。
- **安全性**：所有通信通过 `chrome.runtime.sendMessage`，不会将密码暴露给网页全局变量。填充使用严格的 DOM API 赋值，避免脚本监听。

---

## 6. 数据导入导出

- **导出**：
    - 直接在扩展设置中提供“导出数据库”按钮，将内存中的 `.kdbx` 文件通过浏览器下载保存。
    - 同时支持导出未加密 JSON（用户需二次确认），兼容 Bitwarden、1Password 等。
- **导入**：
    - 支持直接打开本地的 `.kdbx`、`.csv`、Bitwarden JSON 文件，转换为 KDBX 格式存入云盘。

---

## 7. 安全设计要点

1. **主密码**：使用 Argon2id 派生 256 位密钥，用于数据库解密。主密码绝不存储，每次打开数据库需输入（或可设置短期自动锁定）。
2. **本地存储**：OAuth Token、时间偏差量等敏感数据，均使用 Web Crypto API 生成一个独立密钥加密后存放。
3. **Service Worker 生命周期**：定期休眠时，所有内存中数据被清除，只保留加密的云盘 Token 和时间偏差缓存。用户下次使用时需重新输入主密码解密。
4. **内容脚本隔离**：使用 `world: 'MAIN'` 注入时必须极为谨慎，优先使用 `world: 'ISOLATED'` 安全隔离。
5. **审计与开源**：建议整个项目采用 MIT 或 GPL 许可证，代码完全公开，以便安全审计。

---

## 8. 开发技术栈推荐

- **框架**：Plasmo (React-based extension framework) 或原版 Chrome Extension Manifest V3 + TypeScript。
- **数据库解析**：`kdbxweb` (TypeScript/JS)
- **TOTP**：`otplib`
- **加密**：Web Crypto API (SubtleCrypto)，补充使用 `@noble/ciphers` 实现 Argon2id。
- **云盘 API**：微软 Graph API (OneDrive)，Google Drive API，Dropbox SDK (浏览器版本)。
- **UI**：扩展弹窗使用 React 或 Preact，简洁轻量。

---

## 9. 开发路线图建议

**第一阶段（最小可用产品）**
- 支持 `.kdbx` 格式，仅 OneDrive 同步。
- 实现基本的密码添加、查看、自动填充（不含 TOTP）。
- 单一时间 API + 系统时间降级的 TOTP 功能。

**第二阶段（增强可靠性）**
- 增加 Google Drive、WebDAV 支持。
- 实现多时间 API 并发与偏差缓存。
- 冲突合并处理。

**第三阶段（体验完善）**
- 自动填充选择器 UI，域匹配优化。
- 导入导出 Bitwarden/CSV 格式。
- 生物识别解锁（如果浏览器提供相关 API）。

---

## 10. 关键难点与解决方案

| 难点 | 解决方案 |
|------|----------|
| Service Worker 休眠导致云盘 Token 刷新不及时 | 使用 `chrome.alarms` 定时唤醒，利用 Refresh Token 定期续期，确保下次使用时 Token 有效。 |
| 大数据库（>1000条）解密耗时 | 使用 IndexedDB 作为本地缓存，将解密后的条目元数据（不包含密码）索引存储，打开数据库瞬间完成。 |
| 某些网站自动填充失败 | 提供键盘快捷键（如 Ctrl+Shift+L）触发填充，或使用右键菜单。 |
| 云盘 API 调用频率限制 | 实施指数退避策略，合并短时间内的多次保存操作。 |

---

## 结语

你当初的想法——“纯浏览器扩展，数据存云盘，本地算 TOTP”——经过我们多轮探讨，已被证明在技术上完全可行。这份方案将你的所有设想落到了具体的组件、库和策略上。

它填补的正是当前市场的一个真实空白：一个**不绑定任何服务商、免安装、带全功能 TOTP、完全自控数据**的密码管理器。如果你决定动手实现，这将是开源社区中一个极具价值的项目。