import { describe, expect, it } from 'vitest';

import { REGISTER_LABELS } from '@/features/library/categories';

import { trackLabel } from '../track-label';

describe('trackLabel (T10 label + M14 §2.5 register mapping, T46)', () => {
  it('maps every register slug in AudioTrack.style to its Russian label', () => {
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'narrator' })).toBe(
      'Mr. Wintrow · Рассказчик',
    );
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'anchor' })).toBe(
      'Mr. Wintrow · Диктор',
    );
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'lecturer' })).toBe(
      'Mr. Wintrow · Лектор',
    );
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'host' })).toBe(
      'Mr. Wintrow · Ведущий',
    );
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'voiceover' })).toBe(
      'Mr. Wintrow · Закадровый голос',
    );
    expect(trackLabel({ voice: 'elevenlabs:Mr. Wintrow', style: 'guide' })).toBe(
      'Mr. Wintrow · Гид',
    );
    // The table and the mapping never drift apart.
    for (const [slug, ru] of Object.entries(REGISTER_LABELS)) {
      expect(trackLabel({ voice: 'x:V', style: slug })).toBe(`V · ${ru}`);
    }
  });

  it('keeps the pre-M14 output byte-for-byte for every non-register style (snapshot)', () => {
    const legacy = ['dread', 'nightmare', 'creepy-whisper', 'testimony', 'calm-narrator'].map(
      (style) => trackLabel({ voice: 'elevenlabs:Elen Kuragina', style }),
    );
    expect(legacy).toMatchInlineSnapshot(`
      [
        "Elen Kuragina · dread",
        "Elen Kuragina · nightmare",
        "Elen Kuragina · creepy whisper",
        "Elen Kuragina · testimony",
        "Elen Kuragina · calm narrator",
      ]
    `);
  });

  it('strips only the provider prefix from the voice, on both branches', () => {
    expect(trackLabel({ voice: 'piper:ru_RU-irina', style: 'dread' })).toBe('ru_RU-irina · dread');
    expect(trackLabel({ voice: 'piper:ru_RU-irina', style: 'anchor' })).toBe(
      'ru_RU-irina · Диктор',
    );
    // No prefix at all → the voice string as-is.
    expect(trackLabel({ voice: 'Mr. Wintrow', style: 'narrator' })).toBe(
      'Mr. Wintrow · Рассказчик',
    );
  });

  it('is an exact-key match — prototype names and dashed lookalikes fall through', () => {
    expect(trackLabel({ voice: 'x:V', style: 'constructor' })).toBe('V · constructor');
    expect(trackLabel({ voice: 'x:V', style: 'narrator-v2' })).toBe('V · narrator v2');
    expect(trackLabel({ voice: 'x:V', style: 'Narrator' })).toBe('V · Narrator');
  });
});
