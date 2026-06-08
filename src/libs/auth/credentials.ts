/**
 * deviceKey 派生
 * 见 spec/08-security.md §3
 * 浏览器 Web Crypto API 不支持 Argon2id,本项目 deviceKey 用 PBKDF2-SHA256
 */

import { DEVICE_KDF_PARAMS } from '@/shared/constants';

/**
 * 从主密码派生 deviceKey(用于加密 webdav 凭据等)
 * 派生耗时约 100-300ms(浏览器实测)
 */
export async function deriveDeviceKey(masterPassword: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: DEVICE_KDF_PARAMS.salt,
      iterations: DEVICE_KDF_PARAMS.iterations,
      hash: DEVICE_KDF_PARAMS.hash,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // 不可导出
    ['encrypt', 'decrypt'],
  );
}
