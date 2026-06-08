# totp-vault Agent Context

本项目是个人自用优先的 Chrome MV3 浏览器扩展，用 WebDAV 同步 KDBX 密码库，并支持 TOTP 与网页登录填充。

## 开始前必须读

- `docs/current-status.md`：当前开发状态、已完成功能、待办事项、发布状态。
- `docs/spec/12-roadmap.md`：最新路线图。
- 具体改哪个模块，再读对应 `docs/spec/*.md`。

## 工作原则

- 代码是最终权威；旧 spec 可能滞后，先看当前实现。
- 优先做个人自用价值高的改动，避免过度工程化。
- 不保存主密码，不记录敏感数据到日志，不把 `.output/`、`.wxt/`、`node_modules/` 提交到仓库。
- 解锁只应下载并解密 KDBX；除首次远端不存在初始化外，不要因为解锁本身上传 DB。
- 实际数据变更才上传：新增、编辑、删除、导入、绑定/解绑 TOTP、手动同步。
- 用户使用简体中文沟通，回答也使用简体中文。

## 常用命令

- `npm run compile`
- `npm test`
- `npm run build`
- `npm run zip`

## 发布

- GitHub 仓库：`https://github.com/lixidong/totp-vault`
- tag 规则：`v*`
- `.github/workflows/release.yml` 会在 tag push 后自动测试、类型检查、打包并创建 GitHub Release。
