import { describe, expect, it, vi } from 'vitest';
import type { Account } from '@/shared/types';
import { buildExport, parseImportAccounts } from '@/libs/import-export/jsonFormats';

vi.stubGlobal('crypto', {
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
});

const account: Account = {
  id: 'a1',
  url: 'https://example.com',
  username: 'alice',
  password: 'secret',
  notes: 'note',
  totp: {
    secretBase32: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    issuer: 'Example',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('jsonFormats', () => {
  it('parses totp-vault exports', () => {
    const parsed = parseImportAccounts({ version: 1, exportedAt: '2026-01-01T00:00:00.000Z', accounts: [account] });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.username).toBe('alice');
    expect(parsed[0]?.totp?.secretBase32).toBe('JBSWY3DPEHPK3PXP');
  });

  it('parses Bitwarden JSON exports with otpauth TOTP', () => {
    const parsed = parseImportAccounts({
      encrypted: false,
      items: [{
        type: 1,
        name: 'Example',
        notes: 'note',
        login: {
          uris: [{ uri: 'https://example.com' }],
          username: 'alice',
          password: 'secret',
          totp: 'otpauth://totp/Example%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30',
        },
      }],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.url).toBe('https://example.com');
    expect(parsed[0]?.totp?.issuer).toBe('Example');
  });

  it('parses 1Password JSON exports', () => {
    const parsed = parseImportAccounts({
      items: [{
        title: 'Example',
        urls: [{ href: 'https://example.com' }],
        fields: [
          { id: 'username', label: 'username', purpose: 'USERNAME', value: 'alice' },
          { id: 'password', label: 'password', purpose: 'PASSWORD', value: 'secret' },
          { id: 'otp', label: 'one-time password', type: 'OTP', value: 'otpauth://totp/Example%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Example' },
        ],
      }],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.password).toBe('secret');
    expect(parsed[0]?.totp?.secretBase32).toBe('JBSWY3DPEHPK3PXP');
  });

  it('exports Bitwarden compatible JSON', () => {
    const exported = buildExport([account], 'bitwarden', '2026-01-01T00:00:00.000Z');
    const data = exported.data as { items: Array<{ login: { totp: string } }> };

    expect(exported.fileName).toBe('totp-vault-bitwarden-2026-01-01.json');
    expect(data.items[0]?.login.totp).toContain('otpauth://totp/');
    expect(data.items[0]?.login.totp).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('exports 1Password compatible JSON', () => {
    const exported = buildExport([account], '1password', '2026-01-01T00:00:00.000Z');
    const data = exported.data as { items: Array<{ fields: Array<{ id: string; value: string }> }> };
    const otp = data.items[0]?.fields.find((field) => field.id === 'otp');

    expect(exported.fileName).toBe('totp-vault-1password-2026-01-01.json');
    expect(otp?.value).toContain('otpauth://totp/');
  });
});
