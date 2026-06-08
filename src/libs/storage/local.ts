/**
 * chrome.storage.local 封装
 * 见 spec/07-storage.md §2
 */

import type { AppSettings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';

/** chrome.storage.local 完整 schema */
export type StorageSchema = {
  settings: AppSettings;
  ignoreList: string[];
  deviceId: string;
  syncMeta: { lastETag: string; lastSyncAt: string } | null;
  timeOffset: { offsetMs: number; expiresAt: number; calibratedAt: number } | null;
  webdavConfig: unknown | null; // EncryptedBlob, 但本文件不引 type 避免循环
};

const DEFAULTS: Partial<StorageSchema> = {
  settings: DEFAULT_SETTINGS,
  ignoreList: [],
  syncMeta: null,
  timeOffset: null,
  webdavConfig: null,
};

let _initialized = false;

/** SW 启动时调用一次 */
export async function initStorage(): Promise<void> {
  if (_initialized) return;
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const toSet: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in existing)) {
      toSet[k] = v;
    }
  }
  if (!existing.deviceId) {
    toSet.deviceId = crypto.randomUUID();
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  _initialized = true;
}

export async function getItem<K extends keyof StorageSchema>(
  key: K,
): Promise<StorageSchema[K] | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as StorageSchema[K]) ?? null;
}

export async function setItem<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeItem(key: keyof StorageSchema): Promise<void> {
  await chrome.storage.local.remove(key);
}

export function onChange<K extends keyof StorageSchema>(
  key: K,
  callback: (newValue: StorageSchema[K] | null, oldValue: StorageSchema[K] | null) => void,
): () => void {
  const listener = (
    changes: { [k: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area !== 'local') return;
    if (!(key in changes)) return;
    const change = changes[key]!;
    callback(
      (change.newValue as StorageSchema[K]) ?? null,
      (change.oldValue as StorageSchema[K]) ?? null,
    );
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
