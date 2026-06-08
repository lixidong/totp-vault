import { describe, expect, it } from 'vitest';
import { buildOtpauthUri, parseOtpauthUri } from '@/libs/totp/otpauth';
import { isValidBase32, normalizeBase32 } from '@/libs/totp/base32';

describe('TOTP helpers', () => {
  it('normalizes and validates base32 secrets', () => {
    expect(normalizeBase32('jbsw y3dp ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP');
    expect(isValidBase32('JBSWY3DPEHPK3PXP')).toBe(true);
  });

  it('parses otpauth URI parameters', () => {
    const parsed = parseOtpauthUri('otpauth://totp/Example%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA256&digits=8&period=60');

    expect(parsed?.label).toBe('Example:alice');
    expect(parsed?.binding).toEqual({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      issuer: 'Example',
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    });
  });

  it('builds parseable otpauth URIs', () => {
    const uri = buildOtpauthUri({
      secretBase32: 'JBSWY3DPEHPK3PXP',
      issuer: 'Example',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    }, 'Example:alice');

    expect(parseOtpauthUri(uri)?.binding.secretBase32).toBe('JBSWY3DPEHPK3PXP');
  });
});
