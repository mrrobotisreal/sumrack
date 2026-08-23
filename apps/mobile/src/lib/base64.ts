/**
 * Base64 encode/decode for Uint8Array without Buffer (Hermes has neither
 * Buffer nor btoa/atob on binary strings we can trust with arbitrary bytes).
 * Used by the backup engine (T20): envelope payloads, GitHub contents API.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET[i]!] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2]!;
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    out += i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]! : '=';
    out += i + 2 < bytes.length ? ALPHABET[b2 & 0x3f]! : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  // Tolerate whitespace/newlines (GitHub's contents API wraps base64 at 60 chars).
  const clean = b64.replace(/[\s\r\n]+/g, '');
  if (clean.length % 4 !== 0) throw new Error('invalid base64 length');
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = REVERSE[clean[i]!];
    const c1 = REVERSE[clean[i + 1]!];
    const c2 = clean[i + 2] === '=' ? 0 : REVERSE[clean[i + 2]!];
    const c3 = clean[i + 3] === '=' ? 0 : REVERSE[clean[i + 3]!];
    if (c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined) {
      throw new Error('invalid base64 character');
    }
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < out.length) out[o++] = (triple >> 16) & 0xff;
    if (o < out.length) out[o++] = (triple >> 8) & 0xff;
    if (o < out.length) out[o++] = triple & 0xff;
  }
  return out;
}
