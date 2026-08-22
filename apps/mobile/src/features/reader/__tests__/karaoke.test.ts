import { describe, expect, it } from 'vitest';

import {
  activeSentenceAt,
  activeWordAt,
  buildKaraokeIndex,
  mapPositionAcrossTracks,
  seekTargetForSentence,
  tokenKey,
  type KaraokeSentenceInput,
  type KaraokeStampInput,
} from '../karaoke';

const sentences: KaraokeSentenceInput[] = [
  { id: 's1', ru: 'Я слышу стук.' },
  { id: 's2', ru: 'Кто-то стучит в стене каждую ночь.' },
  { id: 's3', ru: 'Тук. Тук. Тук.' },
];

// Realistic shape: lead-in silence, tight words, inter-sentence pauses.
const stamps: KaraokeStampInput[] = [
  { sentenceId: 's1', tokenIndex: 0, startMs: 500, endMs: 800 },
  { sentenceId: 's1', tokenIndex: 1, startMs: 850, endMs: 1400 },
  { sentenceId: 's1', tokenIndex: 2, startMs: 1450, endMs: 2000 },
  { sentenceId: 's2', tokenIndex: 0, startMs: 3000, endMs: 3600 },
  { sentenceId: 's2', tokenIndex: 1, startMs: 3650, endMs: 4200 },
  { sentenceId: 's3', tokenIndex: 0, startMs: 6000, endMs: 6500 },
];

const DURATION = 8000;

describe('buildKaraokeIndex', () => {
  it('picks word mode when stamps exist, sentence mode when none', () => {
    expect(buildKaraokeIndex(sentences, stamps, DURATION).mode).toBe('word');
    expect(buildKaraokeIndex(sentences, [], DURATION).mode).toBe('sentence');
  });

  it('sorts stamps by start time regardless of input order', () => {
    const shuffled = [...stamps].reverse();
    const index = buildKaraokeIndex(sentences, shuffled, DURATION);
    const starts = index.stamps.map((s) => s.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('derives sentence spans from first/last stamp per sentence', () => {
    const index = buildKaraokeIndex(sentences, stamps, DURATION);
    expect(index.spans).toEqual([
      { sentenceId: 's1', sentenceIdx: 0, startMs: 500, endMs: 2000 },
      { sentenceId: 's2', sentenceIdx: 1, startMs: 3000, endMs: 4200 },
      { sentenceId: 's3', sentenceIdx: 2, startMs: 6000, endMs: 6500 },
    ]);
  });

  it('drops stamps referencing sentences not in the story (defensive)', () => {
    const index = buildKaraokeIndex(
      sentences,
      [...stamps, { sentenceId: 'ghost', tokenIndex: 0, startMs: 100, endMs: 200 }],
      DURATION,
    );
    // The ghost stamp still exists in the stamp list (harmless for word
    // highlight — no row renders it) but must not produce a span.
    expect(index.spans.every((s) => s.sentenceIdx >= 0)).toBe(true);
  });

  it('exposes a token → stamp map for word-segment playback', () => {
    const index = buildKaraokeIndex(sentences, stamps, DURATION);
    expect(index.stampByToken.get(tokenKey('s2', 1))).toMatchObject({
      startMs: 3650,
      endMs: 4200,
    });
    expect(index.stampByToken.has(tokenKey('s2', 99))).toBe(false);
  });
});

describe('activeWordAt (word mode)', () => {
  const index = buildKaraokeIndex(sentences, stamps, DURATION);

  it('is null during the lead-in before the first word', () => {
    expect(activeWordAt(index, 0)).toBeNull();
    expect(activeWordAt(index, 499)).toBeNull();
  });

  it('returns the word whose stamp covers t', () => {
    expect(activeWordAt(index, 500)).toEqual({ sentenceId: 's1', tokenIndex: 0 });
    expect(activeWordAt(index, 1000)).toEqual({ sentenceId: 's1', tokenIndex: 1 });
  });

  it('holds the highlight through a short gap until the next word starts', () => {
    // Gap 800–850 between words 0 and 1: word 0 stays lit (anti-flicker).
    expect(activeWordAt(index, 820)).toEqual({ sentenceId: 's1', tokenIndex: 0 });
  });

  it('releases the highlight in a long inter-sentence pause', () => {
    // s1 ends at 2000; s2 starts at 3000. Hold is capped at 600ms.
    expect(activeWordAt(index, 2500)).toEqual({ sentenceId: 's1', tokenIndex: 2 });
    expect(activeWordAt(index, 2601)).toBeNull();
  });

  it('gives the final word a short grace then goes dark', () => {
    expect(activeWordAt(index, 6700)).toEqual({ sentenceId: 's3', tokenIndex: 0 });
    expect(activeWordAt(index, 6801)).toBeNull();
  });

  it('is always null in sentence mode', () => {
    const fallback = buildKaraokeIndex(sentences, [], DURATION);
    expect(activeWordAt(fallback, 1000)).toBeNull();
  });

  it('tolerates overlapping stamps (clamped, next word wins at its start)', () => {
    const overlapping: KaraokeStampInput[] = [
      { sentenceId: 's1', tokenIndex: 0, startMs: 100, endMs: 700 },
      { sentenceId: 's1', tokenIndex: 1, startMs: 650, endMs: 1200 },
    ];
    const idx = buildKaraokeIndex(sentences, overlapping, DURATION);
    expect(activeWordAt(idx, 600)).toEqual({ sentenceId: 's1', tokenIndex: 0 });
    expect(activeWordAt(idx, 650)).toEqual({ sentenceId: 's1', tokenIndex: 1 });
  });
});

describe('activeSentenceAt', () => {
  const index = buildKaraokeIndex(sentences, stamps, DURATION);

  it('is null during the lead-in', () => {
    expect(activeSentenceAt(index, 0)).toBeNull();
  });

  it('holds the sentence through inter-sentence pauses (steady auto-scroll)', () => {
    expect(activeSentenceAt(index, 1000)?.sentenceId).toBe('s1');
    expect(activeSentenceAt(index, 2500)?.sentenceId).toBe('s1'); // pause after s1
    expect(activeSentenceAt(index, 3000)?.sentenceId).toBe('s2');
  });

  it('goes dark after the last sentence finishes', () => {
    expect(activeSentenceAt(index, 6400)?.sentenceId).toBe('s3');
    expect(activeSentenceAt(index, 7500)).toBeNull();
  });
});

describe('sentence mode (stampless fallback, design §11)', () => {
  const index = buildKaraokeIndex(sentences, [], DURATION);

  it('spans are contiguous, ordered, and cover [0, duration] exactly', () => {
    expect(index.spans).toHaveLength(3);
    expect(index.spans[0]!.startMs).toBe(0);
    expect(index.spans.at(-1)!.endMs).toBe(DURATION);
    for (let i = 1; i < index.spans.length; i++) {
      expect(index.spans[i]!.startMs).toBe(index.spans[i - 1]!.endMs);
    }
  });

  it('longer sentences get proportionally longer windows', () => {
    const len = (s: { startMs: number; endMs: number }) => s.endMs - s.startMs;
    // s2 is the longest sentence by characters.
    expect(len(index.spans[1]!)).toBeGreaterThan(len(index.spans[0]!));
    expect(len(index.spans[1]!)).toBeGreaterThan(len(index.spans[2]!));
  });

  it('every time point inside the track has an active sentence', () => {
    for (let t = 0; t < DURATION; t += 250) {
      expect(activeSentenceAt(index, t)).not.toBeNull();
    }
  });

  it('handles empty stories and zero duration without spans', () => {
    expect(buildKaraokeIndex([], [], DURATION).spans).toEqual([]);
    expect(buildKaraokeIndex(sentences, [], 0).spans).toEqual([]);
  });
});

describe('seekTargetForSentence', () => {
  it('word mode: first stamp of the sentence', () => {
    const index = buildKaraokeIndex(sentences, stamps, DURATION);
    expect(seekTargetForSentence(index, 's2')).toBe(3000);
    expect(seekTargetForSentence(index, 'nope')).toBeNull();
  });

  it('sentence mode: the proportional span start', () => {
    const index = buildKaraokeIndex(sentences, [], DURATION);
    expect(seekTargetForSentence(index, 's1')).toBe(0);
    const s2 = seekTargetForSentence(index, 's2');
    expect(s2).toBeGreaterThan(0);
    expect(s2).toBeLessThan(DURATION);
  });
});

describe('mapPositionAcrossTracks', () => {
  const slow = buildKaraokeIndex(sentences, stamps, DURATION);
  const fastStamps = stamps.map((s) => ({
    ...s,
    startMs: Math.round(s.startMs * 0.6),
    endMs: Math.round(s.endMs * 0.6),
  }));
  const fast = buildKaraokeIndex(sentences, fastStamps, 5000);

  it('restarts the active sentence on the new track', () => {
    // 3500ms on `slow` is inside s2 (starts 3000); s2 on `fast` starts 1800.
    expect(mapPositionAcrossTracks(slow, fast, 3500)).toBe(1800);
  });

  it('falls back to proportional time when the sentence is unknown', () => {
    const stampless = buildKaraokeIndex([], [], 4000); // no spans at all
    expect(mapPositionAcrossTracks(slow, stampless, 4000)).toBe(2000);
  });

  it('maps lead-in silence proportionally (no active sentence yet)', () => {
    expect(mapPositionAcrossTracks(slow, fast, 200)).toBe(Math.round((200 / 8000) * 5000));
  });

  it('clamps beyond-duration positions to the end of the target', () => {
    expect(mapPositionAcrossTracks(slow, buildKaraokeIndex([], [], 4000), 99999)).toBe(4000);
  });
});
