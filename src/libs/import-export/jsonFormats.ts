import type { Account, TOTPBinding } from '@/shared/types';
import type { AccountExport } from '@/libs/messaging/protocol';
import { parseOtpauthUri, buildOtpauthUri } from '@/libs/totp/otpauth';
import { isValidBase32, normalizeBase32 } from '@/libs/totp/base32';

export type ExportFormat = 'totp-vault' | 'bitwarden' | '1password';

type BitwardenExport = {
  encrypted: false;
  items: BitwardenItem[];
};

type BitwardenItem = {
  type?: number;
  name?: string;
  notes?: string | null;
  login?: {
    uris?: Array<{ uri?: string | null }>;
    username?: string | null;
    password?: string | null;
    totp?: string | null;
  } | null;
};

type OnePasswordExport = {
  accounts?: Array<{
    vaults?: OnePasswordVault[];
  }>;
  vaults?: OnePasswordVault[];
  items?: OnePasswordItem[];
};

type OnePasswordVault = {
  items?: OnePasswordItem[];
};

type OnePasswordItem = {
  title?: string;
  urls?: Array<{ href?: string; url?: string }>;
  fields?: Array<{
    id?: string;
    label?: string;
    type?: string;
    purpose?: string;
    value?: unknown;
  }>;
};

export function parseImportAccounts(input: unknown): Account[] {
  if (Array.isArray(input)) return parseArrayImport(input);
  if (isAccountExport(input)) return input.accounts;
  const bitwarden = parseBitwardenExport(input);
  if (bitwarden.length > 0) return bitwarden;
  const onePassword = parseOnePasswordExport(input);
  if (onePassword.length > 0) return onePassword;
  throw new Error('导入文件必须是 totp-vault、Bitwarden 或 1Password JSON 备份');
}

function parseArrayImport(input: unknown[]): Account[] {
  const onePasswordItems = input.flatMap((item) => parseOnePasswordItem(item));
  if (onePasswordItems.length > 0) return onePasswordItems;
  return input as Account[];
}

function isAccountExport(input: unknown): input is AccountExport {
  if (!input || typeof input !== 'object') return false;
  const value = input as Partial<AccountExport>;
  return value.version === 1 && Array.isArray(value.accounts);
}

function parseBitwardenExport(input: unknown): Account[] {
  if (!input || typeof input !== 'object') return [];
  const exportData = input as Partial<BitwardenExport>;
  if (!Array.isArray(exportData.items)) return [];
  return exportData.items.flatMap((item) => {
    if (item.type !== undefined && item.type !== 1) return [];
    const login = item.login;
    if (!login) return [];
    const url = login.uris?.map((uri) => uri.uri?.trim()).find(Boolean) ?? '';
    const username = login.username?.trim() ?? '';
    const password = login.password ?? '';
    if (!url || !password) return [];
    return [buildAccount({
      url,
      username,
      password,
      notes: item.notes ?? undefined,
      totp: parseTOTP(login.totp ?? undefined, item.name || username),
    })];
  });
}

function parseOnePasswordExport(input: unknown): Account[] {
  if (!input || typeof input !== 'object') return [];
  const data = input as OnePasswordExport;
  const items = [
    ...(data.items ?? []),
    ...(data.vaults ?? []).flatMap((vault) => vault.items ?? []),
    ...(data.accounts ?? []).flatMap((account) => (account.vaults ?? []).flatMap((vault) => vault.items ?? [])),
  ];
  return items.flatMap((item) => parseOnePasswordItem(item));
}

function parseOnePasswordItem(input: unknown): Account[] {
  if (!input || typeof input !== 'object') return [];
  const item = input as OnePasswordItem;
  if (!Array.isArray(item.fields)) return [];

  const getField = (...names: string[]) => {
    const normalizedNames = names.map(normalizeKey);
    const field = item.fields?.find((candidate) => {
      const keys = [candidate.id, candidate.label, candidate.type, candidate.purpose].map((value) => normalizeKey(value ?? ''));
      return keys.some((key) => normalizedNames.includes(key));
    });
    return typeof field?.value === 'string' ? field.value : '';
  };

  const username = getField('username', 'email', '用户名', '账号');
  const password = getField('password', 'concealed');
  if (!password) return [];

  const url = item.urls?.map((value) => value.href || value.url).find(Boolean) || getField('url', 'website');
  if (!url) return [];

  const otp = getField('one-time password', 'otp', 'totp', 'oneTimePassword');
  return [buildAccount({
    url,
    username,
    password,
    notes: item.title,
    totp: parseTOTP(otp, item.title || username),
  })];
}

function buildAccount(input: {
  url: string;
  username: string;
  password: string;
  notes?: string;
  totp?: TOTPBinding;
}): Account {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().replace(/-/g, ''),
    url: input.url,
    username: input.username,
    password: input.password,
    notes: input.notes || undefined,
    totp: input.totp,
    createdAt: now,
    updatedAt: now,
  };
}

function parseTOTP(input: string | undefined, label: string): TOTPBinding | undefined {
  if (!input) return undefined;
  const value = input.trim();
  const uri = value.startsWith('otpauth://') ? value : `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(value)}`;
  const parsed = parseOtpauthUri(uri);
  if (parsed) return parsed.binding;

  const secretBase32 = normalizeBase32(value);
  if (!isValidBase32(secretBase32)) return undefined;
  return { secretBase32, algorithm: 'SHA1', digits: 6, period: 30 };
}

function normalizeKey(input: string): string {
  return input.toLowerCase().replace(/[\s_\-]/g, '');
}

export function buildExport(accounts: Account[], format: ExportFormat, exportedAt: string): { data: unknown; fileName: string } {
  const date = exportedAt.slice(0, 10);
  if (format === 'bitwarden') {
    return { data: buildBitwardenExport(accounts), fileName: `totp-vault-bitwarden-${date}.json` };
  }
  if (format === '1password') {
    return { data: buildOnePasswordExport(accounts), fileName: `totp-vault-1password-${date}.json` };
  }
  return {
    data: { version: 1, exportedAt, accounts } satisfies AccountExport,
    fileName: `totp-vault-backup-${date}.json`,
  };
}

function buildBitwardenExport(accounts: Account[]): BitwardenExport {
  return {
    encrypted: false,
    items: accounts.map((account) => ({
      type: 1,
      name: account.username || account.url,
      notes: account.notes ?? null,
      login: {
        uris: [{ uri: account.url }],
        username: account.username,
        password: account.password,
        totp: account.totp ? buildOtpauthUri(account.totp, account.username || account.url) : null,
      },
    })),
  };
}

function buildOnePasswordExport(accounts: Account[]): OnePasswordExport {
  return {
    items: accounts.map((account) => ({
      title: account.username || account.url,
      urls: [{ href: account.url }],
      fields: [
        { id: 'username', label: 'username', type: 'STRING', purpose: 'USERNAME', value: account.username },
        { id: 'password', label: 'password', type: 'CONCEALED', purpose: 'PASSWORD', value: account.password },
        ...(account.totp ? [{ id: 'otp', label: 'one-time password', type: 'OTP', value: buildOtpauthUri(account.totp, account.username || account.url) }] : []),
        ...(account.notes ? [{ id: 'notes', label: 'notes', type: 'STRING', value: account.notes }] : []),
      ],
    })),
  };
}
