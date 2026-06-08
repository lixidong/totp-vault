/**
 * 时间格式化工具
 */

/** ISO 8601 UTC 时间字符串 */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Unix 秒(本地时钟,未校准) */
export function unixSecondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** 格式化为 YYYY-MM-DD HH:mm:ss */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 相对时间(如 "5 分钟前") */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
