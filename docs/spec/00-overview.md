# SPEC 00: 总览

> **目的**：5 分钟读完，知道 v2 在做什么、怎么做、为什么这么做
> **本 SPEC 不涉及**：具体类型定义（见 01）、算法细节（见 02/04）、UI 组件（见 09/10）
> **依赖**：无（最顶层）
> **被依赖**：所有其他 SPEC

> 当前开发状态、发布状态和待办事项见 [`../current-status.md`](../current-status.md)。旧 SPEC 中的范围和 checklist 可能滞后，判断当前实现时以代码和 current-status 为准。

---

## 1. 一句话定义

**v2 = 一个浏览器扩展 + 用户的 WebDAV 云盘 + 用户手机上的 KDBX 客户端**，三者共用一份 KDBX 文件，**主密码是唯一密钥**。

---

## 2. 决策表

| 决策点 | 选择 | 关键含义 |
|---|---|---|
| 产品形态 | 浏览器扩展（MV3） | 跨 Chrome / Edge / 其他 Chromium 内核 |
| 账号模型 | 完整凭证集 | `{username, password, totp?, url, notes}`，TOTP 可选绑定 |
| 主密码 | **必填** | 短好记的主密码 + KDBX 4.1 (Argon2id) |
| 存储格式 | KDBX 4.1（KDBXweb） | 与 KeePassXC / KeePassDX / Aegis 互通 |
| 同步后端 | **WebDAV** | 坚果云、自建 NAS、任何兼容 WebDAV 的服务 |
| License | 暂不定 | 项目根目录先不写 LICENSE 文件 |
| 手机端 | **Android only**，Keepass2Android 为主推，KeePassDX 备用 | 用户**手动拉取**（打开 App 即自动拉一次），无后台轮询 |
| 同步体验 | "浏览器改 → 用户打开手机 App → 自动拉到 → 处理 → 写回" | 手机端**不主动推送**，无后台同步 |
| UI 库 | 不引第三方（手写 CSS） | < 30 账号规模不需要 |
| 状态管理 | React useState | 无 Redux/Zustand |

---

## 3. 范围

### 3.1 v2 范围内 ✅

- 浏览器扩展（Chrome / Edge MV3）
- KDBX 4.1 读写
- WebDAV 上传/下载/冲突合并
- 注册场景主动保存账号密码
- 登录场景自动填充账号密码
- 登录后自动填写 TOTP（MFA 场景）
- 主密码 + Argon2id 解锁
- WebDAV 凭据加密存储
- Android 端 Keepass2Android 互通

### 3.2 v2 范围外 ❌

- 自家 iOS / Android / 桌面 App
- iOS Safari 扩展
- PWA
- 二维码扫描
- Bitwarden / 1Password / CSV 导入
- 自动后台同步（手机端）
- 跨设备主密码重置
- 国际化、暗色模式
- 标签、搜索、分组

---

## 4. 顶层数据流

```
[用户] 在浏览器注册网站
   ↓
[Content Script] 检测表单提交
   ↓
[Popup Overlay] "保存到 KDBX?" 卡片
   ↓ (用户点保存)
[Background SW] 内存中 KDBX 对象更新
   ↓
[WebDAV 客户端] 防抖 1.5 秒后上传到坚果云
   ↓
[坚果云] sync.kdbx 文件被覆盖
   ↓
[Android: Keepass2Android] 用户打开 App → 自动拉取 → 看到新账号
   ↓
[Android] 扫网站 MFA 二维码 → secret 写回 KDBX
   ↓
[Android] 触发同步回 WebDAV
   ↓
[浏览器扩展] 用户下次解锁时拉到 → 看到 TOTP 已绑定 → 登录时自动填
```

---

## 5. 模块清单（每个一个 SPEC）

| ID | 名称 | 对应 libs/ 目录 | 依赖 |
|---|---|---|---|
| [00](./00-overview.md) | 总览 | — | — |
| [01](./01-types.md) | 类型定义 | libs/auth/types.ts | — |
| [02](./02-kdbx.md) | KDBX 存储 | libs/kdbx/ | 01 |
| [03](./03-webdav.md) | WebDAV 同步 | libs/webdav/ | 01, 02, 07 |
| [04](./04-totp.md) | TOTP 模块 | libs/totp/ | 01 |
| [05](./05-fill.md) | 表单检测与填充 | libs/fill/ | 01, 04, 06 |
| [06](./06-messaging.md) | 消息协议 | libs/messaging/ | 01 |
| [07](./07-storage.md) | chrome.storage 封装 | libs/storage/ | 01 |
| [08](./08-security.md) | 安全设计 | (横切) | 01, 02, 07 |
| [09](./09-popup.md) | Popup UI | entrypoints/popup/ | 02, 04, 06, 07 |
| [10](./10-options.md) | Options Page | entrypoints/options/ | 03, 06, 07 |
| [11](./11-stack.md) | 技术栈与目录结构 | (全项目) | — |
| [12](./12-roadmap.md) | 路线图与难点 | (全项目) | 全部 |

---

## 6. 术语表

| 术语 | 定义 |
|---|---|
| KDBX | KeePass 2.x 的数据库文件格式，KDBXweb 是其 JS 实现 |
| WebDAV | RFC 4918 定义的 HTTP 协议扩展，用于远程文件操作 |
| Argon2id | 抗 GPU/ASIC 暴力破解的密码派生函数，KDBX 4 默认 |
| TOTP | Time-based One-Time Password，RFC 6238 |
| otpauth URI | `otpauth://totp/...` 格式的 TOTP 配置 URI |
| Service Worker (SW) | MV3 扩展的后台脚本，可休眠 |
| Content Script | 注入到页面的脚本，MV3 默认 ISOLATED world |
| MV3 | Manifest Version 3，Chrome 扩展新规范 |
| ETag | HTTP 头，用于乐观锁 |
| If-Match | HTTP 头，匹配 ETag 时才允许写入 |
| deviceKey | 由主密码派生的子密钥，用于加密 webdav 凭据 |
| 主动保存 | 注册场景下，扩展主动询问用户是否保存账号 |
| 自动填充 | 登录场景下，扩展主动填入账号密码 |

---

## 7. 与 v1 思路稿的关系

v1 思路稿（`docs/base-思路稿-v1.md`）是 2026-06-06 之前的讨论纪要，**所有未决策点已在 v2 中确定**。两者冲突时**以 v2 为准**。

v1 与 v2 的关键差异：
- v1 隐含 OAuth 多云盘，v2 选 WebDAV
- v1 没写"注册场景主动保存"和"同域名多账号选择器"，v2 补
- v1 假设多平台 App，v2 限定 Android only + Keepass2Android

---

## 8. 后续阅读建议

1. **理解全貌**：本文档 §4 数据流图
2. **理解账号结构**：[01-types.md](./01-types.md)
3. **理解存储格式**：[02-kdbx.md](./02-kdbx.md)
4. **理解同步机制**：[03-webdav.md](./03-webdav.md)
5. **理解安全模型**：[08-security.md](./08-security.md)
6. **理解实施路径**：[12-roadmap.md](./12-roadmap.md)
