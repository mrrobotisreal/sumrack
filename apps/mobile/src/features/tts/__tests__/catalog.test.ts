import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  getVoice,
  parseTtsVoiceSetting,
  PIPER_VOICES,
  SYSTEM_VOICE_ID,
} from '../catalog';

describe('PIPER_VOICES catalog', () => {
  it('ships all four design §6 voices with unique ids', () => {
    expect(PIPER_VOICES.map((v) => v.id).sort()).toEqual([
      'piper-ru-denis',
      'piper-ru-dmitri',
      'piper-ru-irina',
      'piper-ru-ruslan',
    ]);
  });

  it('pins a full sha256 for every archive', () => {
    for (const voice of PIPER_VOICES) {
      expect(voice.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(voice.archiveBytes).toBeGreaterThan(60_000_000);
    }
  });

  it('derives archive URLs and file names consistently', () => {
    for (const voice of PIPER_VOICES) {
      expect(voice.archiveUrl).toBe(
        `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${voice.dirName}.tar.bz2`,
      );
      expect(voice.dirName).toMatch(/^vits-piper-ru_RU-[a-z]+-medium$/);
      expect(voice.modelFile).toMatch(/^ru_RU-[a-z]+-medium\.onnx$/);
    }
  });

  it('getVoice finds by id and rejects unknowns', () => {
    expect(getVoice('piper-ru-irina')?.displayName).toBe('Ирина');
    expect(getVoice('piper-ru-nadia')).toBeUndefined();
    expect(getVoice(SYSTEM_VOICE_ID)).toBeUndefined();
  });
});

describe('parseTtsVoiceSetting', () => {
  it('accepts a stored piper selection', () => {
    expect(parseTtsVoiceSetting({ selectedVoiceId: 'piper-ru-ruslan' })).toEqual({
      selectedVoiceId: 'piper-ru-ruslan',
    });
  });

  it('accepts the system sentinel', () => {
    expect(parseTtsVoiceSetting({ selectedVoiceId: SYSTEM_VOICE_ID })).toEqual({
      selectedVoiceId: SYSTEM_VOICE_ID,
    });
  });

  it.each([
    ['unknown voice id', { selectedVoiceId: 'piper-ru-vanished' }],
    ['extra keys (strict)', { selectedVoiceId: 'piper-ru-ruslan', rate: 2 }],
    ['wrong shape', { voice: 'piper-ru-ruslan' }],
    ['null', null],
    ['undefined (never stored)', undefined],
    ['garbage', 'piper-ru-ruslan'],
  ])('falls back to system for %s', (_label, stored) => {
    expect(parseTtsVoiceSetting(stored)).toEqual({ selectedVoiceId: SYSTEM_VOICE_ID });
  });
});

describe('formatBytes', () => {
  it('formats voice-scale sizes with one decimal', () => {
    expect(formatBytes(67_210_684)).toBe('64.1 MB');
  });

  it('drops decimals at 100 MB+', () => {
    expect(formatBytes(150_000_000)).toBe('143 MB');
  });

  it('treats zero/negative as empty', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(-5)).toBe('0 MB');
  });
});
