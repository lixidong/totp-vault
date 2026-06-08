/**
 * KDBX Entry ↔ Account 双向转换
 * 见 spec/02-kdbx.md §4.4
 */

import * as kdbxweb from 'kdbxweb';
import type { Account, TOTPBinding } from '@/shared/types';
import { nowISO } from '@/shared/time';
import { buildOtpauthUri, parseOtpauthUri } from '@/libs/totp/otpauth';
import { isValidBase32, normalizeBase32 } from '@/libs/totp/base32';

const { KdbxEntry, KdbxGroup, ProtectedValue } = kdbxweb;

const KEEPASS_TOTP_FIELDS = {
  OTP: 'otp',
  OneTimePassword: 'One-Time Password',
  TOTPSeed: 'TOTP Seed',
  TOTPSettings: 'TOTP Settings',
} as const;

type Entry = InstanceType<typeof KdbxEntry>;
type Group = InstanceType<typeof KdbxGroup>;

/** KDBX customData 字段名(等效于 KeePass 的"自定义属性") */
const CUSTOM_FIELDS = {
  AccountID: 'AccountID',
  TOTP_Secret: 'TOTP_Secret',
  TOTP_Algorithm: 'TOTP_Algorithm',
  TOTP_Digits: 'TOTP_Digits',
  TOTP_Period: 'TOTP_Period',
  TOTP_Issuer: 'TOTP_Issuer',
} as const;

/** 读取 customData 字段值(若 customData 不存在则返回空串) */
function getCustom(entry: Entry, key: string): string {
  return entry.customData?.get(key)?.value ?? '';
}

/** 写入 customData 字段(若 value 为空则删除) */
function setCustom(entry: Entry, key: string, value: string | undefined): void {
  if (!entry.customData) {
    entry.customData = new Map();
  }
  if (value) {
    entry.customData.set(key, { value, lastModified: new Date() });
  } else {
    entry.customData.delete(key);
  }
}

/** 移除 customData 字段 */
function removeCustom(entry: Entry, key: string): void {
  entry.customData?.delete(key);
}

/** KDBX Entry → Account */
export function entryToAccount(entry: Entry): Account {
  const getText = (field: string): string => {
    const val = entry.fields.get(field);
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (val instanceof ProtectedValue) {
      return val.getText();
    }
    return String(val);
  };

  const id = getCustom(entry, CUSTOM_FIELDS.AccountID) || entry.uuid.toString().replace(/-/g, '');

  const account: Account = {
    id,
    url: getText('URL'),
    username: getText('UserName'),
    password: getText('Password'),
    notes: getText('Notes') || undefined,
    createdAt: entry.times.creationTime?.toISOString() || nowISO(),
    updatedAt: entry.times.lastModTime?.toISOString() || nowISO(),
    lastUsedAt: entry.times.lastAccessTime?.toISOString(),
  };

  const customTotp = readCustomTOTP(entry);
  const compatibleTotp = readCompatibleTOTP(entry, getText);
  if (customTotp || compatibleTotp) {
    account.totp = customTotp ?? compatibleTotp;
  }

  return account;
}

/** 把 Account 字段写入 KDBX Entry(不创建条目) */
export function applyAccountToEntry(entry: InstanceType<typeof KdbxEntry>, account: Account): void {
  entry.fields.set('UserName', account.username);
  entry.fields.set('Password', ProtectedValue.fromString(account.password));
  entry.fields.set('URL', account.url);
  entry.fields.set('Notes', account.notes || '');

  setCustom(entry, CUSTOM_FIELDS.AccountID, account.id);

  if (account.totp) {
    setCustom(entry, CUSTOM_FIELDS.TOTP_Secret, account.totp.secretBase32);
    setCustom(entry, CUSTOM_FIELDS.TOTP_Algorithm, account.totp.algorithm);
    setCustom(entry, CUSTOM_FIELDS.TOTP_Digits, String(account.totp.digits));
    setCustom(entry, CUSTOM_FIELDS.TOTP_Period, String(account.totp.period));
    if (account.totp.issuer) {
      setCustom(entry, CUSTOM_FIELDS.TOTP_Issuer, account.totp.issuer);
    }
    writeCompatibleTOTP(entry, account);
  } else {
    removeCustom(entry, CUSTOM_FIELDS.TOTP_Secret);
    removeCustom(entry, CUSTOM_FIELDS.TOTP_Algorithm);
    removeCustom(entry, CUSTOM_FIELDS.TOTP_Digits);
    removeCustom(entry, CUSTOM_FIELDS.TOTP_Period);
    removeCustom(entry, CUSTOM_FIELDS.TOTP_Issuer);
    removeCompatibleTOTP(entry);
  }

  entry.times.lastModTime = new Date();
  if (account.lastUsedAt) {
    entry.times.lastAccessTime = new Date(account.lastUsedAt);
  }
}

function readCustomTOTP(entry: Entry): TOTPBinding | undefined {
  const secret = getCustom(entry, CUSTOM_FIELDS.TOTP_Secret);
  if (!secret) return undefined;

  const totp: TOTPBinding = {
    secretBase32: secret,
    algorithm: (getCustom(entry, CUSTOM_FIELDS.TOTP_Algorithm) as TOTPBinding['algorithm']) || 'SHA1',
    digits: parseInt(getCustom(entry, CUSTOM_FIELDS.TOTP_Digits) || '6', 10) as 6 | 8,
    period: parseInt(getCustom(entry, CUSTOM_FIELDS.TOTP_Period) || '30', 10) as 30 | 60,
  };
  const issuer = getCustom(entry, CUSTOM_FIELDS.TOTP_Issuer);
  if (issuer) totp.issuer = issuer;
  return totp;
}

function readCompatibleTOTP(entry: Entry, getText: (field: string) => string): TOTPBinding | undefined {
  const otpUri = getText(KEEPASS_TOTP_FIELDS.OTP) || getText(KEEPASS_TOTP_FIELDS.OneTimePassword);
  if (otpUri) {
    const parsed = parseOtpauthUri(otpUri);
    if (parsed) return parsed.binding;
  }

  const seed = getText(KEEPASS_TOTP_FIELDS.TOTPSeed);
  if (!seed) return undefined;
  const secretBase32 = normalizeBase32(seed);
  if (!isValidBase32(secretBase32)) return undefined;

  const settings = parseKeePassTOTPSettings(getText(KEEPASS_TOTP_FIELDS.TOTPSettings));
  return {
    secretBase32,
    algorithm: settings.algorithm,
    digits: settings.digits,
    period: settings.period,
  };
}

function parseKeePassTOTPSettings(settings: string): Pick<TOTPBinding, 'algorithm' | 'digits' | 'period'> {
  const result: Pick<TOTPBinding, 'algorithm' | 'digits' | 'period'> = {
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  };
  for (const part of settings.split(';')) {
    const [rawKey, rawValue] = part.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();
    if (!key || !value) continue;
    if (key === 'algorithm' && ['SHA1', 'SHA256', 'SHA512'].includes(value.toUpperCase())) {
      result.algorithm = value.toUpperCase() as TOTPBinding['algorithm'];
    }
    if (key === 'digits' && ['6', '8'].includes(value)) {
      result.digits = Number(value) as 6 | 8;
    }
    if ((key === 'period' || key === 'step') && ['30', '60'].includes(value)) {
      result.period = Number(value) as 30 | 60;
    }
  }
  return result;
}

function writeCompatibleTOTP(entry: Entry, account: Account): void {
  if (!account.totp) return;
  const label = account.totp.issuer
    ? `${account.totp.issuer}:${account.username}`
    : account.username;
  const uri = buildOtpauthUri(account.totp, label);
  entry.fields.set(KEEPASS_TOTP_FIELDS.OTP, uri);
  entry.fields.set(KEEPASS_TOTP_FIELDS.OneTimePassword, uri);
  entry.fields.set(KEEPASS_TOTP_FIELDS.TOTPSeed, ProtectedValue.fromString(account.totp.secretBase32));
  entry.fields.set(
    KEEPASS_TOTP_FIELDS.TOTPSettings,
    `30;${account.totp.digits}`,
  );
}

function removeCompatibleTOTP(entry: Entry): void {
  entry.fields.delete(KEEPASS_TOTP_FIELDS.OTP);
  entry.fields.delete(KEEPASS_TOTP_FIELDS.OneTimePassword);
  entry.fields.delete(KEEPASS_TOTP_FIELDS.TOTPSeed);
  entry.fields.delete(KEEPASS_TOTP_FIELDS.TOTPSettings);
}

/** 找默认 group 的辅助 */
export function getDefaultGroup(db: kdbxweb.Kdbx): InstanceType<typeof KdbxGroup> {
  return db.getDefaultGroup();
}
