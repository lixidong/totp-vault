# SPEC 04: TOTP 模块

> **目的**：TOTP 验证码的生成、时间校准、otpauth URI 处理
> **对应文件**：`src/libs/totp/`（generate.ts, base32.ts, timeSync.ts, otpauth.ts）
> **依赖**：[01-types.md](./01-types.md)
> **被依赖**：[02-kdbx.md](./02-kdbx.md)（写 TOTPBinding）, [05-fill.md](./05-fill.md)（自动填 TOTP）, [09-popup.md](./09-popup.md)（手动复制）

---

## 1. 库选型

| 候选 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| `otpauth` (npm, 9.x) | TS 原生, 纯 JS, RFC 6238 完整实现, < 10KB | 文档一般 | ✅ 选这个 |
| `otplib` | 老牌 | 体积大, 依赖多 | ❌ |
| 自己用 Web Crypto | 0 依赖 | HMAC-SHA1/256/512 都要手写, RFC 4226 完整实现 ~200 行 | ❌ 工作量大 |

**安装**：
```bash
npm install otpauth@9
```

---

## 2. base32.ts

### 2.1 校验

```typescript
/**
 * 严格校验 base32 字符串（RFC 4648，不含填充符）
 * - 字符集 A-Z 2-7
 * - 长度 4 的倍数
 * - 解码后至少 8 字节
 */
export function isValidBase32(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (s.length === 0 || s.length % 8 !== 0) return false;
  if (!/^[A-Z2-7]+$/.test(s)) return false;
  try {
    const bytes = decode(s);
    return bytes.length >= 8;
  } catch {
    return false;
  }
}
```

### 2.2 归一化

```typescript
/**
 * 用户输入可能带空格、横线、小写
 * 统一转大写、去空白
 */
export function normalizeBase32(input: string): string {
  return input
    .replace(/[\s-]/g, '')  // 去空格、横线
    .toUpperCase();
}
```

### 2.3 解码

```typescript
/**
 * base32 字符串 → Uint8Array
 * 使用 otpauth 库内部的 base32 解析
 */
export function decode(base32: string): Uint8Array {
  return base32ToBytes(base32);
}
```

**为什么不自己写**：
- otpauth 库已经实现，~30 行，零成本复用
- 错误处理比自写更稳（边界条件：全 0 字符等）

### 2.4 编码（用于展示）

```typescript
/**
 * Uint8Array → base32 字符串（用于 otpauth URI 生成）
 */
export function encode(bytes: Uint8Array): string {
  return bytesToBase32(bytes);
}
```

**使用场景**：仅在生成"测试用" TOTP 账号时用到，正常用户流程不调用此函数。

---

## 3. generate.ts

### 3.1 核心函数

```typescript
import { Secret, TOTP } from 'otpauth';
import { decode } from './base32';

export function generateTOTP(
  binding: TOTPBinding,
  unixSeconds: number
): string {
  const totp = new TOTP({
    secret: new Secret(decode(binding.secretBase32)),
    algorithm: binding.algorithm,
    digits: binding.digits,
    period: binding.period,
  });
  return totp.generate({ timestamp: unixSeconds * 1000 });
}

export function getRemainingSeconds(
  binding: TOTPBinding,
  unixSeconds: number
): number {
  return binding.period - (unixSeconds % binding.period);
}
```

**约束**：
- `unixSeconds` 必须是**校准后**的 Unix 时间（见 §4），不是 `Date.now()/1000`
- 生成结果是字符串，**不是**数字（避免大整数精度问题）
- `digits` 不足时**左填充 0**（otpauth 库默认行为）

### 3.2 测试

```typescript
// RFC 6238 Appendix B 测试向量
test('SHA1 secret="JBSWY3DPEHPK3PXP" 1970-01-01T00:00:59 → 287082', () => {
  const binding: TOTPBinding = {
    secretBase32: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  };
  expect(generateTOTP(binding, 59)).toBe('287082');
});
```

---

## 4. timeSync.ts

### 4.1 时间源

| 源 | URL | 响应格式 | 可靠性 |
|---|---|---|---|
| WorldTimeAPI | `https://worldtimeapi.org/api/ip` | JSON: `{utc_datetime: "..."}` | 中（偶发 503） |
| WorldClockAPI | `http://worldclockapi.com/api/json/utc/now` | JSON: `{currentDateTime: "..."}` | 中 |

**v2 砍掉了 v1 思路稿里的 3 个**：
- ❌ `time.cloudflare.com`（不稳定，已多次下线）
- ❌ `googleapis.com/discovery/v1/apis`（凑数，会写审计日志）

### 4.2 校准流程

```typescript
type TimeSample = {
  source: 'worldtimeapi' | 'worldclockapi';
  serverUnix: number;  // 解析出的服务器时间
  rttMs: number;       // 往返耗时,用于过滤
  success: true;
};

type TimeFailure = {
  source: 'worldtimeapi' | 'worldclockapi';
  error: string;
  success: false;
};

async function fetchWorldTimeAPI(): Promise<TimeSample | TimeFailure> { /* ... */ }
async function fetchWorldClockAPI(): Promise<TimeSample | TimeFailure> { /* ... */ }

export async function calibrateTime(): Promise<number> {
  const results = await Promise.allSettled([
    fetchWorldTimeAPI(),
    fetchWorldClockAPI(),
  ]);

  const samples = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => (r as PromiseFulfilledResult<TimeSample>).value);

  if (samples.length === 0) {
    // 全部失败,降级到本地时间
    return Date.now() / 1000;
  }

  // 中位数(2 个样本时取平均)
  const times = samples.map(s => s.serverUnix + (s.rttMs / 2000) / 1000);
  times.sort((a, b) => a - b);
  const median = times.length === 1
    ? times[0]
    : (times[0] + times[1]) / 2;

  return Math.floor(median);
}
```

**为什么取中位数**：
- 2 个样本避免单点故障
- 异常值（比如某服务返回了 1970 时间）会拉偏均值，中位数更稳
- RTT 修正：服务器响应到达客户端时已经过了一半 RTT，所以"服务器发出时间 ≈ 收到时间 - RTT/2"

### 4.3 缓存

```typescript
const CACHE_KEY = 'timeOffset';
const CACHE_TTL_MS = 15 * 60 * 1000;  // 15 分钟

type CachedOffset = {
  offsetMs: number;       // 服务器 - 本地
  expiresAt: number;      // 缓存过期时间戳
  calibratedAt: number;   // 校准时间戳
};

export async function getUnixSecondsWithOffset(): Promise<number> {
  const { [CACHE_KEY]: cached } = await chrome.storage.local.get(CACHE_KEY);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return Math.floor((now + cached.offsetMs) / 1000);
  }

  // 缓存过期,重新校准
  const serverUnix = await calibrateTime();
  const offsetMs = serverUnix * 1000 - now;
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      offsetMs,
      expiresAt: now + CACHE_TTL_MS,
      calibratedAt: now,
    },
  });
  return serverUnix;
}
```

**约束**：
- 缓存存 `chrome.storage.local`，**不**走 EncryptedBlob（offset 不敏感）
- 缓存命中时**不**发网络请求
- 15 分钟过期：覆盖"用户上午登录一次，下午再登录"场景

---

## 5. otpauth.ts（URI 处理）

### 5.1 解析

```typescript
/**
 * 解析 otpauth:// URI,返回 TOTPBinding + label
 * 格式: otpauth://totp/Issuer:Account?secret=...&algorithm=...&digits=...&period=...&issuer=...
 */
export function parseOtpauthUri(uri: string): {
  binding: TOTPBinding;
  label: string;  // "Issuer:Account" 或 "Account"
} | null {
  try {
    if (!uri.startsWith('otpauth://totp/')) return null;
    const parsed = new URL(uri);
    const path = decodeURIComponent(parsed.pathname.slice(1));  // 去前导 "/"

    const secret = parsed.searchParams.get('secret');
    if (!secret || !isValidBase32(normalizeBase32(secret))) return null;

    const binding: TOTPBinding = {
      secretBase32: normalizeBase32(secret),
      algorithm: (parsed.searchParams.get('algorithm') as TOTPAlgorithm) || 'SHA1',
      digits: parseInt(parsed.searchParams.get('digits') || '6') as TOTPDigits,
      period: parseInt(parsed.searchParams.get('period') || '30') as TOTPPeriod,
      issuer: parsed.searchParams.get('issuer') || path.split(':')[0],
    };

    // 校验 digits/period 是合法值
    if (![6, 8].includes(binding.digits)) return null;
    if (![30, 60].includes(binding.period)) return null;
    if (!['SHA1', 'SHA256', 'SHA512'].includes(binding.algorithm)) return null;

    return { binding, label: path };
  } catch {
    return null;
  }
}
```

**容错**：
- secret 缺失/无效 → null
- digits/period 异常值 → null
- algorithm 异常值 → null
- **不抛异常**，调用方用 `if (result === null)` 判断

### 5.2 生成

```typescript
export function buildOtpauthUri(
  binding: TOTPBinding,
  label: string  // "Issuer:Account" 或 "Account"
): string {
  const params = new URLSearchParams({
    secret: binding.secretBase32,
    algorithm: binding.algorithm,
    digits: String(binding.digits),
    period: String(binding.period),
  });
  if (binding.issuer) params.set('issuer', binding.issuer);
  return `otpauth://totp/${encodeURIComponent(label)}?${params}`;
}
```

**使用场景**：导出 TOTP 给手机 App 用，详见 [09-popup.md](./09-popup.md) §5.4。

---

## 6. 在 fill 模块中的使用

```typescript
// libs/fill/otpDetector.ts 中,检测到 OTP 输入框后
async function fillOTP(account: Account) {
  if (!account.totp) return;
  const unix = await getUnixSecondsWithOffset();
  const code = generateTOTP(account.totp, unix);
  // ... 用 nativeInputValueSetter 填入
  // ... 更新 lastUsedAt
}
```

详见 [05-fill.md](./05-fill.md) §4。

---

## 7. 测试要点

```typescript
describe('base32', () => {
  test('isValidBase32 接受标准输入', () => {
    expect(isValidBase32('JBSWY3DPEHPK3PXP')).toBe(true);
  });
  test('isValidBase32 拒绝非法字符', () => {
    expect(isValidBase32('JBSWY3D0#K3PXP')).toBe(false);
  });
  test('normalizeBase32 去空格横线转大写', () => {
    expect(normalizeBase32('jbsw y3dp-ehpk3pxp')).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('TOTP', () => {
  test('RFC 6238 向量', () => { /* 见 §3.2 */ });
  test('剩余秒数正确', () => {
    expect(getRemainingSeconds({ ...binding }, 0)).toBe(30);
    expect(getRemainingSeconds({ ...binding }, 25)).toBe(5);
  });
});

describe('otpauth URI', () => {
  test('解析 Google Authenticator 导出格式', () => {
    const r = parseOtpauthUri('otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(r?.binding.secretBase32).toBe('JBSWY3DPEHPK3PXP');
  });
  test('生成的 URI 能被 Aegis 解析', () => {
    // E2E 测试
  });
});
```
