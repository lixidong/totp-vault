/**
 * AES-GCM 加解密
 * 见 spec/08-security.md §3.2~§3.3
 */

import type { EncryptedBlob } from '@/shared/types';
import { DEVICE_KDF_PARAMS } from '@/shared/constants';

/** Uint8Array → base64 字符串 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** base64 字符串 → Uint8Array */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 加密任意 JSON 可序列化的对象
 */
export async function encryptJSON<T>(value: T, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    algorithm: 'AES-GCM-256',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    kdf: {
      function: 'PBKDF2-SHA256',
      salt: bytesToBase64(DEVICE_KDF_PARAMS.salt),
      iterations: DEVICE_KDF_PARAMS.iterations,
    },
  };
}

/** 解密 JSON 对象 */
export async function decryptJSON<T>(blob: EncryptedBlob, key: CryptoKey): Promise<T> {
  if (blob.algorithm !== 'AES-GCM-256') {
    throw new Error(`Unsupported algorithm: ${blob.algorithm}`);
  }
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text) as T;
}
