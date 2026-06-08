import type { TOTPAlgorithm, TOTPBinding, TOTPDigits, TOTPPeriod } from '@/shared/types';
import { isValidBase32, normalizeBase32 } from './base32';

export function parseOtpauthUri(uri: string): { binding: TOTPBinding; label: string } | null {
  try {
    if (!uri.startsWith('otpauth://totp/')) return null;
    const parsed = new URL(uri);
    const label = decodeURIComponent(parsed.pathname.slice(1));
    const secret = parsed.searchParams.get('secret');
    if (!secret) return null;

    const secretBase32 = normalizeBase32(secret);
    if (!isValidBase32(secretBase32)) return null;

    const algorithm = ((parsed.searchParams.get('algorithm') || 'SHA1').toUpperCase()) as TOTPAlgorithm;
    const digits = Number(parsed.searchParams.get('digits') || '6') as TOTPDigits;
    const period = Number(parsed.searchParams.get('period') || '30') as TOTPPeriod;
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) return null;
    if (![6, 8].includes(digits)) return null;
    if (![30, 60].includes(period)) return null;

    const issuer = parsed.searchParams.get('issuer') || label.split(':')[0];
    return {
      binding: {
        secretBase32,
        algorithm,
        digits,
        period,
        issuer: issuer || undefined,
      },
      label,
    };
  } catch {
    return null;
  }
}

export function buildOtpauthUri(binding: TOTPBinding, label: string): string {
  const params = new URLSearchParams({
    secret: binding.secretBase32,
    algorithm: binding.algorithm,
    digits: String(binding.digits),
    period: String(binding.period),
  });
  if (binding.issuer) params.set('issuer', binding.issuer);
  return `otpauth://totp/${encodeURIComponent(label)}?${params}`;
}
