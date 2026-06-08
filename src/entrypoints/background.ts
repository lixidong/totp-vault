import { AppError } from '@/shared/errors';
import type { Account, AppSettings, WebDAVConfig } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';
import type { Request, Response, AccountExport, ImportMode } from '@/libs/messaging/protocol';
import { initStorage, getItem, setItem } from '@/libs/storage/local';
import { hasRepository, getRepository } from '@/libs/kdbx/repository';
import { loadWebDAVConfig, saveWebDAVConfig, clearWebDAVConfig } from '@/libs/webdav/config';
import { unlockWithConfig, saveAndUpload, uploadNow, lock as lockSync } from '@/libs/webdav/sync';
import { generateTOTP, getRemainingSeconds } from '@/libs/totp/generate';
import { getUnixSecondsWithOffset } from '@/libs/totp/timeSync';
import { validateAccount } from '@/libs/auth/validation';
import { matchUrl } from '@/shared/url';

let currentConfig: WebDAVConfig | null = null;

const AUTO_LOCK_ALARM = 'totp-vault:auto-lock';

export default defineBackground(() => {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_LOCK_ALARM) return;
    lockVault();
  });

  chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse) => {
    handleMessage(message)
      .then((data) => sendResponse({ ok: true, data } satisfies Response))
      .catch((error) => {
        console.error('[totp-vault] message failed', message.type, error);
        sendResponse(toErrorResponse(error));
      });
    return true;
  });
});

async function handleMessage(message: Request): Promise<unknown> {
  await initStorage();

  switch (message.type) {
    case 'isUnlocked':
      touchActivity();
      return { unlocked: hasRepository() };

    case 'openUnlockPopup':
      touchActivity();
      return await openUnlockPopup();

    case 'unlock':
      return await unlock(message.password);

    case 'lock':
      lockVault();
      return undefined;

    case 'listAccounts':
      touchActivity();
      return getRepository().listAccounts();

    case 'exportAccounts':
      touchActivity();
      return exportAccounts();

    case 'importAccounts':
      touchActivity();
      return await importAccounts(message.accounts, message.mode);

    case 'getAccount':
      touchActivity();
      return getRepository().getAccount(message.id);

    case 'createAccount':
      touchActivity();
      return await createAccount(message.account);

    case 'updateAccount':
      touchActivity();
      return await updateAccount(message.id, message.patch);

    case 'deleteAccount':
      touchActivity();
      return await deleteAccount(message.id);

    case 'bindTOTP':
      touchActivity();
      return await bindTOTP(message.accountId, message.binding);

    case 'unbindTOTP':
      touchActivity();
      return await unbindTOTP(message.accountId);

    case 'getCurrentTOTP':
      touchActivity();
      return await getCurrentTOTP(message.accountId);

    case 'matchAccountsForUrl':
      touchActivity();
      return matchAccountsForUrl(message.url);

    case 'account.touchLastUsed':
      touchActivity();
      return await touchLastUsed(message.id);

    case 'getWebDAVConfig':
      return await getWebDAVConfigSummary(message.password);

    case 'setWebDAVConfig':
      await saveWebDAVConfig(message.config, message.masterPassword);
      currentConfig = message.config;
      return undefined;

    case 'resetWebDAVConfig':
      await clearWebDAVConfig();
      currentConfig = null;
      return undefined;

    case 'syncNow':
      return await syncNow();

    case 'getSettings':
      return { ...DEFAULT_SETTINGS, ...(await getItem('settings')) };

    case 'setSettings':
      return await setSettings(message.settings);
  }
}

async function openUnlockPopup(): Promise<undefined> {
  if (hasRepository()) return undefined;
  const url = chrome.runtime.getURL('/popup.html');
  await chrome.windows.create({ url, type: 'popup', width: 420, height: 620 });
  return undefined;
}

async function unlock(password: string): Promise<undefined> {
  const config = await loadWebDAVConfig(password);
  if (!config) {
    throw new AppError('INVALID_INPUT', '请先在设置页配置 WebDAV');
  }
  await unlockWithConfig(config, password);
  currentConfig = config;
  await scheduleAutoLock();
  return undefined;
}

async function createAccount(
  account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Account> {
  const created = getRepository().createAccount(account);
  await uploadRepository();
  return created;
}

async function updateAccount(id: string, patch: Partial<Account>): Promise<Account> {
  const updated = getRepository().updateAccount(id, patch);
  await uploadRepository();
  return updated;
}

async function deleteAccount(id: string): Promise<undefined> {
  getRepository().deleteAccount(id);
  await uploadRepository();
  return undefined;
}

async function bindTOTP(accountId: string, binding: Account['totp']): Promise<undefined> {
  if (!binding) throw new AppError('INVALID_INPUT', 'TOTP 配置不能为空');
  getRepository().bindTOTP(accountId, binding);
  await uploadRepository();
  return undefined;
}

async function unbindTOTP(accountId: string): Promise<undefined> {
  getRepository().unbindTOTP(accountId);
  await uploadRepository();
  return undefined;
}

async function getCurrentTOTP(accountId: string): Promise<{ code: string; remainingSeconds: number }> {
  const account = getRepository().getAccount(accountId);
  if (!account) throw new AppError('ACCOUNT_NOT_FOUND', `账号 ${accountId} 不存在`);
  if (!account.totp) throw new AppError('INVALID_INPUT', '账号未绑定 TOTP');
  const unix = await getUnixSecondsWithOffset();
  return {
    code: generateTOTP(account.totp, unix),
    remainingSeconds: getRemainingSeconds(account.totp, unix),
  };
}

function matchAccountsForUrl(url: string): Account[] {
  return getRepository()
    .listAccounts()
    .filter((account) => matchUrl(url, account.url))
    .sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
}

function exportAccounts(): AccountExport {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: getRepository().listAccounts(),
  };
}

async function importAccounts(
  accounts: Account[],
  mode: ImportMode,
): Promise<{ imported: number; total: number }> {
  if (!Array.isArray(accounts)) {
    throw new AppError('INVALID_INPUT', '导入文件格式无效');
  }

  const validAccounts = accounts.map((account) => normalizeImportedAccount(validateAccount(account)));
  const repository = getRepository();

  if (mode === 'replace') {
    for (const account of repository.listAccounts()) {
      repository.deleteAccount(account.id);
    }
    for (const account of validAccounts) {
      repository.importAccount(account);
    }
  } else {
    const existingByKey = new Map(
      repository.listAccounts().map((account) => [accountKey(account), account]),
    );
    for (const account of validAccounts) {
      const existing = existingByKey.get(accountKey(account));
      if (existing) {
        repository.updateAccount(existing.id, account);
      } else {
        repository.importAccount(account);
      }
    }
  }

  await uploadRepository();
  return { imported: validAccounts.length, total: repository.listAccounts().length };
}

function normalizeImportedAccount(account: Account): Account {
  const now = new Date().toISOString();
  return {
    ...account,
    id: account.id || crypto.randomUUID().replace(/-/g, ''),
    url: account.url.trim(),
    username: account.username.trim(),
    notes: account.notes?.trim() || undefined,
    createdAt: account.createdAt || now,
    updatedAt: account.updatedAt || now,
  };
}

function accountKey(account: Account): string {
  return `${account.url.trim().toLowerCase()}\n${account.username.trim().toLowerCase()}`;
}

async function touchLastUsed(id: string): Promise<undefined> {
  await updateAccount(id, { lastUsedAt: new Date().toISOString() });
  return undefined;
}

async function uploadRepository(): Promise<void> {
  if (!currentConfig) {
    throw new AppError('NOT_UNLOCKED', '数据库未解锁');
  }
  await saveAndUpload(currentConfig);
}

async function syncNow(): Promise<undefined> {
  if (!currentConfig) {
    throw new AppError('NOT_UNLOCKED', '数据库未解锁');
  }
  const bytes = await getRepository().save();
  await uploadNow(currentConfig, bytes);
  return undefined;
}

async function getWebDAVConfigSummary(password?: string): Promise<{
  configured: boolean;
  config: Omit<WebDAVConfig, 'appPassword'> | null;
  syncMeta: { lastETag: string; lastSyncAt: string } | null;
}> {
  const syncMeta = await getItem('syncMeta');
  if (currentConfig) {
    return { configured: true, config: withoutSecret(currentConfig), syncMeta };
  }
  if (!password) {
    const encrypted = await getItem('webdavConfig');
    return { configured: encrypted !== null, config: null, syncMeta };
  }
  const config = await loadWebDAVConfig(password);
  if (!config) return { configured: false, config: null, syncMeta };
  return { configured: true, config: withoutSecret(config), syncMeta };
}

function withoutSecret(config: WebDAVConfig): Omit<WebDAVConfig, 'appPassword'> {
  return {
    url: config.url,
    username: config.username,
    remotePath: config.remotePath,
  };
}

function lockVault(): void {
  lockSync();
  currentConfig = null;
  void chrome.alarms.clear(AUTO_LOCK_ALARM);
}

function touchActivity(): void {
  if (!hasRepository()) return;
  void scheduleAutoLock();
}

async function scheduleAutoLock(): Promise<void> {
  const settings = (await getItem('settings')) ?? DEFAULT_SETTINGS;
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
  if (settings.autoLockMinutes <= 0) return;
  await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: settings.autoLockMinutes });
}

async function setSettings(settings: Partial<AppSettings>): Promise<undefined> {
  const current = (await getItem('settings')) ?? DEFAULT_SETTINGS;
  const next = { ...current, ...settings };
  await setItem('settings', next);
  if ('autoLockMinutes' in settings) {
    await scheduleAutoLock();
  }
  return undefined;
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return { ok: false, error: error.code, message: error.message };
  }
  return { ok: false, error: 'UNKNOWN', message: '操作失败' };
}
