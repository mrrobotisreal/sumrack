import { describe, expect, it, vi } from 'vitest';

import { attemptFileName, attemptStem, parseAttemptFileName, withExt } from '../paths';
import {
  DEFAULT_RECORDINGS_SETTINGS,
  parseRecordingsSettings,
  RecordingsSettingsSchema,
} from '../recordings-settings';

vi.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
vi.mock('@/db', () => ({ repos: {} }));

describe('recording file names (§10.1)', () => {
  it('formats tNN-aM with the extension and parses back', () => {
    expect(attemptFileName(3, 2, 'ogg')).toBe('t03-a2.ogg');
    expect(attemptFileName(0, 1, 'wav')).toBe('t00-a1.wav');
    expect(attemptFileName(120, 11, 'ogg')).toBe('t120-a11.ogg');
    expect(attemptStem(7, 3)).toBe('t07-a3');
    expect(parseAttemptFileName('t03-a2.ogg')).toEqual({ turnOrder: 3, attemptNo: 2, ext: 'ogg' });
    expect(parseAttemptFileName('t120-a11.wav')).toEqual({
      turnOrder: 120,
      attemptNo: 11,
      ext: 'wav',
    });
    expect(parseAttemptFileName('pron-attempt.wav')).toBeNull();
    expect(parseAttemptFileName('t3-a2.ogg')).toBeNull();
    expect(withExt('t03-a2.wav', 'ogg')).toBe('t03-a2.ogg');
  });
});

describe('scenario.recordings sanitize (§4.4)', () => {
  it('defaults for garbage and heals field-by-field', () => {
    expect(parseRecordingsSettings(null)).toEqual(DEFAULT_RECORDINGS_SETTINGS);
    expect(parseRecordingsSettings('x')).toEqual(DEFAULT_RECORDINGS_SETTINGS);
    expect(
      parseRecordingsSettings({ v: 1, pruneDays: 7, capBytes: -1, lastPruneAt: 'no' }),
    ).toEqual({
      v: 1,
      pruneDays: 7,
      capBytes: 300_000_000,
      lastPruneAt: null,
    });
  });

  it('accepts the documented shape and rejects unknown keys strictly', () => {
    const ok = { v: 1, pruneDays: 30, capBytes: 300_000_000, lastPruneAt: 1_700_000_000_000 };
    expect(RecordingsSettingsSchema.safeParse(ok).success).toBe(true);
    expect(RecordingsSettingsSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(parseRecordingsSettings({ ...ok, extra: 1 })).toEqual(ok);
  });
});
