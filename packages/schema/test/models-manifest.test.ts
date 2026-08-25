import { describe, expect, it } from 'vitest';
import {
  ModelsManifestSchema,
  parseModelsManifest,
  safeParseModelsManifest,
  SchemaValidationError,
} from '../src/index';

const validEntry = {
  id: 'piper-ru-ruslan',
  kind: 'tts-voice' as const,
  file: 'models/tts/vits-piper-ru_RU-ruslan-medium.tar.bz2',
  bytes: 67_210_684,
  sha256: '0690b1cad01f86e8db9ba988af24898bdc1af774e23cb2e46b9c730269b6fd83',
  displayName: 'Руслан',
  meta: { upstreamUrl: 'https://example.com/archive.tar.bz2' },
};

const validManifest = {
  schemaVersion: 1,
  generatedAt: '2026-08-25T00:00:00.000Z',
  models: [
    validEntry,
    {
      id: 'zipformer-ru-int8',
      kind: 'asr' as const,
      file: 'models/asr/sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2',
      bytes: 60_239_942,
      sha256: 'd6a651569aacc9a177259fa54705dd76acae23f6a4d62ea6797bd220d4b57163',
      displayName: 'Russian speech recognition',
    },
  ],
};

describe('ModelsManifestSchema', () => {
  it('accepts a valid manifest (meta optional per entry)', () => {
    const parsed = parseModelsManifest(validManifest);
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0]!.meta?.upstreamUrl).toContain('https://');
    expect(parsed.models[1]!.meta).toBeUndefined();
  });

  it('rejects a wrong schemaVersion', () => {
    const result = safeParseModelsManifest({ ...validManifest, schemaVersion: 2 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.path === 'schemaVersion')).toBe(true);
    }
  });

  it('rejects duplicate model ids with a readable path', () => {
    const result = safeParseModelsManifest({
      ...validManifest,
      models: [validEntry, { ...validEntry, file: 'models/tts/other.tar.bz2' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain('duplicate model id "piper-ru-ruslan"');
      expect(result.issues[0]!.path).toBe('models[1].id');
    }
  });

  it('rejects files outside models/ and path escapes', () => {
    for (const file of ['tts/archive.tar.bz2', 'models/../secrets.txt', '/models/tts/a.tar.bz2']) {
      const result = safeParseModelsManifest({
        ...validManifest,
        models: [{ ...validEntry, file }],
      });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a malformed sha256 / kind / bytes with precise paths', () => {
    const result = safeParseModelsManifest({
      schemaVersion: 1,
      models: [{ ...validEntry, sha256: 'NOT-A-HASH', kind: 'vocoder', bytes: -1 }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContain('models[0].sha256');
      expect(paths).toContain('models[0].kind');
      expect(paths).toContain('models[0].bytes');
    }
  });

  it('parseModelsManifest throws SchemaValidationError with the readable summary', () => {
    expect(() => parseModelsManifest({ schemaVersion: 1 })).toThrowError(SchemaValidationError);
    try {
      parseModelsManifest({ schemaVersion: 1 });
    } catch (e) {
      expect((e as SchemaValidationError).message).toContain('ModelsManifest validation failed');
    }
  });

  it('rejects unknown keys (strictObject typo protection)', () => {
    const result = safeParseModelsManifest({ ...validManifest, extra: true });
    expect(result.success).toBe(false);
    const entryResult = ModelsManifestSchema.safeParse({
      schemaVersion: 1,
      models: [{ ...validEntry, sizeBytes: 1 }],
    });
    expect(entryResult.success).toBe(false);
  });
});
