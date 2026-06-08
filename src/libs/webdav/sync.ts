/**
 * WebDAV 同步流程
 * 见 spec/03-webdav.md §3
 */

import type { WebDAVConfig } from '@/shared/types';
import { AppError } from '@/shared/errors';
import {
  createWebDAVClient,
  isNotFound,
  isPreconditionFailed,
  mapWebDAVError,
} from './client';
import { createEmptyKdbx, loadKdbx, saveKdbx } from '@/libs/auth/kdbx';
import { KdbxRepository, setRepository, clearRepository, getRepository } from '@/libs/kdbx/repository';
import { getItem, setItem } from '@/libs/storage/local';
import { WEBDAV_UPLOAD_DEBOUNCE_MS } from '@/shared/constants';

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'error';

let _syncStatus: SyncStatus = 'idle';
const _statusListeners = new Set<(s: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return _syncStatus;
}

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  _statusListeners.add(cb);
  return () => _statusListeners.delete(cb);
}

function setSyncStatus(s: SyncStatus): void {
  _syncStatus = s;
  for (const cb of _statusListeners) cb(s);
}

/** 解锁:下载 + 解密 + 持有到 Repository */
export async function unlockWithConfig(
  config: WebDAVConfig,
  masterPassword: string,
): Promise<KdbxRepository> {
  setSyncStatus('syncing');
  try {
    const client = createWebDAVClient(config);
    const meta = await getItem('syncMeta');

    let bytes: Uint8Array;
    try {
      const stat = await client.stat(config.remotePath);
      const remoteETag = (stat as any).etag ?? (stat as any).data?.etag ?? '';

      bytes = await downloadBytes(client, config.remotePath);
      if (meta?.lastETag !== remoteETag) {
        await setItem('syncMeta', {
          lastETag: remoteETag ?? '',
          lastSyncAt: meta?.lastSyncAt ?? '',
        });
      }
    } catch (e) {
      if (isNotFound(e)) {
        // 首次:创建空 KDBX 并上传
        const db = createEmptyKdbx(masterPassword);
        bytes = await saveKdbx(db);
        try {
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
          await ensureParentDirectory(client, config.remotePath);
          await client.putFileContents(config.remotePath, ab);
          await setItem('syncMeta', {
            lastETag: '',
            lastSyncAt: new Date().toISOString(),
          });
        } catch (uploadErr) {
          throw mapWebDAVError(uploadErr);
        }
      } else {
        throw mapWebDAVError(e);
      }
    }

    const db = await loadKdbx(bytes, masterPassword);
    const repo = new KdbxRepository(db);
    setRepository(repo);
    setSyncStatus('idle');
    return repo;
  } catch (e) {
    setSyncStatus('error');
    if (e instanceof AppError) throw e;
    throw e;
  }
}

async function downloadBytes(client: ReturnType<typeof createWebDAVClient>, path: string): Promise<Uint8Array> {
  const data = await client.getFileContents(path);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // 字符串路径(纯文本同步)不应到这里,但容错
  return new TextEncoder().encode(String(data));
}

async function ensureParentDirectory(
  client: ReturnType<typeof createWebDAVClient>,
  filePath: string,
): Promise<void> {
  const normalized = filePath.replace(/^\/+|\/+$/g, '');
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex <= 0) return;
  try {
    await client.createDirectory(normalized.slice(0, slashIndex), { recursive: true });
  } catch (e) {
    if (!isNotFound(e)) return;
    throw e;
  }
}

// ---- 防抖上传 ----

let _pendingBytes: Uint8Array | null = null;
let _uploadTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleUpload(config: WebDAVConfig, bytes: Uint8Array): void {
  _pendingBytes = bytes;
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(() => {
    if (_pendingBytes) {
      uploadNow(config, _pendingBytes).catch((e) => {
        // 静默记录到 console,具体错误通过 sync.status 通知
        // eslint-disable-next-line no-console
        console.warn('[webdav] upload failed', e);
      });
    }
    _pendingBytes = null;
    _uploadTimer = null;
  }, WEBDAV_UPLOAD_DEBOUNCE_MS);
}

/** 立即上传(忽略防抖) */
export async function uploadNow(config: WebDAVConfig, bytes: Uint8Array): Promise<void> {
  setSyncStatus('syncing');
  try {
    const client = createWebDAVClient(config);
    const meta = await getItem('syncMeta');
    const headers: Record<string, string> = {};
    if (meta?.lastETag) {
      headers['If-Match'] = meta.lastETag;
    }

    try {
      // putFileContents 接受 string | BufferLike (ArrayBuffer|Buffer)
      // 我们用 Uint8Array,需要把 .buffer 传过去
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await client.putFileContents(config.remotePath, arrayBuffer, { headers });
      // 实际上传后 ETag 在响应头里,但 webdav 库 5.x 的 putFileContents 返回 boolean
      // 我们用 stat 重新拿 ETag
      const stat = await client.stat(config.remotePath);
      const newETag = (stat as any).etag ?? (stat as any).data?.etag ?? '';
      await setItem('syncMeta', {
        lastETag: newETag,
        lastSyncAt: new Date().toISOString(),
      });
      setSyncStatus('idle');
    } catch (e) {
      if (isPreconditionFailed(e)) {
        setSyncStatus('conflict');
        throw new AppError('WEBDAV_CONFLICT', '远端有更新,需合并');
      }
      throw mapWebDAVError(e);
    }
  } catch (e) {
    setSyncStatus('error');
    throw e;
  }
}

/** Repository 变更后自动保存(供 handlers/background 调用) */
export async function saveAndUpload(config: WebDAVConfig): Promise<void> {
  const repo = getRepository();
  const bytes = await repo.save();
  scheduleUpload(config, bytes);
}

/** 锁定:清空 Repository */
export function lock(): void {
  clearRepository();
  setSyncStatus('idle');
}
