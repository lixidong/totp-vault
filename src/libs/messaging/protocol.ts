import type { Account, AppSettings, TOTPBinding, WebDAVConfig } from '@/shared/types';
import type { ErrorCode } from '@/shared/errors';

export type AccountExport = {
  version: 1;
  exportedAt: string;
  accounts: Account[];
};

export type ImportMode = 'merge' | 'replace';

export type Request =
  | { type: 'unlock'; password: string }
  | { type: 'lock' }
  | { type: 'isUnlocked' }
  | { type: 'openUnlockPopup' }
  | { type: 'listAccounts' }
  | { type: 'exportAccounts' }
  | { type: 'importAccounts'; accounts: Account[]; mode: ImportMode }
  | { type: 'getAccount'; id: string }
  | { type: 'createAccount'; account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'> }
  | { type: 'updateAccount'; id: string; patch: Partial<Account> }
  | { type: 'deleteAccount'; id: string }
  | { type: 'bindTOTP'; accountId: string; binding: TOTPBinding }
  | { type: 'unbindTOTP'; accountId: string }
  | { type: 'getCurrentTOTP'; accountId: string }
  | { type: 'matchAccountsForUrl'; url: string }
  | { type: 'account.touchLastUsed'; id: string }
  | { type: 'getWebDAVConfig'; password?: string }
  | { type: 'setWebDAVConfig'; config: WebDAVConfig; masterPassword: string }
  | { type: 'resetWebDAVConfig' }
  | { type: 'syncNow' }
  | { type: 'getSettings' }
  | { type: 'setSettings'; settings: Partial<AppSettings> };

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };

export type RequestOf<T extends Request['type']> = Extract<Request, { type: T }>;

export type ResponseData<T extends Request['type']> =
  T extends 'isUnlocked' ? { unlocked: boolean }
    : T extends 'listAccounts' ? Account[]
      : T extends 'exportAccounts' ? AccountExport
        : T extends 'importAccounts' ? { imported: number; total: number }
          : T extends 'getAccount' ? Account | null
            : T extends 'createAccount' ? Account
          : T extends 'updateAccount' ? Account
            : T extends 'getCurrentTOTP' ? { code: string; remainingSeconds: number }
              : T extends 'matchAccountsForUrl' ? Account[]
                : T extends 'getWebDAVConfig' ? { configured: boolean; config: Omit<WebDAVConfig, 'appPassword'> | null; syncMeta: { lastETag: string; lastSyncAt: string } | null }
                  : T extends 'getSettings' ? AppSettings
                    : undefined;
