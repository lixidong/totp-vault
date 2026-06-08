# SPEC 12: 路线图与难点

> **目的**：实施顺序、关键风险、验收标准、范围外事项
> **对应文件**：无（纯规划文档）
> **依赖**：所有 SPEC
> **被依赖**：无

> 当前开发状态见 [`../current-status.md`](../current-status.md)。本文件保留原始规划脉络，并在顶部维护最新路线图摘要。

---

## 0. 当前路线图摘要（2026-06-08）

已发布 `v0.1.0`：核心密码库、WebDAV、TOTP、网页登录填充、保存新账号提示、导入导出、自动锁定、主密码提示、GitHub Actions release 已完成。

下一阶段建议优先级：

1. 验证 GitHub Actions Release 与 release asset。
2. 忽略网站列表：保存新账号提示支持永久忽略域名，Options 支持管理。
3. 同步冲突处理：冲突提示、手动合并或 entry 级合并。
4. 填充兼容性增强：复杂登录流、分步登录、Shadow DOM。
5. 测试补强：URL、KDBX、Content Script、Playwright E2E。
6. 发布体验继续完善：README、安装说明、权限和隐私说明。
7. 主密码修改。

---

## 1. 4 阶段路线图

### 阶段 1：地基（M1-M2，2~3 周）

**目标**：能解锁 + 能加账号 + 能同步云盘

**任务清单**：

#### 1.1 项目脚手架
- [ ] 初始化 WXT 项目（[11-stack.md §8](./11-stack.md)）
- [ ] 配置 ESLint / Prettier / tsconfig
- [ ] 创建目录结构
- [ ] 准备 4 个尺寸的 icon（用 `convert -size 16x16 xc:transparent ...` 或现成 ico 转 png）

#### 1.2 核心 lib
- [ ] `libs/auth/kdbx.ts`：用 kdbxweb 实现 load/create
- [ ] `libs/auth/crypto.ts`：encryptJSON / decryptJSON
- [ ] `libs/auth/credentials.ts`：deriveDeviceKey（PBKDF2）
- [ ] `libs/storage/local.ts` + `session.ts` + `schema.ts`
- [ ] `libs/kdbx/repository.ts` + `convert.ts`
- [ ] `libs/webdav/client.ts` + `config.ts`
- [ ] `libs/webdav/sync.ts`：downloadOnUnlock / uploadOnChange

#### 1.3 SW 入口
- [ ] `entrypoints/background.ts`：处理 unlock / lock / isUnlocked
- [ ] 处理 listAccounts / createAccount / updateAccount / deleteAccount
- [ ] 处理 getWebDAVConfig / setWebDAVConfig

#### 1.4 UI 入口
- [ ] `entrypoints/popup/UnlockScreen.tsx`：输主密码解锁
- [ ] `entrypoints/popup/Main.tsx`：账号列表 + TOTP 实时显示
- [ ] `entrypoints/popup/AccountForm.tsx`：手动加账号
- [ ] `entrypoints/options/WebDAVConfig.tsx`：配 WebDAV 端点

#### 1.5 验收标准
- [ ] 全新安装：配坚果云 → 创建空 KDBX → 上传成功 → 关闭扩展 → 重开 → 看到空列表
- [ ] 添加账号 "GitHub / alice / s3cret" → 关闭扩展 → 重开 → 账号还在
- [ ] 删除账号 → 关闭扩展 → 重开 → 账号消失
- [ ] 配错的 webdav 端点 → 报错"认证失败"而不是崩溃
- [ ] 用错的密码解锁 → 报错"主密码错误"

---

### 阶段 2：双向录入（M3，1~2 周）

**目标**：浏览器和 Android 都能写 TOTP

**任务清单**：

#### 2.1 TOTP 模块
- [ ] `libs/totp/base32.ts`：isValidBase32 / normalizeBase32 / decode
- [ ] `libs/totp/generate.ts`：generateTOTP / getRemainingSeconds
- [ ] `libs/totp/timeSync.ts`：calibrateTime / getUnixSecondsWithOffset
- [ ] `libs/totp/otpauth.ts`：parseOtpauthUri / buildOtpauthUri
- [ ] `libs/auth/validation.ts`：validateAccount / validateTOTPBinding

#### 2.2 KDBX 扩展
- [ ] `libs/kdbx/repository.ts` 加 `bindTOTP` / `unbindTOTP` 方法
- [ ] 处理 KDBX 4.1 otp 字段

#### 2.3 Popup 扩展
- [ ] `entrypoints/popup/TOTPBindingForm.tsx`：添加/编辑 TOTP
- [ ] `entrypoints/popup/AccountDetail.tsx`：TOTP 实时显示 + 复制按钮
- [ ] `entrypoints/popup/AccountItem.tsx`：列表中显示 TOTP
- [ ] TOTP 倒计时（每秒更新）

#### 2.4 Android 端验证
- [ ] 配坚果云 → 在手机上装 Keepass2Android
- [ ] 打开 sync.kdbx → 用坚果云账号 + 主密码解锁
- [ ] 添加 TOTP 到 GitHub 账号（用 QR 扫或粘 URI）
- [ ] 保存 → 触发云同步
- [ ] 浏览器扩展解锁 → 看到 TOTP 已绑定
- [ ] 复制 TOTP → 跟手机算的一致

#### 2.5 验收标准
- [ ] 添加带 TOTP 的账号 → 关闭 → 重开 → TOTP 仍存在
- [ ] 复制 TOTP → 在另一台手机 Keepass2Android 算的码**完全一致**（同一 30s 窗口内）
- [ ] base32 错误 secret 拒绝保存，弹"无效"提示
- [ ] otpauth URI 粘贴后自动解析

---

### 阶段 3：自动填充（M4，2 周）

**目标**：登录时一键填充 + MFA 时自动填 TOTP

**任务清单**：

#### 3.1 Content Script
- [ ] `libs/fill/nativeInputValueSetter.ts`
- [ ] `libs/fill/detector.ts`：detectFields / detectLoginForm
- [ ] `libs/fill/formFiller.ts`：silentFill / showAccountPicker
- [ ] `libs/fill/observer.ts`：MutationObserver + ShadowRoot
- [ ] `libs/fill/accountPicker.ts`：浮动 picker（ShadowRoot 隔离）
- [ ] `libs/fill/otpDetector.ts`：P0/P1/P2/P3 启发式
- [ ] `entrypoints/content.ts`：调度 detector/filler

#### 3.2 注册场景
- [ ] `libs/fill/saveDetector.ts`：检测注册表单 + 提取字段
- [ ] `entrypoints/inpage-overlay/SavePrompt.tsx`：浮动卡片 UI
- [ ] `entrypoints/inpage-overlay/AccountPicker.tsx`：Content 注入版 picker

#### 3.3 消息扩展
- [ ] `libs/messaging/handlers/background.ts` 加 matchAccountsForUrl / getCurrentTOTP / account.touchLastUsed / save.request / fill.request
- [ ] `libs/messaging/handlers/content.ts`

#### 3.4 E2E 测试
- [ ] tests/e2e/unlock-fill.spec.ts：mock 登录页填充
- [ ] tests/e2e/register-save.spec.ts：mock 注册页保存
- [ ] tests/e2e/totp-fill.spec.ts：mock MFA 页 TOTP 自动填

#### 3.5 验收标准
- [ ] 在 mock 登录页（有 username + password）→ 扩展自动填入
- [ ] 同一站有 2 个账号 → 弹 picker → 选 → 填入
- [ ] 提交登录后等 800ms → OTP 输入框被自动填
- [ ] 在 mock 注册页注册 → SavePrompt 弹 → 点保存 → KDBX 有新账号
- [ ] 永不保存按钮 → 该域名不再弹
- [ ] React 受控组件（用 React 写的 mock 站）能正确响应

---

### 阶段 4：完善（M5+，按需）

**任务清单**：

#### 4.1 同步完善
- [ ] `libs/kdbx/merge.ts`：冲突合并算法
- [ ] `entrypoints/popup/ConflictResolver.tsx`：UI
- [ ] `libs/webdav/sync.ts`：handleConflict 完整流程
- [ ] 5 分钟 alarm 自动同步（仅下载）
- [ ] `.meta.json` 缓存（v2 简化为本地）

#### 4.2 导入导出
- [ ] `libs/kdbx/import.ts`：JSON / KDBX 文件解析
- [ ] `libs/kdbx/export.ts`：JSON / KDBX / otpauth URI
- [ ] `entrypoints/options/ImportPanel.tsx` + `ExportPanel.tsx`
- [ ] 二次确认弹窗（明文导出）

#### 4.3 主密码修改
- [ ] `libs/auth/password.ts`：changeMasterPassword
- [ ] `libs/auth/strength.ts`：密码强度评估
- [ ] `entrypoints/options/ChangePasswordPanel.tsx`

#### 4.4 自动锁定
- [ ] `libs/auth/lock.ts`：锁定流程
- [ ] `libs/messaging/session.ts`：session 票据
- [ ] `entrypoints/options/AutoLockConfig.tsx`

#### 4.5 边角
- [ ] `entrypoints/popup/ErrorToast.tsx`：统一错误展示
- [ ] `entrypoints/popup/SyncStatusBar.tsx`：状态条
- [ ] Options Page 顶栏
- [ ] About 页

#### 4.6 验收标准
- [ ] 改主密码后，浏览器+手机都需重输新密码
- [ ] 5 分钟不操作 → 自动锁 → 再点扩展 → 回到 UnlockScreen
- [ ] 导出 JSON 后能在新装扩展导入
- [ ] 手动制造冲突（两端同时改）→ 弹 ConflictResolver → 解决后正确合并

---

## 2. 关键难点与解决方案

详见各 SPEC 的"难点"小节，这里汇总：

| # | 难点 | SPEC | 解决方案 |
|---|---|---|---|
| 1 | Service Worker 休眠导致 webdav session 丢失 | [03-webdav.md](./03-webdav.md) | 每次操作新建 client，不持有长连接 |
| 2 | 主密码输错无法区分（防计时攻击） | [02-kdbx.md](./02-kdbx.md) | KDBXweb 派生函数对错密码仍跑完整时间 |
| 3 | 同一账号两端同时改 TOTP | [02-kdbx.md §6](./02-kdbx.md) | entry 级别合并，totp 冲突弹窗 |
| 4 | React 受控组件不响应 `input.value =` | [05-fill.md §2](./05-fill.md) | nativeInputValueSetter + 派发 input/change 事件 |
| 5 | 浏览器 storage 配额 (10MB) | [07-storage.md](./07-storage.md) | 30 条规模 < 20KB，无需担心 |
| 6 | 用户误删云盘 KDBX | [03-webdav.md](./03-webdav.md) | 依赖云盘版本控制（坚果云有 30 天历史），不做自动备份 |
| 7 | 首次注册时主密码还没设 | [09-popup.md §3.1](./09-popup.md) | 主密码在首次"加账号"时强制设置 |
| 8 | WebDAV 服务不支持 LOCK | [03-webdav.md §6](./03-webdav.md) | 不依赖 LOCK，用 If-Match + 合并 |
| 9 | 网页 DOM 变化频繁触发 detector | [05-fill.md §3.4](./05-fill.md) | MutationObserver + 300ms 防抖 |
| 10 | TOTP 实时刷新导致 re-render 全列表 | [09-popup.md §3.2](./09-popup.md) | 单条 AccountItem 内部用 key + 局部 state |
| 11 | 改主密码时如何保证原子性 | [10-options.md §4.2](./10-options.md) | 上传新 KDBX 后才清旧 session，失败时回滚 |
| 12 | Web Crypto API 不支持 Argon2id | [08-security.md §3.3](./08-security.md) | deviceKey 用 PBKDF2-SHA256 (KDBX 派生仍用 Argon2id) |
| 13 | `chrome.runtime.sendMessage` 偶尔超时 | [06-messaging.md](./06-messaging.md) | 错误捕获 + 用户提示 + 重试按钮 |
| 14 | popup 内嵌 picker 样式被页面 CSS 污染 | [05-fill.md §4.3](./05-fill.md) | ShadowRoot 隔离 |
| 15 | KDBX 文件结构升级（4.0 → 4.1）兼容性 | [02-kdbx.md §2.3](./02-kdbx.md) | v2 只写 4.1，导入时弹"请用桌面客户端另存" |

---

## 3. MVP 验收清单（v2 完成时）

### 3.1 功能验收

- [ ] **解锁**：输主密码能在 5 秒内解锁，看到账号列表
- [ ] **添加**：手动添加账号，刷新后仍在
- [ ] **删除**：删除账号，刷新后消失
- [ ] **TOTP 绑定**：能添加 TOTP（手动输或粘 URI），复制码与 Aegis 算的一致
- [ ] **WebDAV 同步**：配坚果云后，添加/删除账号能同步云端
- [ ] **登录填充**：在 mock 登录页能自动填入
- [ ] **多账号选择**：同域名 ≥ 2 账号时弹 picker
- [ ] **注册保存**：在 mock 注册页注册后弹 SavePrompt
- [ ] **TOTP 自动填**：登录后等 800ms 能自动填 OTP
- [ ] **冲突合并**：手动制造冲突能正确合并
- [ ] **自动锁定**：5 分钟不操作后自动锁
- [ ] **导入导出**：能导出 KDBX / JSON，导入 JSON 能正确恢复
- [ ] **改主密码**：能改主密码并强制重输

### 3.2 性能验收

- [ ] 冷启动 < 500ms（已解锁时）
- [ ] 解锁 < 5 秒（含 Argon2id 派生）
- [ ] TOTP 实时刷新 60fps（30 条规模）
- [ ] 列表滚动 60fps

### 3.3 安全验收

- [ ] 主密码不在任何持久化存储中
- [ ] chrome.storage 中的 webdav 凭据是密文
- [ ] Content Script 不持有 Account 对象
- [ ] 无 `eval` / `innerHTML` 写入
- [ ] 错误日志不含敏感数据
- [ ] 强制 HTTPS（HSTS）

### 3.4 测试验收

- [ ] `libs/` 单元测试覆盖率 ≥ 80%
- [ ] 4 个 E2E 场景全部通过
- [ ] 关键路径（unlock → fill → save）E2E 跑通
- [ ] 移动端 Keepass2Android 互通测试通过

---

## 4. 弃用清单

| 项 | 处理 |
|---|---|
| 旧 `base.md` | 已移动到 `docs/base-思路稿-v1.md` |
| 旧 `SPEC.md` | 已删除（v2 范围确定后无意义） |
| 旧 `manifest.json` | 已删除（WXT 自动生成） |
| 旧 `src/lib/*` | 已删除（v2 完全重写） |
| 旧 `package.json` / `vite.config.ts` / `tsconfig.json` | 已删除（WXT 重新生成） |
| 旧 `node_modules/` | 已删除（重装） |
| 旧 `src/background/` / `src/content/` / `src/popup/` | 已删除（v2 走 WXT entrypoints 约定） |
| 旧 `public/`（图标） | 已删除，v2 重新生成 |

---

## 5. 后续待办（v2 范围外）

按优先级排序：

### P0（v3 必做）
- [ ] **License 文件**（先决定协议）
- [ ] **暗色模式**（依赖 theme 字段已经预留）
- [ ] **搜索/过滤**（账号多了之后必需）
- [ ] **标签/分组**（按使用场景分类）

### P1（v3 候选）
- [ ] **二维码扫描**（`jsQR` + `camera` permission，扩展内扫网站 MFA 二维码，避免手工输）
- [ ] **Bitwarden JSON 导入**（用户迁移路径）
- [ ] **CSV 导入**
- [ ] **P4 框选模式**（用户手动指定 selector）
- [ ] **生物识别解锁**（Web Authentication API，需要浏览器支持）

### P2（远期）
- [ ] **国际化 (i18n)**
- [ ] **Android 后台自动同步**（Keepass2Android 支持，需用户主动开启）
- [ ] **跨设备主密码重置机制**（社会恢复 / Shamir 秘密分享）—— **慎重考虑**
- [ ] **PWA 版本**（iOS Safari 扩展受限时）—— **不做**，用户已确认 Android only
- [ ] **iOS 支持**（Strongbox/KeePassium）—— **不做**，同上
- [ ] **扩展商店发布**（License 决定后才能做）

---

## 6. 与 v1 思路稿的差异

| 维度 | v1 思路稿 | v2 实施 |
|---|---|---|
| 账号模型 | 隐含"完整凭证集" | 显式定义 `{username, password, totp?, url, notes}` |
| 加密 | Argon2id (提到但未指定) | **KDBX 用 Argon2id**，**deviceKey 用 PBKDF2**（实现差异化） |
| 云盘 | OAuth + OneDrive/Google Drive/Dropbox | **WebDAV**（坚果云/自建 NAS） |
| 注入 world | ISOLATED vs MAIN 自相矛盾 | **明确只用 ISOLATED** |
| 时间 API | 3 个含凑数 | 2 个真实时间服务 + 中位数 |
| 注册保存 | **未提及** | **新增主动保存流程** |
| 多账号选择 | 提了一句 | **完整 picker UI 规范** |
| 同步冲突 | 提到"合并"但未实现 | **entry 级 + 字段级 + 弹窗** |
| License | 暗示开源 | **暂不定** |
| 手机端 | "自选 App 通用" | **Keepass2Android 主推** |
| 同步方式 | 未明确 | **手动拉取（打开 App 即拉）** |

---

## 7. 实施建议

### 7.1 每日工作流

```
[看 SPEC 找下一个任务] → [写单测] → [写实现] → [跑测试] → [commit]
```

### 7.2 不要做的事

- ❌ **不要**在阶段 1 做阶段 4 的事（feature creep）
- ❌ **不要**重构已通过的代码（除非有明确 bug）
- ❌ **不要**为"未来可能需要"加抽象
- ❌ **不要**跳过测试直接写实现

### 7.3 应该做的事

- ✅ 每个 SPEC 对应的模块, **先**写完单测再写实现
- ✅ 任何"以后再加"的想法写到 §5 待办
- ✅ 改动影响多文件时, 同步更新对应的 SPEC
- ✅ 完成阶段后跑一遍 §3 验收清单
