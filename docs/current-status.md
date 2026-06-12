# 当前开发状态

> 更新时间：2026-06-12  
> 项目地址：https://github.com/lixidong/totp-vault  
> 当前版本：0.1.2 / 待发布 tag `v0.1.2`

## 给下一次 AI 的快速入口

如果你是下一次接手开发的 AI，请优先阅读：

1. `CLAUDE.md`：本项目的协作与开发上下文。
2. `docs/current-status.md`：当前已完成功能、发布状态、待办事项。
3. `docs/spec/12-roadmap.md`：最新路线图和优先级。
4. 需要改具体模块时，再阅读对应 `docs/spec/*.md`。

不要从旧规划文档逐项推断当前状态；很多功能已经实现，代码是最终权威。

## 当前已完成能力

### 核心密码库

- Chrome MV3 / WXT 扩展项目已搭建。
- 使用 KDBXweb 读写 KDBX。
- WebDAV 配置支持本地加密保存。
- 主密码用于解锁 KDBX 和加密 WebDAV 凭据。
- 支持账号 CRUD：新增、查看、编辑、删除。
- WebDAV 写入使用防抖上传。
- 解锁时只下载远端 KDBX；除首次远端不存在需要初始化外，不应因为解锁本身上传 DB。

### TOTP

- 支持 Base32 Secret 标准化和校验。
- 支持 TOTP 生成、剩余秒数计算。
- 支持 otpauth URI 解析和生成。
- Popup 中可绑定、解绑、编辑 TOTP。
- 点击 TOTP 数字可复制验证码；复制反馈显示在对应 TOTP 胶囊本身。

### 浏览器填充

- Content Script 可检测登录表单。
- 密码框旁显示填充触发图标。
- 点击图标后显示匹配账号列表，选择后填充账号密码。
- 未解锁时会打开解锁弹窗并提示用户先解锁。
- 登录后进入 TOTP 输入页且密码库锁定时，会打开解锁弹窗并提示先解锁获取验证码。
- 支持登录后 TOTP 输入框自动填充。
- 支持保存新账号提示：用户手动输入账号密码提交后，当前域名未匹配已有账号时提示保存。

### 导入导出

- Options 支持导出：
  - totp-vault JSON
  - Bitwarden JSON
  - 1Password JSON
- Options 支持导入：
  - totp-vault JSON
  - Bitwarden 常见 JSON
  - 1Password 常见 JSON
- 支持 merge / replace 导入模式。

### 设置与发布体验

- Options 支持 WebDAV 配置与重置。
- Options 支持自动锁定分钟数设置，`0` 表示不自动锁定。
- Options 支持主密码提示；提示只明文保存在本机，不保存主密码。
- Popup 解锁页显示主密码提示。
- manifest 已配置扩展图标和 action 图标。
- 图标已换成“锁 + TOTP 时钟”风格。
- Options 有版本号、权限说明、安全提示和备份提示。

### 扩展 ID 与跨重装保留

- `wxt.config.ts` 写入了固定的 `manifest.key`（派生自扩展 ID `hpgicjhhchdmnkandnlilgpnhgpcnkbm`），
  用户从 GitHub Release 下载 zip 拖拽安装后扩展 ID 保持不变。
- `chrome.storage.local` 中所有数据（WebDAV 加密配置、`settings`、`ignoreList`、`deviceId`）在重新安装后自动保留。
- `settings`、`ignoreList`、`deviceId` 还会双写到 `chrome.storage.sync`，便于多设备共享非敏感设置。
- **注意**：不要更换 `manifest.key`，否则会切换到新扩展 ID，所有用户本机数据失效。

### 测试与发布

- 已有 Vitest 单元测试：
  - TOTP helpers
  - JSON import/export formats
- 本地验证通过：
  - `npm run compile`
  - `npm test`
  - `npm run zip`
- Git 仓库已初始化并推送到 GitHub。
- 已添加 `.github/workflows/release.yml`：push `v*` tag 时自动测试、类型检查、打包并创建 GitHub Release。
- `v0.1.0` tag 已推送，GitHub Actions 应自动生成 Release。
- `v0.1.1` 已完成本地发布验证，已推送 tag。
- `v0.1.2` 已完成本地发布验证，待提交并推送 tag（主要改动：固定扩展 ID 避免重装后丢失 WebDAV 配置；非敏感设置双写到 chrome.storage.sync）。

## 当前重要实现细节

- 后台入口：`src/entrypoints/background.ts`
- Popup：`src/entrypoints/popup/App.tsx`
- Options：`src/entrypoints/options/App.tsx`
- Content Script：`src/entrypoints/content.ts`
- WebDAV 同步：`src/libs/webdav/sync.ts`
- KDBX repository：`src/libs/kdbx/repository.ts`
- 消息协议：`src/libs/messaging/protocol.ts`
- 导入导出：`src/libs/import-export/jsonFormats.ts`
- TOTP：`src/libs/totp/*`

关键行为：

- 解锁流程调用 `unlockWithConfig()` 下载远端 KDBX 并解密。
- 解锁不应触发 `saveAndUpload()`；只有真实数据变更才上传。
- 新增、编辑、删除、导入、绑定/解绑 TOTP、手动同步会上传。
- 远端 KDBX 不存在时，首次初始化会创建并上传空库。
- `syncMeta.lastSyncAt` 应代表实际上传/初始化时间，不要因为单纯解锁下载而刷新。

## 待完成内容（建议优先级）

1. 验证 GitHub Actions Release
   - 确认 `v0.1.0` Release 已生成。
   - 确认 release asset 包含 `.output/totp-vault-0.1.0-chrome.zip`。

2. 忽略网站列表
   - 对保存新账号提示支持“永久忽略该网站”。
   - Options 中支持查看和移除忽略域名。

3. 同步冲突处理
   - 当前仍偏最后写入 / If-Match 冲突报错。
   - 后续可做冲突提示、手动合并或 entry 级合并。

4. 填充兼容性增强
   - 针对复杂登录流继续调优 DOM 检测。
   - 增强 Shadow DOM、分步登录、手机号/邮箱登录等场景。

5. 测试补强
   - URL 匹配单元测试。
   - KDBX 转换 / repository 单元测试。
   - Content Script 表单检测测试。
   - Playwright E2E：登录填充、保存新账号、TOTP 自动填充。

6. 发布体验继续完善
   - 补 README 使用说明。
   - 补 Chrome 手动安装说明。
   - 后续如需正式商店发布，补隐私说明和权限说明。

7. 主密码修改
   - 支持修改 KDBX 主密码。
   - 同步更新 WebDAV 凭据加密。

## 已知注意事项

- 这是个人自用优先的项目，不要过度工程化。
- 不要保存主密码，也不要把主密码写入提示。
- 不要把 `.output/`、`.wxt/`、`node_modules/` 提交到仓库。
- `.github/workflows/release.yml` 会在 GitHub 上构建 release 包；本地 `.output/*.zip` 只是验证产物。
- 如果用户说重新加载插件没生效，优先确认是否重新运行了 `npm run build`，以及浏览器加载的是否是当前项目的 `.output/chrome-mv3`。
