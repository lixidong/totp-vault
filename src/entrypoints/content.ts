import type { Account } from '@/shared/types';
import { AppError } from '@/shared/errors';
import { sendMessage } from '@/libs/messaging/send';
import { detectLoginForm, type LoginForm } from '@/libs/fill/detector';
import { silentFill } from '@/libs/fill/formFiller';
import { showAccountPicker, type AccountPicker } from '@/libs/fill/accountPicker';
import { showFillTrigger, type FillTrigger } from '@/libs/fill/fillTrigger';
import { detectOTPInput, fillOTP } from '@/libs/fill/otpDetector';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    new AutofillController().start();
  },
});

type PendingCredential = {
  url: string;
  username: string;
  password: string;
};

const PENDING_USERNAME_STORAGE_KEY = 'totp-vault:pending-username';
const PENDING_CREDENTIAL_STORAGE_KEY = 'totp-vault:pending-credential';
const PENDING_USERNAME_MAX_AGE_MS = 5 * 60 * 1000;
const PENDING_CREDENTIAL_MAX_AGE_MS = 5 * 60 * 1000;

type PendingUsername = {
  username: string;
  savedAt: number;
};

type StoredPendingCredential = PendingCredential & {
  savedAt: number;
};

class AutofillController {
  private trigger: FillTrigger | null = null;
  private picker: AccountPicker | null = null;
  private debounceId: number | null = null;
  private otpDebounceId: number | null = null;
  private lastAccounts: Account[] = [];
  private otpFilled = false;
  private pendingCredential: PendingCredential | null = null;
  private latestPassword = '';
  private promptedCredentialKeys = new Set<string>();
  private extensionFilledCredentialKeys = new Set<string>();

  start(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.scheduleScan();
        this.scheduleOTPFill();
        void this.restorePendingCredential();
      }, { once: true });
    } else {
      this.scheduleScan();
      this.scheduleOTPFill();
      void this.restorePendingCredential();
    }

    new MutationObserver(() => {
      this.scheduleScan();
      this.scheduleOTPFill();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('submit', (event) => {
      void this.capturePendingCredential(event).then(() => this.scheduleSavePrompt());
      window.setTimeout(() => {
        void this.fillCurrentOTP();
      }, 800);
    }, true);

    document.addEventListener('click', (event) => {
      void this.captureCredentialFromClick(event).then((captured) => {
        if (captured) this.scheduleSavePrompt();
      });
    }, true);

    document.addEventListener('input', (event) => {
      void this.captureCredentialFromInput(event);
    }, true);
    document.addEventListener('change', (event) => {
      void this.captureCredentialFromInput(event);
    }, true);
    window.addEventListener('pagehide', () => {
      void this.captureCredentialFromPage(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.captureCredentialFromPage(false);
    });

    window.addEventListener('scroll', () => this.scheduleScan(), true);
    window.addEventListener('resize', () => this.scheduleScan());
    document.addEventListener('focusin', () => this.scheduleOTPFill(), true);
  }

  private scheduleScan(): void {
    if (this.debounceId !== null) window.clearTimeout(this.debounceId);
    this.debounceId = window.setTimeout(() => {
      this.debounceId = null;
      this.scanLoginForm();
    }, 300);
  }

  private scheduleOTPFill(): void {
    if (this.otpDebounceId !== null) window.clearTimeout(this.otpDebounceId);
    this.otpDebounceId = window.setTimeout(() => {
      this.otpDebounceId = null;
      void this.fillCurrentOTP();
    }, 500);
  }

  private scanLoginForm(): void {
    const loginForm = detectLoginForm();
    if (!loginForm) {
      this.trigger?.close();
      this.trigger = null;
      return;
    }

    if (this.trigger) {
      this.trigger.update(loginForm);
      return;
    }

    this.trigger = showFillTrigger(loginForm, (currentForm) => {
      void this.showAccounts(currentForm);
    });
  }

  private async showAccounts(loginForm: LoginForm): Promise<void> {
    try {
      if (!(await isVaultUnlocked())) {
        await sendMessage({ type: 'openUnlockPopup' }).catch(() => undefined);
        showPageNotice('请先在 totp-vault 解锁密码库，然后再次点击填充图标。');
        return;
      }
      const accounts = await sendMessage({ type: 'matchAccountsForUrl', url: location.href });
      this.lastAccounts = accounts;
      if (accounts.length === 0) return;
      this.picker?.close();
      this.picker = showAccountPicker(loginForm.password, accounts, (account) => {
        this.fillAccount(loginForm, account);
      });
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_UNLOCKED') {
        await sendMessage({ type: 'openUnlockPopup' }).catch(() => undefined);
        showPageNotice('请先在 totp-vault 解锁密码库，然后再次点击填充图标。');
      }
    }
  }

  private fillAccount(loginForm: LoginForm, account: Account): void {
    silentFill(loginForm, account);
    this.picker?.close();
    this.picker = null;
    this.lastAccounts = [account, ...this.lastAccounts.filter((item) => item.id !== account.id)];
    this.extensionFilledCredentialKeys.add(credentialKey(location.origin, account.username));
  }

  private async capturePendingCredential(event: SubmitEvent): Promise<void> {
    await this.captureCredential(event);
  }

  private async captureCredentialFromClick(event: MouseEvent): Promise<boolean> {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const clickable = target.closest('button,input[type="button"],input[type="submit"],[role="button"]');
    if (!clickable) return false;
    return await this.captureCredential(event);
  }

  private async captureCredentialFromInput(event: Event): Promise<void> {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.type.toLowerCase() === 'password' && target.value) {
      this.latestPassword = target.value;
    }

    if (isLikelyUsernameInput(target)) {
      await this.storePendingUsername(target.value.trim());
    }
  }

  private async captureCredentialFromPage(prompt: boolean): Promise<boolean> {
    const username = findBestUsernameInput(document)?.value.trim() || await this.loadPendingUsername();
    const password = findBestPasswordInput(document)?.value || this.latestPassword;
    if (!username || !password) return false;

    const credential = { url: location.origin, username, password };
    const key = credentialKey(credential.url, credential.username);
    if (this.extensionFilledCredentialKeys.has(key) || this.promptedCredentialKeys.has(key)) return false;

    this.pendingCredential = credential;
    await this.storePendingCredential(credential);
    await this.clearPendingUsername();
    if (prompt) this.scheduleSavePrompt();
    return true;
  }

  private async captureCredential(event: Event): Promise<boolean> {
    const loginForm = detectLoginForm();
    if (!loginForm) {
      await this.captureUsernameOnly(event);
      return false;
    }

    const username = loginForm.username?.value.trim() || this.getUsernameFromEvent(event);
    const password = loginForm.password.value || this.latestPassword;
    if (!password) {
      await this.storePendingUsername(username);
      return false;
    }

    const fallbackUsername = await this.loadPendingUsername();
    const credentialUsername = username || fallbackUsername;
    if (!credentialUsername) return false;

    const credential = { url: location.origin, username: credentialUsername, password };
    const key = credentialKey(credential.url, credential.username);
    if (this.extensionFilledCredentialKeys.has(key) || this.promptedCredentialKeys.has(key)) return false;

    this.pendingCredential = credential;
    await this.storePendingCredential(credential);
    await this.clearPendingUsername();
    return true;
  }

  private async captureUsernameOnly(event: Event): Promise<void> {
    await this.storePendingUsername(this.getUsernameFromEvent(event));
  }

  private getUsernameFromEvent(event: Event): string {
    const form = event.target instanceof HTMLElement ? event.target.closest('form') : null;
    const root = form ?? document;
    const candidates = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
    const usernameInput = candidates.find((input) => isLikelyUsernameInput(input));
    return usernameInput?.value.trim() ?? '';
  }

  private async storePendingUsername(username: string): Promise<void> {
    if (!username) return;
    const pending: PendingUsername = { username, savedAt: Date.now() };
    await chrome.storage.session.set({ [PENDING_USERNAME_STORAGE_KEY]: pending });
  }

  private async loadPendingUsername(): Promise<string> {
    const data = await chrome.storage.session.get(PENDING_USERNAME_STORAGE_KEY);
    const pending = data[PENDING_USERNAME_STORAGE_KEY] as Partial<PendingUsername> | undefined;
    if (!pending) return '';

    if (typeof pending.username !== 'string' || typeof pending.savedAt !== 'number') return '';
    if (Date.now() - pending.savedAt > PENDING_USERNAME_MAX_AGE_MS) {
      await this.clearPendingUsername();
      return '';
    }
    return pending.username.trim();
  }

  private async clearPendingUsername(): Promise<void> {
    await chrome.storage.session.remove(PENDING_USERNAME_STORAGE_KEY);
  }

  private async storePendingCredential(credential: PendingCredential): Promise<void> {
    const pending: StoredPendingCredential = { ...credential, savedAt: Date.now() };
    await chrome.storage.session.set({ [PENDING_CREDENTIAL_STORAGE_KEY]: pending });
  }

  private async loadStoredPendingCredential(): Promise<PendingCredential | null> {
    const data = await chrome.storage.session.get(PENDING_CREDENTIAL_STORAGE_KEY);
    const pending = data[PENDING_CREDENTIAL_STORAGE_KEY] as Partial<StoredPendingCredential> | undefined;
    if (!pending) return null;

    if (
      typeof pending.url !== 'string'
      || typeof pending.username !== 'string'
      || typeof pending.password !== 'string'
      || typeof pending.savedAt !== 'number'
    ) return null;
    if (Date.now() - pending.savedAt > PENDING_CREDENTIAL_MAX_AGE_MS) {
      await this.clearStoredPendingCredential();
      return null;
    }
    return { url: pending.url, username: pending.username, password: pending.password };
  }

  private async clearStoredPendingCredential(): Promise<void> {
    await chrome.storage.session.remove(PENDING_CREDENTIAL_STORAGE_KEY);
  }

  private async restorePendingCredential(): Promise<void> {
    const credential = await this.loadStoredPendingCredential();
    if (!credential) return;
    this.pendingCredential = credential;
    await this.maybePromptSaveCredential();
  }

  private scheduleSavePrompt(): void {
    window.setTimeout(() => void this.maybePromptSaveCredential(), 1200);
  }

  private async maybePromptSaveCredential(): Promise<void> {
    const credential = this.pendingCredential;
    this.pendingCredential = null;
    if (!credential) return;

    const key = credentialKey(credential.url, credential.username);
    if (this.extensionFilledCredentialKeys.has(key) || this.promptedCredentialKeys.has(key)) return;
    this.promptedCredentialKeys.add(key);

    let accounts: Account[] = [];
    const unlocked = await isVaultUnlocked();
    if (unlocked) {
      accounts = await sendMessage({ type: 'matchAccountsForUrl', url: location.href });
      this.lastAccounts = accounts;
    }

    const exists = accounts.some((account) => account.username.trim().toLowerCase() === credential.username.toLowerCase());
    if (exists) return;

    showSaveAccountPrompt(credential, {
      onSave: async () => {
        try {
          await sendMessage({
            type: 'createAccount',
            account: {
              url: credential.url,
              username: credential.username,
              password: credential.password,
            },
          });
          showPageNotice('账号已保存到 totp-vault。');
          this.clearStoredPendingCredential();
        } catch (e) {
          if (e instanceof AppError && e.code === 'NOT_UNLOCKED') {
            await sendMessage({ type: 'openUnlockPopup' }).catch(() => undefined);
            throw new Error('请先解锁 totp-vault，然后再次点击保存。');
          }
          throw e;
        }
      },
      onIgnore: () => undefined,
    });
  }

  private async fillCurrentOTP(): Promise<void> {
    if (this.otpFilled) return;
    const target = detectOTPInput();
    if (!target) return;

    try {
      if (!(await isVaultUnlocked())) return;
      const accounts = this.lastAccounts.length > 0
        ? this.lastAccounts
        : await sendMessage({ type: 'matchAccountsForUrl', url: location.href });
      this.lastAccounts = accounts;
      const account = accounts.find((item) => item.totp);
      if (!account) return;
      const otp = await sendMessage({ type: 'getCurrentTOTP', accountId: account.id });
      fillOTP(target, otp.code);
      this.otpFilled = true;
    } catch {
    }
  }
}

async function isVaultUnlocked(): Promise<boolean> {
  try {
    const result = await sendMessage({ type: 'isUnlocked' });
    return result.unlocked;
  } catch {
    return false;
  }
}

function isLikelyUsernameInput(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.value.trim() === '') return false;
  const type = input.type.toLowerCase();
  if (!['text', 'email', 'tel', 'search', ''].includes(type)) return false;

  const name = `${input.name} ${input.id} ${input.autocomplete} ${input.placeholder} ${input.ariaLabel ?? ''}`.toLowerCase();
  if (/(user|login|email|account|mobile|phone|mail|用户名|账号|账户|邮箱|手机号)/i.test(name)) return true;
  return input.value.trim().length >= 3;
}

function findBestUsernameInput(root: ParentNode): HTMLInputElement | null {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input')).find((input) => isLikelyUsernameInput(input)) ?? null;
}

function findBestPasswordInput(root: ParentNode): HTMLInputElement | null {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    .find((input) => !input.disabled && !input.readOnly && input.value !== '') ?? null;
}

function credentialKey(url: string, username: string): string {
  return `${url}\n${username.trim().toLowerCase()}`;
}

function showSaveAccountPrompt(
  credential: PendingCredential,
  handlers: { onSave: () => Promise<void>; onIgnore: () => void },
): void {
  document.querySelector('[data-totp-vault-save-prompt="true"]')?.remove();

  const host = document.createElement('div');
  host.dataset.totpVaultSavePrompt = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        position: fixed;
        right: 16px;
        top: 16px;
        z-index: 2147483647;
        width: 320px;
        border: 1px solid #dbeafe;
        border-radius: 16px;
        padding: 14px;
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 18px 45px rgb(15 23 42 / 18%);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .title {
        margin: 0 0 8px;
        font-size: 15px;
        font-weight: 700;
      }
      .meta {
        margin: 0;
        color: #64748b;
        word-break: break-all;
      }
      .status {
        margin: 8px 0 0;
        color: #2563eb;
      }
      .actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        flex: 1;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 8px 10px;
        background: #ffffff;
        color: #0f172a;
        cursor: pointer;
        font: inherit;
      }
      button.primary {
        border-color: #2563eb;
        background: #2563eb;
        color: #ffffff;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.65;
      }
    </style>
    <div class="card">
      <p class="title">保存账号到 totp-vault？</p>
      <p class="meta"></p>
      <p class="status"></p>
      <div class="actions">
        <button class="save-button primary" type="button">保存</button>
        <button class="ignore-button" type="button">忽略</button>
      </div>
    </div>
  `;

  shadow.querySelector('.meta')!.textContent = `${new URL(credential.url).host} · ${credential.username}`;
  const saveButton = shadow.querySelector<HTMLButtonElement>('.save-button')!;
  const ignoreButton = shadow.querySelector<HTMLButtonElement>('.ignore-button')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  saveButton.addEventListener('click', () => {
    saveButton.disabled = true;
    ignoreButton.disabled = true;
    saveButton.textContent = '保存中...';
    status.textContent = '';
    handlers.onSave()
      .then(() => host.remove())
      .catch((error: unknown) => {
        saveButton.disabled = false;
        ignoreButton.disabled = false;
        saveButton.textContent = '保存';
        status.textContent = error instanceof Error ? error.message : '保存账号失败';
      });
  });
  ignoreButton.addEventListener('click', () => {
    handlers.onIgnore();
    host.remove();
  });

  document.body.append(host);
}

function showPageNotice(message: string): void {
  document.querySelector('[data-totp-vault-notice="true"]')?.remove();

  const host = document.createElement('div');
  host.dataset.totpVaultNotice = 'true';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .notice {
        position: fixed;
        right: 16px;
        top: 16px;
        z-index: 2147483647;
        max-width: 320px;
        border: 1px solid #bfdbfe;
        border-radius: 10px;
        padding: 12px 14px;
        background: #eff6ff;
        color: #1e3a8a;
        box-shadow: 0 10px 30px rgb(0 0 0 / 16%);
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
    </style>
    <div class="notice"></div>
  `;
  shadow.querySelector('.notice')!.textContent = message;
  document.body.append(host);
  window.setTimeout(() => host.remove(), 5000);
}
