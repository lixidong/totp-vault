# SPEC 05: 表单检测与填充

> **目的**：浏览器侧的两个核心场景——**注册时主动保存**、**登录时自动填充**（含 TOTP）
> **对应文件**：`src/libs/fill/`（detector.ts, formFiller.ts, saveDetector.ts, otpDetector.ts, nativeInputValueSetter.ts）+ `src/entrypoints/content.ts` + `src/entrypoints/inpage-overlay/SavePrompt.tsx`
> **依赖**：[01-types.md](./01-types.md), [04-totp.md](./04-totp.md), [06-messaging.md](./06-messaging.md)
> **被依赖**：[09-popup.md](./09-popup.md)（AccountPicker 组件契约）, [12-roadmap.md](./12-roadmap.md)

---

## 1. 总体架构

```
[Content Script 注入到所有页面]
   ↓
[Init] 监听 DOM 变化(MutationObserver)
   ↓
[Detector 扫描] 找到 <form> + <input>
   ├─ 找到登录表单 → 触发 [自动填充检测] ─→ 弹出 AccountPicker
   ├─ 找到注册表单 + submit → 触发 [主动保存检测] ─→ 弹出 SavePrompt
   └─ 找到 OTP 输入框 + URL 匹配 → 触发 [TOTP 自动填] ─→ 计算并填入
```

**关键原则**：
- Content Script **不持有**任何敏感数据
- 所有账号数据通过 `chrome.runtime.sendMessage` 从 SW 取
- 页面 JS **不能**读取 Content Script 注入的值（ISOLATED world 隔离）
- 用 `nativeInputValueSetter` 触发 React/Vue 受控组件正确响应

---

## 2. nativeInputValueSetter

详见 architecture.md §6.3。封装在独立文件以便复用。

```typescript
// libs/fill/nativeInputValueSetter.ts
export function setInputValue(input: HTMLInputElement, value: string): void {
  // 找到原型上的原生 value setter
  const proto = Object.getPrototypeOf(input) as object;
  const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

  if (valueDescriptor && valueDescriptor.set) {
    // 走原生 setter,绕过框架拦截
    valueDescriptor.set.call(input, value);
  } else {
    input.value = value;
  }

  // 派发事件,通知 React/Vue 状态更新
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

**为什么需要**：
- React 16+ 用 `Object.defineProperty` 劫持了 `value` setter
- 直接 `input.value = 'x'` 在 React 组件内不触发 `onChange`
- 走原生 setter + dispatch event 才能让框架"看到"值变化

**测试**：
```typescript
test('setInputValue 在 React 受控组件中触发 onChange', () => {
  // 模拟 React 组件
  const input = document.createElement('input');
  let captured = '';
  input.addEventListener('input', () => { captured = input.value; });
  setInputValue(input, 'newvalue');
  expect(captured).toBe('newvalue');
});
```

---

## 3. 表单检测（detector.ts）

### 3.1 输入识别

```typescript
type DetectedField = {
  element: HTMLInputElement;
  type: 'username' | 'password' | 'otp' | 'email' | 'tel' | 'unknown';
  form: HTMLFormElement | null;
};

export function detectFields(root: ParentNode = document): DetectedField[] {
  // 收集所有 <input>, <textarea>, <select>
  const inputs = root.querySelectorAll<HTMLInputElement>('input, textarea, select');

  return Array.from(inputs)
    .filter(isVisible)
    .map(detectFieldType)
    .filter(f => f.type !== 'unknown');
}

function isVisible(el: HTMLElement): boolean {
  if (el.type === 'hidden') return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (el.offsetParent === null && style.position !== 'fixed') return false;
  return true;
}
```

### 3.2 字段类型启发式（P0~P2，v2 必做）

| 优先级 | 检测方式 |
|---|---|
| P0 | `autocomplete` 属性 (`"username"` / `"current-password"` / `"one-time-code"` / `"email"` / `"tel"`) |
| P1 | `type` 属性 (`"password"` → password, `"email"` → email, `"tel"` → tel) |
| P2 | `name` / `id` 包含关键字（`/user|login|account/i` → username, `/pass|secret|pwd/i` → password） |

**v2 不做**：
- ❌ Bitwarden 那种 600 行启发式（fork 会有 AGPL 传染问题）
- ❌ i18n 关键字识别（"用户名" / "账号"等中文）

### 3.3 登录表单识别

```typescript
type LoginForm = {
  form: HTMLFormElement;
  usernameField?: DetectedField;
  passwordField: DetectedField;
  submitButton: HTMLButtonElement | null;
};

export function detectLoginForm(): LoginForm | null {
  // 找 password 字段(P0/P1)
  const passwordFields = detectFields().filter(f => f.type === 'password');
  if (passwordFields.length === 0) return null;

  const passwordField = passwordFields[0];
  const form = passwordField.form;

  // 在同 form 内找 username 字段
  const usernameField = detectFields(form || document)
    .find(f => f.type === 'username' || f.type === 'email' || f.type === 'tel');

  // 找提交按钮
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]') ?? null;

  return { form: form || document.body, usernameField, passwordField, submitButton };
}
```

### 3.4 SPA 适配

```typescript
const observer = new MutationObserver(debounce(() => {
  const loginForm = detectLoginForm();
  if (loginForm) {
    tryAutoFill(loginForm);
  }
}, 300));

observer.observe(document.body, { subtree: true, childList: true });

// 监听 ShadowRoot
function watchShadowRoots(root: ParentNode) {
  root.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot) {
      observer.observe(el.shadowRoot, { subtree: true, childList: true });
    }
  });
}
```

**约束**：
- `subtree: true` 监听整个 DOM 树
- 防抖 300ms 避免输入时频繁触发
- ShadowRoot 递归监听（v2 仅一层，v3 多层）

---

## 4. 自动填充（formFiller.ts）

### 4.1 触发流程

```
[detectLoginForm 找到表单]
   ↓
[messaging.matchAccountsForUrl(location.origin)]
   ↓
[返回 0..N 个匹配的 Account]
   ├─ 0 个 → 不显示 picker
   ├─ 1 个 → 静默填入
   └─ ≥ 2 个 → 显示 [AccountPicker]
                ├─ 用户选了一个 → 填入
                └─ 用户按 Esc → 关闭
```

### 4.2 静默填入

```typescript
async function silentFill(loginForm: LoginForm, account: Account) {
  if (loginForm.usernameField) {
    setInputValue(loginForm.usernameField.element, account.username);
  }
  setInputValue(loginForm.passwordField.element, account.password);

  // 更新 lastUsedAt(异步,不等)
  chrome.runtime.sendMessage({ type: 'account.touchLastUsed', id: account.id });

  // 不自动 submit,让用户自己点
}
```

**不自动提交**的原因：
- 很多网站有 CAPTCHA / 二次验证 / 人机检测
- 自动提交反而触发风控

### 4.3 AccountPicker UI

详见 [09-popup.md](./09-popup.md) §3.4，但 Content Script 注入的 picker 是**简化版**：
- 浮在 password 输入框右下角
- 最多显示 3 个账号 + "显示全部" 链接
- 键盘 ↑/↓/Enter/Esc
- 点击外部关闭

```typescript
// libs/fill/accountPicker.ts
export function showAccountPicker(
  accounts: Account[],
  anchorEl: HTMLElement,
  onSelect: (account: Account) => void
): () => void {
  const root = document.createElement('div');
  root.id = 'totp-vault-picker';
  // 用 ShadowRoot 隔离样式
  const shadow = root.attachShadow({ mode: 'closed' });
  // ... 渲染 UI
  document.body.appendChild(root);
  return () => root.remove();
}
```

**ShadowRoot 原因**：
- 防止页面 CSS 干扰 picker 样式
- 防止 picker 的 class 名被页面 CSS 误伤

### 4.4 浮动"自动填充"按钮（P3 兜底）

当检测到登录表单但**没有** username/password 字段时（罕见但存在），显示一个浮动按钮。

```typescript
// 触发条件:
// - URL 在 sync.ignoreList
// - 或：检测到 "Sign in" 按钮 + <form>，但无可见 password 字段
// - 用户点按钮 → 手动选账号 → 通过 Picker 走完填充
```

**v2 范围**：仅做"URL 在 KDBX 中存在账号" + "无可见 password 字段" 时的兜底提示，不做"主动唤起 picker"。

---

## 5. OTP 输入框检测（otpDetector.ts）

### 5.1 P0~P3 启发式

| 优先级 | 检测方式 | 适用 |
|---|---|---|
| P0 | `autocomplete="one-time-code"` | Google / Microsoft / GitHub |
| P1 | 6 个相邻 `<input maxlength="1">` 数字框 | 腾讯云等 |
| P2 | 单一 input `maxlength="6" + type="tel"/"text" + inputmode="numeric"` | 通用 |
| P3 | 任何 `type="text" + name/id 包含 otp/code/2fa/mfa` | 兜底 |

```typescript
type OTPDetection =
  | { kind: 'single-input'; element: HTMLInputElement }
  | { kind: 'multi-input'; elements: HTMLInputElement[] }  // 6 个
  | { kind: 'not-found' };

export function detectOTPField(): OTPDetection {
  // P0
  const p0 = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
  if (p0) return { kind: 'single-input', element: p0 };

  // P1
  const p1Candidates = document.querySelectorAll<HTMLInputElement>('input[maxlength="1"][inputmode="numeric"]');
  if (p1Candidates.length === 6) {
    // 校验这 6 个 input 在视觉上连续
    return { kind: 'multi-input', elements: Array.from(p1Candidates) };
  }

  // P2
  const p2 = document.querySelector<HTMLInputElement>('input[maxlength="6"][type="tel"], input[maxlength="6"][type="text"][inputmode="numeric"]');
  if (p2) return { kind: 'single-input', element: p2 };

  // P3
  const p3 = document.querySelector<HTMLInputElement>('input[type="text"]');
  if (p3 && /otp|code|2fa|mfa|verification/i.test(p3.name + p3.id + p3.placeholder)) {
    return { kind: 'single-input', element: p3 };
  }

  return { kind: 'not-found' };
}
```

**v2 不做**：
- ❌ Bitwarden 那种基于属性的字段分类
- ❌ 验证码图标识别（用 OCR）

### 5.2 填充时机

```typescript
// 检测到登录表单 submit 成功后
// 等待 800ms(让页面进入 MFA 状态)
setTimeout(async () => {
  const otp = detectOTPField();
  if (otp.kind === 'not-found') return;

  // 通过 URL 匹配账号
  const accounts = await chrome.runtime.sendMessage({
    type: 'matchAccountsForUrl',
    url: location.origin,
  });

  const accountWithTOTP = accounts.find((a: Account) => a.totp);
  if (!accountWithTOTP) return;

  const code = await chrome.runtime.sendMessage({
    type: 'getCurrentTOTP',
    accountId: accountWithTOTP.id,
  });

  fillOTP(otp, code);
}, 800);
```

### 5.3 填充

```typescript
function fillOTP(otp: OTPDetection, code: string) {
  if (otp.kind === 'single-input') {
    setInputValue(otp.element, code);
  } else {
    // multi-input: 每个 box 一个字符
    otp.elements.forEach((input, i) => {
      setInputValue(input, code[i] || '');
    });
    // 焦点到第一个未填的框（如果用户已经在中间输入）
    const firstEmpty = otp.elements.find(input => !input.value);
    firstEmpty?.focus();
  }
}
```

**约束**：
- 填充后**不自动 submit**
- 如果 `copyTOTPToClipboard = true`，同时把 code 复制到剪贴板
- 如果 `autoFillTOTP = false`，**不填**，改为显示"已复制到剪贴板"的小提示

---

## 6. 注册场景主动保存（saveDetector.ts）

### 6.1 检测时机

```typescript
// 监听所有 <form> 的 submit 事件
document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (!isLikelyRegisterForm(form)) return;

  // 阻止默认跳转 1 个 tick,确认服务器接受了注册
  setTimeout(async () => {
    if (document.visibilityState === 'visible') {
      showSavePrompt(form);
    }
  }, 100);
}, true);  // capture 阶段,先于页面处理
```

### 6.2 注册表单识别

```typescript
function isLikelyRegisterForm(form: HTMLFormElement): boolean {
  // 1. 有 password 字段
  const hasPassword = !!form.querySelector('input[type="password"]');
  if (!hasPassword) return false;

  // 2. action 不指向登录页
  const action = form.action || location.href;
  if (/login|signin|sign-in/i.test(action)) return false;

  // 3. 不在 ignoreList
  if (ignoreList.includes(location.origin)) return false;

  // 4. 至少有 username/email 字段
  const inputs = Array.from(form.querySelectorAll('input'));
  const hasUserField = inputs.some(i =>
    i.type === 'email' || i.type === 'tel' || i.type === 'text' ||
    /user|email|login|account/i.test(i.name + i.id)
  );
  return hasUserField;
}
```

### 6.3 SavePrompt 浮卡

```typescript
// entrypoints/inpage-overlay/SavePrompt.tsx 的契约
type SavePromptProps = {
  form: HTMLFormElement;
  detectedUsername: string;
  detectedPassword: string;
  onSave: () => void;
  onNeverSave: () => void;  // 加入 ignoreList
  onDismiss: () => void;
};
```

**UI**：
```
┌────────────────────────────────────┐
│ [扩展图标] 保存到密码库?            │
│                                    │
│ 用户名: alice@example.com          │
│ 网址:   github.com                 │
│                                    │
│ [保存] [永不] [×]                  │
└────────────────────────────────────┘
```

**位置**：右下角悬浮，10 秒后自动消失（用户主动 dismiss 关闭）。

### 6.4 字段提取

```typescript
function extractFormData(form: HTMLFormElement): {
  username: string;
  password: string;
} | null {
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
  const passwordInput = inputs.find(i => i.type === 'password');
  if (!passwordInput?.value) return null;

  const usernameInput = inputs.find(i =>
    i.type === 'email' || i.type === 'tel' || i.type === 'text'
  );
  if (!usernameInput?.value) return null;

  return {
    username: usernameInput.value,
    password: passwordInput.value,
  };
}
```

**约束**：
- **不**抓取 credit card / hidden token / csrf
- **不**保存重复内容（如果 KDBX 已有同 url+username 的账号，弹"更新"而非"新建"）

---

## 7. 主动保存的边角情况

| 情况 | 处理 |
|---|---|
| 用户 dismiss 后又改表单 | 静默，**不**再弹（一次会话一次） |
| 同一站点的多账号注册（GitHub work + personal） | 弹卡让用户命名（"Work Account" / "Personal"） |
| 邮箱验证流程（先注册后激活） | 不处理，登录后再保存 |
| 网站用 fetch 提交（无 form submit） | 监听 `fetch` 拦截，**v3 候选**，v2 不做 |
| 提交后跳转到不同 origin | 用 formData 在跳转前抓取，**仅** form submit 流程 |

---

## 8. Content Script 入口

```typescript
// entrypoints/content.ts
import { detectLoginForm, tryAutoFill } from '@/libs/fill/detector';
import { detectOTPField, fillOTP } from '@/libs/fill/otpDetector';
import { isLikelyRegisterForm, showSavePrompt } from '@/libs/fill/saveDetector';
import { initObserver } from '@/libs/fill/observer';

// 启动
initObserver();

// 监听 chrome.runtime 消息(从 Popup 来)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fill.request') {
    const form = detectLoginForm();
    if (form) tryAutoFill(form, msg.accountId);
    sendResponse({ ok: true });
  }
});
```

**约束**：
- Content Script **不直接调用** `chrome.runtime.sendMessage({ type: 'createAccount' })`，而是：
  1. SavePrompt 弹卡
  2. 用户点 [保存] → Content Script 发 `save.request` 给 SW
  3. SW 调 `getRepository().createAccount()`
- 这是为了 Content Script **永远不持有账号数据**

---

## 9. 安全性

- **ISOLATED world**：见 architecture.md §6.3，v2 不用 MAIN world
- **不写入页面全局变量**：所有值通过 `setInputValue` 走原生 setter
- **不暴露给页面 JS**：ShadowRoot 隔离 picker
- **不监听 input 事件触发填充**：仅在 form submit 后/检测到登录表单时填充，避免被诱导
- **不持久化密码到页面 localStorage / sessionStorage**

---

## 10. 测试要点

```typescript
// tests/unit/fill.test.ts
describe('detector', () => {
  test('detectFields 找到 username + password 配对', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" />
        <input type="password" name="password" />
      </form>`;
    const form = detectLoginForm();
    expect(form?.usernameField?.type).toBe('email');
    expect(form?.passwordField?.type).toBe('password');
  });
});

describe('otpDetector', () => {
  test('P0: autocomplete="one-time-code"', () => { /* ... */ });
  test('P1: 6 个 maxlength=1 输入框', () => { /* ... */ });
  test('P2: maxlength=6 + type=tel', () => { /* ... */ });
});

// tests/e2e/fill.test.ts (Playwright)
describe('端到端', () => {
  test('在 GitHub 登录页触发 picker, 选中后填入', async () => { /* ... */ });
  test('注册 random site 后弹 SavePrompt', async () => { /* ... */ });
  test('登录 AWS 后等 800ms 自动填 TOTP', async () => { /* ... */ });
});
```
