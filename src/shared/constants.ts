/**
 * 全局常量
 * 见 spec/06-messaging.md §3 / spec/12-roadmap.md §1
 */

// session 票据 TTL:5 分钟
export const SESSION_TTL_MS = 5 * 60 * 1000;

// 自动锁定时间(分钟)默认值
export const DEFAULT_AUTO_LOCK_MINUTES = 5;

// 自动锁定时间合法范围
export const AUTO_LOCK_MINUTES_RANGE = {
  min: 0, // 0 = 永不
  max: 60,
} as const;

// WebDAV 上传防抖时间
export const WEBDAV_UPLOAD_DEBOUNCE_MS = 1500;

// 自动同步 alarm 周期
export const AUTO_SYNC_ALARM_MINUTES = 5;

// 时间偏移缓存 TTL
export const TIME_OFFSET_CACHE_TTL_MS = 15 * 60 * 1000;

// deviceKey 派生参数(PBKDF2-SHA256)
export const DEVICE_KDF_PARAMS = {
  salt: new TextEncoder().encode('totp-vault/deviceKey/v2'),
  iterations: 600_000,
  hash: 'SHA-256',
} as const;

// KDBX 默认内部描述
export const KDBX_DEFAULT_DESCRIPTION = 'totp-vault v2 database';

// WebDAV 默认远程路径
export const WEBDAV_DEFAULT_REMOTE_PATH = 'totp-vault/sync.kdbx';

// TOTP 默认参数
export const TOTP_DEFAULTS = {
  algorithm: 'SHA1' as const,
  digits: 6 as const,
  period: 30 as const,
};
