/**
 * URL 工具
 */

/**
 * 提取 URL 的 origin(协议 + host + 端口)
 * 例: "https://github.com/alice/repo?q=1" -> "https://github.com"
 */
export function extractOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url;
  }
}

/** 提取 host(无协议无端口) */
export function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * 简单域名匹配:url.host 包含 pattern.host
 * 例: matchUrl("https://accounts.google.com", "https://google.com") -> true
 */
export function matchUrl(url: string, pattern: string): boolean {
  const urlHost = extractHost(url);
  const patternHost = extractHost(pattern);
  if (!urlHost || !patternHost) return false;
  return urlHost === patternHost || urlHost.endsWith(`.${patternHost}`);
}
