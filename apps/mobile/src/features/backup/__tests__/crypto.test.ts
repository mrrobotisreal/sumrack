import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '@/lib/base64';

import {
  decryptBackupEnvelope,
  deriveBackupKey,
  encryptBackupPayload,
  GCM_IV_BYTES,
  parseEnvelopeText,
} from '../crypto';
import { BackupError } from '../errors';

// Low iteration count for test speed — the pipeline is identical at any count.
const ITERATIONS = 1000;
const SALT_B64 = bytesToBase64(new Uint8Array(16).fill(7));
const IV = new Uint8Array(GCM_IV_BYTES).fill(3);

const key = await deriveBackupKey('корре́ктная-passphrase', SALT_B64, ITERATIONS);

function seal(payloadJson: string) {
  return encryptBackupPayload(payloadJson, key, {
    saltB64: SALT_B64,
    iterations: ITERATIONS,
    iv: IV,
    createdAt: new Date('2026-08-23T10:00:00Z'),
    appVersion: '0.1.0',
  });
}

describe('backup crypto', () => {
  it('round-trips payload JSON through gzip + AES-GCM, preserving ё and NFC', async () => {
    const payload = JSON.stringify({ тест: 'тёмный лес', mixed: 'ещё раз — ok', n: 42 });
    const envelope = seal(payload);
    expect(envelope.format).toBe('sumrak-backup');
    expect(envelope.cipher.iterations).toBe(ITERATIONS);
    expect(decryptBackupEnvelope(envelope, key)).toBe(payload);
  });

  it('the envelope survives JSON serialization and schema re-parse', () => {
    const envelope = seal('{"a":1}');
    const reparsed = parseEnvelopeText(JSON.stringify(envelope));
    expect(decryptBackupEnvelope(reparsed, key)).toBe('{"a":1}');
  });

  it('derivation is NFC-tolerant (composed vs decomposed passphrase input)', async () => {
    const composed = 'пароль-ёж';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const k1 = await deriveBackupKey(composed, SALT_B64, ITERATIONS);
    const k2 = await deriveBackupKey(decomposed, SALT_B64, ITERATIONS);
    expect(bytesToBase64(k1)).toBe(bytesToBase64(k2));
  });

  it('a wrong passphrase fails with decrypt-failed and returns nothing', async () => {
    const envelope = seal('{"secret":"data"}');
    const wrongKey = await deriveBackupKey('wrong-passphrase', SALT_B64, ITERATIONS);
    const err = (() => {
      try {
        decryptBackupEnvelope(envelope, wrongKey);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).code).toBe('decrypt-failed');
  });

  it('a tampered ciphertext fails the GCM tag, not silently corrupts', () => {
    const envelope = seal('{"a":1}');
    const bytes = Buffer.from(envelope.payloadB64, 'base64');
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
    const tampered = { ...envelope, payloadB64: bytes.toString('base64') };
    expect(() => decryptBackupEnvelope(tampered, key)).toThrowError(
      expect.objectContaining({ code: 'decrypt-failed' }),
    );
  });

  it('non-backup files are refused as invalid-envelope before any crypto', () => {
    expect(() => parseEnvelopeText('not json at all')).toThrowError(
      expect.objectContaining({ code: 'invalid-envelope' }),
    );
    expect(() => parseEnvelopeText('{"format":"other"}')).toThrowError(
      expect.objectContaining({ code: 'invalid-envelope' }),
    );
  });
});
