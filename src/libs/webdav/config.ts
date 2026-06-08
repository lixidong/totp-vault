/**
 * WebDAV 凭据存取
 * 见 spec/03-webdav.md §6 + spec/07-storage.md §4
 */

import type { WebDAVConfig } from '@/shared/types';
import { getItem, setItem, removeItem } from '@/libs/storage/local';
import { deriveDeviceKey } from '@/libs/auth/credentials';
import { encryptJSON, decryptJSON } from '@/libs/auth/crypto';

const STORAGE_KEY = 'webdavConfig' as const;

/** 读 webdav 配置(需要主密码解密) */
export async function loadWebDAVConfig(masterPassword: string): Promise<WebDAVConfig | null> {
  const blob = await getItem(STORAGE_KEY);
  if (!blob) return null;
  const deviceKey = await deriveDeviceKey(masterPassword);
  return await decryptJSON<WebDAVConfig>(blob as any, deviceKey);
}

/** 写 webdav 配置(用主密码加密) */
export async function saveWebDAVConfig(
  config: WebDAVConfig,
  masterPassword: string,
): Promise<void> {
  const deviceKey = await deriveDeviceKey(masterPassword);
  const encrypted = await encryptJSON(config, deviceKey);
  await setItem(STORAGE_KEY, encrypted as any);
}

/** 清空 webdav 配置 */
export async function clearWebDAVConfig(): Promise<void> {
  await removeItem(STORAGE_KEY);
}
