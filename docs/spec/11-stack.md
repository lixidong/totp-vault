# SPEC 11: 技术栈与目录结构

> **目的**：定义 npm 依赖、目录结构、构建配置、开发工具
> **对应文件**：项目根目录所有配置文件 + `src/` 目录
> **依赖**：所有 SPEC
> **被依赖**：[12-roadmap.md](./12-roadmap.md) 引用本 SPEC 的目录

---

## 1. 技术栈

| 层 | 选型 | 版本 | 理由 |
|---|---|---|---|
| 扩展框架 | **WXT** | ^0.20 | Vite + TS, MV3 友好, 自动生成 manifest |
| UI 框架 | **React** | ^18.3 | 状态简单,生态成熟 |
| 状态管理 | React useState + useReducer | — | 无 Redux 需要 |
| KDBX | **kdbxweb** | ^4 | 唯一成熟 TS 库 |
| TOTP | **otpauth** | ^9 | RFC 6238, < 10KB |
| WebDAV | **webdav** | ^5 | 纯 JS, TS 友好 |
| 加密 | Web Crypto API | 内置 | 浏览器自带 |
| Schema 校验 | **zod** | ^3 | 运行时校验 + TS 类型 |
| ID 生成 | **uuid** | ^10 | 备用,主要用 crypto.randomUUID() |
| 测试 | **Vitest** + **Playwright** | latest | 单测 + E2E |
| Lint | **ESLint** + **typescript-eslint** | latest | — |
| 格式化 | **Prettier** | ^3 | — |
| 包管理 | **npm** | — | 项目默认 |

**故意不引**：
- ❌ Redux / Zustand / Jotai（< 30 条规模不需要）
- ❌ Tailwind / shadcn（手写 CSS 够用）
- ❌ i18n 库（v2 不做多语言）
- ❌ Storybook（v2 组件少）
- ❌ zxcvbn（密码强度本地启发式足够）

---

## 2. 完整目录结构

```
totp-vault/
├── docs/                              # 设计/方案文档
│   ├── architecture.md                # v2 蓝图
│   ├── base-思路稿-v1.md              # 归档
│   └── spec/                          # 模块 SPEC(本目录)
│       ├── 00-overview.md
│       ├── 01-types.md
│       ├── 02-kdbx.md
│       ├── 03-webdav.md
│       ├── 04-totp.md
│       ├── 05-fill.md
│       ├── 06-messaging.md
│       ├── 07-storage.md
│       ├── 08-security.md
│       ├── 09-popup.md
│       ├── 10-options.md
│       ├── 11-stack.md                # 本文件
│       └── 12-roadmap.md
│
├── src/                               # 源代码
│   ├── entrypoints/                   # WXT 入口约定
│   │   ├── background.ts              # Service Worker
│   │   ├── content.ts                 # Content Script 入口
│   │   ├── popup/                     # 弹窗 (主交互界面)
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── UnlockScreen.tsx
│   │   │   │   ├── Main.tsx
│   │   │   │   ├── AccountList.tsx
│   │   │   │   ├── AccountItem.tsx
│   │   │   │   ├── AccountDetail.tsx
│   │   │   │   ├── AccountForm.tsx
│   │   │   │   ├── TOTPBindingForm.tsx
│   │   │   │   ├── AccountPicker.tsx       # Popup 简化版
│   │   │   │   ├── ConflictResolver.tsx
│   │   │   │   ├── ImportExportPanel.tsx
│   │   │   │   ├── ErrorToast.tsx
│   │   │   │   └── SyncStatusBar.tsx
│   │   │   └── styles/
│   │   │       ├── popup.css
│   │   │       └── tokens.css         # 颜色/间距变量
│   │   ├── options/                   # Options Page
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── WebDAVConfig.tsx
│   │   │   │   ├── AutoLockConfig.tsx
│   │   │   │   ├── ChangePasswordPanel.tsx
│   │   │   │   ├── ImportPanel.tsx
│   │   │   │   ├── ExportPanel.tsx
│   │   │   │   └── AboutPanel.tsx
│   │   │   └── styles/
│   │   │       └── options.css
│   │   └── inpage-overlay/            # 页面内浮动卡片
│   │       ├── SavePrompt.tsx
│   │       └── AccountPicker.tsx      # Content 注入版
│   │
│   ├── libs/                          # 纯业务逻辑, 无 React 依赖
│   │   ├── auth/                      # 主密码 / KDBX 解锁 / 加密
│   │   │   ├── kdbx.ts                # 加载/创建 KDBX
│   │   │   ├── credentials.ts         # deviceKey 派生
│   │   │   ├── crypto.ts              # encryptJSON / decryptJSON
│   │   │   ├── password.ts            # changeMasterPassword
│   │   │   ├── strength.ts            # 密码强度评估
│   │   │   ├── lock.ts                # 锁定流程
│   │   │   └── validation.ts          # validateAccount / isValidBase32
│   │   ├── kdbx/                      # KDBX CRUD
│   │   │   ├── repository.ts          # 内存对象操作
│   │   │   ├── convert.ts             # Entry ↔ Account
│   │   │   ├── merge.ts               # 冲突合并
│   │   │   └── import.ts              # 导入逻辑
│   │   │   └── export.ts              # 导出逻辑
│   │   ├── webdav/                    # WebDAV 客户端
│   │   │   ├── client.ts              # webdav 库包装
│   │   │   ├── config.ts              # 凭据加解密
│   │   │   ├── sync.ts                # 同步流程
│   │   │   └── errors.ts              # 错误映射
│   │   ├── totp/                      # TOTP 计算
│   │   │   ├── generate.ts            # generateTOTP
│   │   │   ├── base32.ts              # 校验/归一化/编解码
│   │   │   ├── timeSync.ts            # 多 API 时间校准
│   │   │   └── otpauth.ts             # URI 解析/生成
│   │   ├── fill/                      # 表单检测与填充
│   │   │   ├── detector.ts            # 字段检测 + login form
│   │   │   ├── formFiller.ts          # 填充逻辑
│   │   │   ├── saveDetector.ts        # 注册场景
│   │   │   ├── otpDetector.ts         # OTP 输入框
│   │   │   ├── nativeInputValueSetter.ts
│   │   │   ├── accountPicker.ts       # Content 注入的 picker
│   │   │   └── observer.ts            # MutationObserver
│   │   ├── messaging/                 # 消息协议
│   │   │   ├── protocol.ts            # 消息类型(在 01)
│   │   │   ├── send.ts                # sendMessage 封装
│   │   │   ├── session.ts             # session 票据
│   │   │   └── handlers/
│   │   │       ├── background.ts      # SW 侧
│   │   │       ├── content.ts         # Content 侧
│   │   │       └── popup.ts           # UI 侧
│   │   └── storage/                   # chrome.storage 封装
│   │       ├── local.ts
│   │       ├── session.ts
│   │       ├── schema.ts              # StorageSchema + zod
│   │       ├── encrypted.ts           # 加密项读写
│   │       └── quota.ts
│   │
│   ├── shared/                        # 跨入口共享的常量/工具
│   │   ├── constants.ts               # SESSION_TTL, AUTO_LOCK_DEFAULT 等
│   │   ├── errors.ts                  # ValidationError 等
│   │   ├── time.ts                    # 格式化
│   │   └── url.ts                     # origin 提取
│   │
│   └── styles/                        # 全局样式
│       ├── reset.css
│       └── tokens.css
│
├── public/                            # 静态资源
│   ├── icons/
│   │   ├── icon-16.png
│   │   ├── icon-32.png
│   │   ├── icon-48.png
│   │   └── icon-128.png
│   └── otpauth-uri-template.txt
│
├── tests/
│   ├── unit/                          # Vitest
│   │   ├── kdbx.test.ts
│   │   ├── totp.test.ts
│   │   ├── webdav.test.ts
│   │   ├── fill.test.ts
│   │   ├── storage.test.ts
│   │   └── security.test.ts
│   ├── component/                     # React Testing Library
│   │   ├── popup.test.tsx
│   │   └── options.test.tsx
│   ├── e2e/                           # Playwright
│   │   ├── unlock-fill.spec.ts
│   │   ├── register-save.spec.ts
│   │   ├── totp-fill.spec.ts
│   │   └── webdav-sync.spec.ts
│   └── fixtures/                      # 测试用 KDBX 文件
│       ├── test.kdbx
│       └── test.json
│
├── wxt.config.ts                      # WXT 配置
├── tsconfig.json
├── package.json
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
├── .nvmrc                             # Node 版本
├── README.md
└── LICENSE                            # v2 暂不创建
```

**关键约定**：
- `libs/` 下**绝对不**依赖 React/UI 框架
- 每个 `lib/<name>/` 自成一个子模块, 独立 `index.ts` 出口
- `entrypoints/` 是 WXT 约定目录
- 单元测试与源代码并列放 `tests/unit/`, **不**放 `*.test.ts` 在源码旁

---

## 3. WXT 配置（wxt.config.ts）

```typescript
import { defineConfig } from 'wxt';

// npm package name: totp-vault (package.json)
// manifest name: totp-vault (user-visible)
export default defineConfig({
  srcDir: 'src',
  outDir: '.output',

  manifest: {
    name: 'totp-vault',
    description: 'Password manager + TOTP authenticator, data on your WebDAV',
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['assets/*'],
        matches: ['<all_urls>'],
      },
    ],
  },

  // 入口配置(略,WXT 自动识别 entrypoints/)
  // ...

  vite: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
  },
});
```

**为什么 WXT 不是 Plasmo**：
- WXT 更轻量, vite 原生
- Plasmo 的 HMR 体验好但打包配置复杂
- WXT 直接复用 vite 生态

---

## 4. npm scripts

```json
{
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "compile": "tsc --noEmit",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "format": "prettier --write \"src/**/*\" \"tests/**/*\"",
    "format:check": "prettier --check \"src/**/*\" \"tests/**/*\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "postinstall": "wxt prepare"
  }
}
```

---

## 5. tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["chrome", "wxt"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*", "wxt.config.ts"],
  "exclude": ["node_modules", ".output", ".wxt"]
}
```

**关键**：
- `noUncheckedIndexedAccess: true` —— 数组/对象索引访问**必须**检查 undefined
- `types: ["chrome", "wxt"]` —— MV3 全局类型
- `paths` 别名 `@/*` 配 vite alias

---

## 6. ESLint 配置

```javascript
// .eslintrc.cjs
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // 安全相关
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',

    // libs/ 不能依赖 React
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['react', 'react-dom', 'react/*'],
        message: 'libs/ 不允许依赖 React,请在 entrypoints/ 使用',
      }],
    }],

    // 安全: console 不能输出敏感数据
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      files: ['src/libs/**/*'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['react', 'react-dom', 'react/*', '@/entrypoints/*'],
            message: 'libs/ 是纯业务逻辑,不允许引用 UI/入口',
          }],
        }],
      },
    },
  ],
};
```

**关键**：
- `libs/` 通过 ESLint 强制**不能** import React
- 任何 `console.log` 警告（鼓励用 console.error 但内容要脱敏）
- `eval` / `new Function` 禁止

---

## 7. .gitignore

```gitignore
# Dependencies
node_modules/

# Build output
.output/
.wxt/
dist/

# Test artifacts
coverage/
test-results/
playwright-report/

# IDE
.idea/
.vscode/*
!.vscode/settings.json
!.vscode/launch.json

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.local
```

**保留**：
- `.vscode/settings.json` 和 `.vscode/launch.json`（团队共享的调试配置）
- `.nvmrc`（Node 版本锁定）

---

## 8. 初始化命令（按顺序）

```bash
# 1. 创建项目
npx wxt@latest init totp-vault
cd totp-vault

# 2. 安装核心依赖
npm install kdbxweb otpauth webdav zod

# 3. 安装开发依赖
npm install -D @types/chrome @types/node eslint @typescript-eslint/parser \
  @typescript-eslint/eslint-plugin eslint-plugin-react eslint-plugin-react-hooks \
  prettier vitest @vitest/ui @testing-library/react @testing-library/jest-dom \
  jsdom @playwright/test

# 4. 初始化 Playwright
npx playwright install

# 5. 创建目录
mkdir -p src/entrypoints/{popup,options,inpage-overlay}/components
mkdir -p src/libs/{auth,kdbx,webdav,totp,fill,messaging,storage}
mkdir -p src/{shared,styles}
mkdir -p tests/{unit,component,e2e,fixtures}

# 6. WXT 准备(自动生成 .wxt/types/)
npm run postinstall
```

---

## 9. 开发工作流

### 9.1 日常开发

```bash
npm run dev
# → WXT 启动 dev server
# → 打开 chrome://extensions
# → 加载已解压的扩展: .output/chrome-mv3/
# → 改代码 → 自动重载
```

### 9.2 调试 Content Script

```bash
# 在 chrome://extensions 找到扩展 → 点 "service worker" → DevTools 打开
# Content Script 调试: 在页面 DevTools → Sources → Content Scripts
```

### 9.3 调试 Web Crypto / deviceKey

```bash
# SW DevTools console:
chrome.runtime.sendMessage({ type: 'isUnlocked' });
```

### 9.4 加载到 Edge

```bash
npm run build
# → 加载 .output/chrome-mv3/ 到 edge://extensions
```

---

## 10. 测试策略

| 层级 | 工具 | 覆盖范围 |
|---|---|---|
| 单元测试 | Vitest | `libs/` 全部,约 80% 覆盖率目标 |
| 组件测试 | Vitest + React Testing Library | `entrypoints/*/components/*` 关键交互 |
| E2E | Playwright | 4 个核心场景(unlock/fill/save/totp-fill) |

**E2E 关键场景**：
1. **unlock-fill.spec.ts**：点扩展 → 输密码 → 看到账号 → 在 mock 登录页填充
2. **register-save.spec.ts**：访问 mock 注册页 → 提交 → 看到 SavePrompt → 保存 → 检查 KDBX
3. **totp-fill.spec.ts**：登录 mock 页 → 等 800ms → OTP 自动填入
4. **webdav-sync.spec.ts**：配 mock WebDAV → 添加账号 → 重启 → 数据保持

---

## 11. CI/CD（v2 范围外占位）

v2 仅本地开发,不上 CI。v3 候选:
- GitHub Actions: lint + test + build
- 自动打包为 `.zip` 供 Chrome Web Store 上传
- 扩展商店发布（License 决定后才能做）
