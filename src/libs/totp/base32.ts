const BASE32_RE = /^[A-Z2-7]+$/;

export function normalizeBase32(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/=+$/g, '').toUpperCase();
}

export function isValidBase32(input: string): boolean {
  const normalized = normalizeBase32(input);
  if (!normalized || !BASE32_RE.test(normalized)) return false;
  try {
    return decode(normalized).length >= 8;
  } catch {
    return false;
  }
}

export function decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = normalizeBase32(input);
  const bits: number[] = [];

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 char: ${ch}`);
    for (let i = 4; i >= 0; i--) {
      bits.push((idx >> i) & 1);
    }
  }

  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i * 8 + j]!;
    }
    bytes[i] = byte;
  }
  return bytes;
}

export function encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let result = '';

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }

  return result;
}
