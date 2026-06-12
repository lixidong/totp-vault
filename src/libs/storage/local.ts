/**
 * chrome.storage.local 封装
 * 见 spec/07-storage.md §2
 *
 * 设计要点:
 * - local: 主存储,容量大(10MB),存放加密 blob(KDBX 缓存、webdavConfig 等)
 * - sync: 跨设备/跨重装同步少量非敏感字段(settings、ignoreList、deviceId)
 *         容量 100KB 总额 / 8KB 单项,所以 webdavConfig 这种加密 blob 不放
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

/** 可以双写到 storage.sync 的非敏感字段 */
const SYNC_FIELDS = ['settings', 'ignoreList', 'deviceId'] as const;
type SyncField = (typeof SYNC_FIELDS)[number];
type SyncPayload = Pick<StorageSchema, SyncField>;

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

  // 从 storage.sync 拉取迁移(以 local 为准,只有 local 缺值时用 sync 补)
  const syncExisting = await chrome.storage.sync.get(SYNC_FIELDS);
  for (const field of SYNC_FIELDS) {
    if (!(field in toSet) && syncExisting[field] !== undefined) {
      toSet[field] = syncExisting[field];
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
    // 把首次拉到的 sync 字段也写回 local(以维持后续 sync 是 local 的镜像)
    const syncBack: Record<string, unknown> = {};
    for (const field of SYNC_FIELDS) {
      if (field in toSet) syncBack[field] = toSet[field];
    }
    await safeSyncSet(syncBack);
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
  if (isSyncField(key)) {
    await safeSyncSet({ [key]: value as SyncPayload[SyncField] });
  }
}

export async function removeItem(key: keyof StorageSchema): Promise<void> {
  await chrome.storage.local.remove(key);
  if (isSyncField(key)) {
    await chrome.storage.sync.remove(key);
  }
}

function isSyncField(key: keyof StorageSchema): key is SyncField {
  return (SYNC_FIELDS as readonly string[]).includes(key as string);
}

/** sync 写入失败时降级(配额超限等),不让主流程挂 */
async function safeSyncSet(payload: Record<string, unknown>): Promise<void> {
  try {
    await chrome.storage.sync.set(payload);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[storage] sync set failed (will retry on next write):', e);
  }
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
