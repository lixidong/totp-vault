import { Secret, TOTP } from 'otpauth';
import type { TOTPBinding } from '@/shared/types';
import { decode } from './base32';

export function generateTOTP(binding: TOTPBinding, unixSeconds: number): string {
  const totp = new TOTP({
    secret: new Secret(decode(binding.secretBase32)),
    algorithm: binding.algorithm,
    digits: binding.digits,
    period: binding.period,
  });
  return totp.generate({ timestamp: unixSeconds * 1000 });
}

export function getRemainingSeconds(binding: TOTPBinding, unixSeconds: number): number {
  const remaining = binding.period - (unixSeconds % binding.period);
  return remaining === 0 ? binding.period : remaining;
}
