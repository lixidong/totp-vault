import { TIME_OFFSET_CACHE_TTL_MS } from '@/shared/constants';
import { getItem, setItem } from '@/libs/storage/local';

export async function calibrateTime(): Promise<number> {
  return Math.floor(Date.now() / 1000);
}

export async function getUnixSecondsWithOffset(): Promise<number> {
  const cached = await getItem('timeOffset');
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return Math.floor((now + cached.offsetMs) / 1000);
  }

  const serverUnix = await calibrateTime();
  await setItem('timeOffset', {
    offsetMs: serverUnix * 1000 - now,
    expiresAt: now + TIME_OFFSET_CACHE_TTL_MS,
    calibratedAt: now,
  });
  return serverUnix;
}
