import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64 } from '../base64';

describe('base64', () => {
  it('matches Node Buffer on known vectors', () => {
    const vectors = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'тёмный лес'];
    for (const v of vectors) {
      const bytes = new TextEncoder().encode(v);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('round-trips arbitrary binary of every length mod 3', () => {
    for (const len of [0, 1, 2, 3, 31, 32, 33, 255, 256, 1000]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) % 256;
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('tolerates the 60-column wrapping GitHub applies to contents API base64', () => {
    const bytes = new TextEncoder().encode('x'.repeat(200));
    const wrapped = (bytesToBase64(bytes).match(/.{1,60}/g) ?? []).join('\n');
    expect(base64ToBytes(wrapped)).toEqual(bytes);
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('abc')).toThrow();
    expect(() => base64ToBytes('ab!=')).toThrow();
  });
});
