import { describe, expect, it } from 'vitest';

import { ASR_MODEL, transcriptResultSchema } from '../asr-catalog';

/** T12: the model pin + the Zod boundary for native transcripts. */

describe('ASR_MODEL', () => {
  it('pins the upstream archive precisely (url embeds dirName, sha256 well-formed)', () => {
    expect(ASR_MODEL.archiveUrl).toContain(`${ASR_MODEL.dirName}.tar.bz2`);
    expect(ASR_MODEL.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ASR_MODEL.archiveBytes).toBeGreaterThan(0);
  });
});

describe('transcriptResultSchema', () => {
  it('accepts the native module contract', () => {
    const parsed = transcriptResultSchema.parse({
      text: 'я слышу стук',
      words: [
        { word: 'я', startMs: 0, endMs: 200 },
        { word: 'слышу', startMs: 200, endMs: 700 },
        { word: 'стук', startMs: 700, endMs: 1100 },
      ],
      decodeMs: 350,
      audioMs: 1800,
    });
    expect(parsed.words).toHaveLength(3);
  });

  it('rejects malformed word entries and unknown keys (strictObject)', () => {
    expect(() =>
      transcriptResultSchema.parse({
        text: 'x',
        words: [{ word: 'x', startMs: '0', endMs: 1 }],
        decodeMs: 1,
        audioMs: 1,
      }),
    ).toThrow();
    expect(() =>
      transcriptResultSchema.parse({
        text: 'x',
        words: [],
        decodeMs: 1,
        audioMs: 1,
        confidence: 0.5,
      }),
    ).toThrow();
  });
});
