/**
 * WebDAV 客户端封装
 * 见 spec/03-webdav.md §2
 */

import { createClient, type WebDAVClient, type WebDAVClientError } from 'webdav';
import type { WebDAVConfig } from '@/shared/types';
import { AppError } from '@/shared/errors';

export function createWebDAVClient(config: WebDAVConfig): WebDAVClient {
  return createClient(config.url, {
    username: config.username,
    password: config.appPassword,
  });
}

function getWebDAVStatus(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null;
  const directStatus = (e as { status?: unknown }).status;
  if (typeof directStatus === 'number') return directStatus;
  const responseStatus = (e as { response?: { status?: unknown } }).response?.status;
  return typeof responseStatus === 'number' ? responseStatus : null;
}

function getWebDAVStatusText(e: unknown): string {
  if (typeof e !== 'object' || e === null) return '';
  const responseStatusText = (e as { response?: { statusText?: unknown } }).response?.statusText;
  if (typeof responseStatusText === 'string') return responseStatusText;
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

/** 鸭子类型:识别 webdav 错误 */
function isWebDAVError(e: unknown): e is WebDAVClientError {
  return getWebDAVStatus(e) !== null;
}

/** 判断错误是不是"文件不存在" */
export function isNotFound(e: unknown): boolean {
  return getWebDAVStatus(e) === 404;
}

/** 判断错误是不是"乐观锁冲突" */
export function isPreconditionFailed(e: unknown): boolean {
  return getWebDAVStatus(e) === 412;
}

/** 判断错误是不是"认证失败" */
export function isAuthFailed(e: unknown): boolean {
  const status = getWebDAVStatus(e);
  return status === 401 || status === 403;
}

/** 把 webdav 错误转成 AppError */
export function mapWebDAVError(e: unknown): AppError {
  if (isNotFound(e)) {
    return new AppError('WEBDAV_NETWORK_ERROR', '远程文件不存在', e);
  }
  if (isPreconditionFailed(e)) {
    return new AppError('WEBDAV_CONFLICT', '远端有更新,请刷新', e);
  }
  if (isAuthFailed(e)) {
    return new AppError('WEBDAV_AUTH_FAILED', 'WebDAV 账号或应用密码错误', e);
  }
  if (isWebDAVError(e)) {
    const status = getWebDAVStatus(e)!;
    const statusText = getWebDAVStatusText(e);
    if (status === 507) {
      return new AppError('WEBDAV_QUOTA_EXCEEDED', '云盘空间不足', e);
    }
    if (status >= 500) {
      return new AppError('WEBDAV_NETWORK_ERROR', `WebDAV 服务异常 (${status}${statusText ? ` ${statusText}` : ''})`, e);
    }
    return new AppError('WEBDAV_NETWORK_ERROR', `WebDAV 请求失败 (${status}${statusText ? ` ${statusText}` : ''})`, e);
  }
  const detail = getWebDAVStatusText(e);
  return new AppError(
    'WEBDAV_NETWORK_ERROR',
    detail ? `WebDAV 操作失败：${detail}` : 'WebDAV 操作失败，请检查服务 URL、远程路径和浏览器控制台错误',
    e,
  );
}
