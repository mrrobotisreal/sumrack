import { describe, expect, it } from 'vitest';

import {
  ASSIST_CANDIDATES,
  ASSIST_MODEL,
  DEFAULT_ASSIST_MODEL_STATE,
  assistLanguageSchema,
  parseAssistModelState,
} from '../assist-catalog';

/** T59: the candidate ladder pins + the `scenario.assistModel` accessor. */

describe('ASSIST_CANDIDATES', () => {
  it('is the tiny → base → small ladder with precise upstream pins', () => {
    expect(ASSIST_CANDIDATES.map((c) => c.size)).toEqual(['tiny', 'base', 'small']);
    for (const c of ASSIST_CANDIDATES) {
      expect(c.id).toBe(`whisper-${c.size}-int8`);
      expect(c.archiveUrl).toContain(`${c.dirName}.tar.bz2`);
      expect(c.archiveUrl).toContain('/asr-models/');
      expect(c.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(c.archiveBytes).toBeGreaterThan(0);
      expect(c.files.encoder).toBe(`${c.size}-encoder.int8.onnx`);
      expect(c.files.decoder).toBe(`${c.size}-decoder.int8.onnx`);
      expect(c.files.tokens).toBe(`${c.size}-tokens.txt`);
    }
    expect(new Set(ASSIST_CANDIDATES.map((c) => c.archiveSha256)).size).toBe(3);
  });

  it('grows monotonically in archive size', () => {
    const bytes = ASSIST_CANDIDATES.map((c) => c.archiveBytes);
    expect(bytes[0]!).toBeLessThan(bytes[1]!);
    expect(bytes[1]!).toBeLessThan(bytes[2]!);
  });

  it('pins one of the candidates as ASSIST_MODEL', () => {
    expect(ASSIST_CANDIDATES).toContain(ASSIST_MODEL);
  });
});

describe('assistLanguageSchema', () => {
  it('accepts en/ru/auto only', () => {
    expect(assistLanguageSchema.parse('en')).toBe('en');
    expect(assistLanguageSchema.parse('auto')).toBe('auto');
    expect(() => assistLanguageSchema.parse('de')).toThrow();
  });
});

describe('parseAssistModelState (scenario.assistModel accessor)', () => {
  it('accepts the §4.4 shape', () => {
    expect(parseAssistModelState({ v: 1, installed: true, id: 'whisper-tiny-int8' })).toEqual({
      v: 1,
      installed: true,
      id: 'whisper-tiny-int8',
    });
  });

  it('heals anything malformed to "not installed" with the pinned id', () => {
    expect(parseAssistModelState(null)).toEqual(DEFAULT_ASSIST_MODEL_STATE);
    expect(parseAssistModelState({ v: 2, installed: true, id: 'x' })).toEqual(
      DEFAULT_ASSIST_MODEL_STATE,
    );
    expect(parseAssistModelState({ v: 1, installed: 'yes', id: 'x' })).toEqual(
      DEFAULT_ASSIST_MODEL_STATE,
    );
    expect(parseAssistModelState({ v: 1, installed: true, id: '', extra: 1 })).toEqual(
      DEFAULT_ASSIST_MODEL_STATE,
    );
    expect(DEFAULT_ASSIST_MODEL_STATE.installed).toBe(false);
    expect(DEFAULT_ASSIST_MODEL_STATE.id).toBe(ASSIST_MODEL.id);
  });
});
