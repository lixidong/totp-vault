/**
 * 校验函数
 * 见 spec/01-types.md §6 + spec/04-totp.md §2
 */

import { ValidationError } from '@/shared/errors';
import type { Account, TOTPBinding } from '@/shared/types';
import {
  decode as base32Decode,
  encode as base32Encode,
  isValidBase32,
  normalizeBase32,
} from '@/libs/totp/base32';

export { base32Decode, base32Encode, isValidBase32, normalizeBase32 };

export function validateAccount(input: unknown): Account {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('Account must be an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.url !== 'string' || !obj.url) {
    throw new ValidationError('url is required', 'url');
  }
  if (typeof obj.username !== 'string') {
    throw new ValidationError('username is required', 'username');
  }
  if (typeof obj.password !== 'string') {
    throw new ValidationError('password is required', 'password');
  }
  if (obj.totp !== undefined) {
    validateTOTPBinding(obj.totp);
  }
  return input as Account;
}

export function validateTOTPBinding(input: unknown): TOTPBinding {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('TOTPBinding must be an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.secretBase32 !== 'string' || !isValidBase32(obj.secretBase32)) {
    throw new ValidationError('Invalid base32 secret', 'secretBase32');
  }
  if (!['SHA1', 'SHA256', 'SHA512'].includes(obj.algorithm as string)) {
    throw new ValidationError('Invalid algorithm', 'algorithm');
  }
  if (![6, 8].includes(obj.digits as number)) {
    throw new ValidationError('digits must be 6 or 8', 'digits');
  }
  if (![30, 60].includes(obj.period as number)) {
    throw new ValidationError('period must be 30 or 60', 'period');
  }
  return input as TOTPBinding;
}
