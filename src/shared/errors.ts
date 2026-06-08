/**
 * 错误类型定义
 * 见 spec/01-types.md §3.2
 */

export type ErrorCode =
  | 'NOT_UNLOCKED'
  | 'INVALID_PASSWORD'
  | 'KDBX_CORRUPTED'
  | 'WEBDAV_NETWORK_ERROR'
  | 'WEBDAV_AUTH_FAILED'
  | 'WEBDAV_CONFLICT'
  | 'WEBDAV_QUOTA_EXCEEDED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'INVALID_INPUT'
  | 'BASE32_INVALID'
  | 'ACCOUNT_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

/** 校验失败 */
export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super('INVALID_INPUT', field ? `${field}: ${message}` : message);
    this.name = 'ValidationError';
  }
}
