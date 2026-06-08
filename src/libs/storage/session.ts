/**
 * chrome.storage.session 封装
 * 见 spec/07-storage.md §3
 * SW 休眠即清空,用于短期数据
 */

export async function getSessionItem<T = unknown>(key: string): Promise<T | null> {
  const result = await chrome.storage.session.get(key);
  return (result[key] as T) ?? null;
}

export async function setSessionItem<T = unknown>(key: string, value: T): Promise<void> {
  await chrome.storage.session.set({ [key]: value });
}

export async function removeSessionItem(key: string): Promise<void> {
  await chrome.storage.session.remove(key);
}

/** 锁定时调用,清空所有 session 数据 */
export async function clearSession(): Promise<void> {
  await chrome.storage.session.clear();
}
