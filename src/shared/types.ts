/**
 * 跨模块共享类型
 * 见 spec/01-types.md §1~§2
 */

export type TOTPAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';
export type TOTPDigits = 6 | 8;
export type TOTPPeriod = 30 | 60;

export type TOTPBinding = {
  secretBase32: string;
  algorithm: TOTPAlgorithm;
  digits: TOTPDigits;
  period: TOTPPeriod;
  issuer?: string;
};

export type Account = {
  id: string;
  url: string;
  username: string;
  password: string;
  totp?: TOTPBinding;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type WebDAVConfig = {
  url: string;
  username: string;
  appPassword: string;
  remotePath: string;
};

export type EncryptedBlob = {
  algorithm: 'AES-GCM-256';
  iv: string;
  ciphertext: string;
  kdf: {
    function: 'PBKDF2-SHA256';
    salt: string;
    iterations: number;
  };
};

export type AppSettings = {
  autoLockMinutes: number;
  masterPasswordHint: string;
  autoFillTOTP: boolean;
  copyTOTPToClipboard: boolean;
  ignoreList: string[];
  theme: 'light' | 'auto';
};

export const DEFAULT_SETTINGS: AppSettings = {
  autoLockMinutes: 5,
  masterPasswordHint: '',
  autoFillTOTP: true,
  copyTOTPToClipboard: false,
  ignoreList: [],
  theme: 'auto',
};

/** chrome.storage.local 中的明文项 */
export type LocalStorageData = {
  settings: AppSettings;
  ignoreList: string[];
  deviceId: string;
  syncMeta: {
    lastETag: string;
    lastSyncAt: string;
  } | null;
  timeOffset: {
    offsetMs: number;
    expiresAt: number;
    calibratedAt: number;
  } | null;
  webdavConfig: EncryptedBlob | null;
};
