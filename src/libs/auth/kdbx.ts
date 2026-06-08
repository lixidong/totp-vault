/**
 * KDBX 加载/创建
 * 见 spec/02-kdbx.md §2~§3
 */

import * as kdbxweb from 'kdbxweb';
import { argon2dAsync, argon2idAsync } from '@noble/hashes/argon2.js';
import { KDBX_DEFAULT_DESCRIPTION } from '@/shared/constants';
import { AppError } from '@/shared/errors';

const { Kdbx, Credentials, KdbxError, ProtectedValue, CryptoEngine } = kdbxweb;

let argon2Ready = false;

function ensureArgon2(): void {
  if (argon2Ready) return;
  CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
    const derive = type === CryptoEngine.Argon2TypeArgon2id ? argon2idAsync : argon2dAsync;
    const bytes = await derive(new Uint8Array(password), new Uint8Array(salt), {
      m: memory,
      t: iterations,
      p: parallelism,
      version,
      dkLen: length,
    });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  });
  argon2Ready = true;
}

/** 包装密码为 ProtectedValue */
function makeCredentials(password: string): kdbxweb.KdbxCredentials {
  return new Credentials(ProtectedValue.fromString(password), null);
}

/**
 * 加载 KDBX 字节流(从 webdav 下载来的)
 * 派生耗时 2~5 秒
 */
export async function loadKdbx(bytes: Uint8Array, password: string): Promise<kdbxweb.Kdbx> {
  ensureArgon2();
  try {
    const credentials = makeCredentials(password);
    // kdbxweb 要求 ArrayBuffer 实例
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return await Kdbx.load(ab, credentials);
  } catch (e) {
    if (e instanceof KdbxError || (e as any).name === 'InvalidKeyError') {
      throw new AppError('INVALID_PASSWORD', '主密码错误');
    }
    throw new AppError('KDBX_CORRUPTED', 'KDBX 文件损坏或格式不支持', e);
  }
}

/**
 * 创建空 KDBX 数据库
 */
export function createEmptyKdbx(password: string): kdbxweb.Kdbx {
  ensureArgon2();
  const credentials = makeCredentials(password);
  return Kdbx.create(credentials, KDBX_DEFAULT_DESCRIPTION);
}

/** 序列化为字节流 */
export async function saveKdbx(db: kdbxweb.Kdbx): Promise<Uint8Array> {
  ensureArgon2();
  try {
    const arrayBuffer = await db.save();
    return new Uint8Array(arrayBuffer);
  } catch (e) {
    if (e instanceof KdbxError) {
      throw new AppError('KDBX_CORRUPTED', e.message, e);
    }
    throw e;
  }
}
