import { describe, expect, it } from 'vitest';
import {
  SchemaValidationError,
  parsePack,
  safeParseBackupEnvelope,
  safeParseManifest,
  safeParsePack,
} from '../src';
import { makeValidPack } from './helpers';

describe('parse helpers', () => {
  it('safeParsePack returns typed data on success', () => {
    const result = safeParsePack(makeValidPack());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.id).toBe('test-pack-001');
    expect(result.data.stories[0]!.sentences[0]!.tokens[0]!.lemma).toBe('я');
  });

  it('formats issue paths as dotted/indexed trails', () => {
    const pack = makeValidPack() as any;
    delete pack.stories[0].sentences[0].tokens[0].text;
    const result = safeParsePack(pack);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((i) => i.path)).toContain('stories[0].sentences[0].tokens[0].text');
  });

  it('parsePack throws SchemaValidationError carrying the issues', () => {
    expect(() => parsePack({ nonsense: true })).toThrowError(SchemaValidationError);
    try {
      parsePack({ nonsense: true });
    } catch (e) {
      const err = e as SchemaValidationError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.message).toContain('Pack validation failed');
    }
  });

  it('reports "(root)" for non-object input', () => {
    const result = safeParsePack('not even an object');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]!.path).toBe('(root)');
  });
});

describe('manifest schema edge cases', () => {
  const entry = {
    id: 'pack-a',
    version: 1,
    type: 'stories',
    level: 'A1',
    title: { ru: 'Тест', en: 'Test' },
    bytes: 100,
    files: [{ path: 'pack.json', sha256: 'a'.repeat(64) }],
  };

  it('rejects a malformed sha256 with a precise path', () => {
    const bad = structuredClone(entry);
    bad.files[0]!.sha256 = 'not-a-hash';
    const result = safeParseManifest({ schemaVersion: 1, packs: [bad] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain('packs[0].files[0].sha256');
  });

  it('rejects duplicate pack ids and packs missing pack.json', () => {
    const noPackJson = structuredClone(entry);
    noPackJson.files = [{ path: 'audio/x.opus', sha256: 'b'.repeat(64) }];
    const result = safeParseManifest({ schemaVersion: 1, packs: [entry, entry, noPackJson] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.message.includes('duplicate pack id'))).toBe(true);
    expect(result.issues.some((i) => i.message.includes('"pack.json"'))).toBe(true);
  });
});

describe('backup envelope stub', () => {
  it('accepts a well-formed envelope and rejects a wrong format tag', () => {
    const envelope = {
      format: 'sumrak-backup',
      version: 1,
      createdAt: '2026-08-21T10:00:00Z',
      cipher: { alg: 'aes-256-gcm', saltB64: 'c2FsdA==', ivB64: 'aXY=' },
      payloadB64: 'ZGF0YQ==',
    };
    expect(safeParseBackupEnvelope(envelope).success).toBe(true);
    const wrong = { ...envelope, format: 'other-thing' };
    const result = safeParseBackupEnvelope(wrong);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]!.path).toBe('format');
  });
});
