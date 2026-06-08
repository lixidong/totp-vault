/**
 * chrome.storage 配额监控
 * 见 spec/07-storage.md §2.4
 */

export async function getQuotaUsage(): Promise<{
  usedBytes: number;
  totalBytes: number;
  percent: number;
}> {
  const usedBytes = await chrome.storage.local.getBytesInUse();
  // chrome.storage.local 配额 = 10MB
  const totalBytes = chrome.storage.local.QUOTA_BYTES ?? 10_485_760;
  return {
    usedBytes,
    totalBytes,
    percent: (usedBytes / totalBytes) * 100,
  };
}
