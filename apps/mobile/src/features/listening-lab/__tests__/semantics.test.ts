import { describe, expect, it } from 'vitest';
import { catalog, SegmentSchema } from '../catalog';
import { compareDictation, words } from '../compare';
import { assessDictation, assessMeaning, EMPTY_ASSISTANCE, firstListen } from '../attempt';
import { resolveSegment, type SegmentSourceDetail } from '../source';

const segment = SegmentSchema.parse(catalog.segments[0]);
function source(): SegmentSourceDetail {
  return {
    pack: { id: segment.source.packId, version: segment.source.packVersion },
    story: { id: segment.source.storyId },
    sentences: [{ id: segment.source.sentenceId, ru: segment.transcript }],
    audio: [
      {
        id: segment.source.trackId,
        file: segment.source.file,
        durationMs: segment.source.durationMs,
        localUri: 'file:///test.opus',
      },
    ],
  };
}
describe('listening lab provenance', () => {
  it('has twenty non-held-out segments with pending ear checks and explicit boundaries', () => {
    expect(catalog.segments).toHaveLength(20);
    for (const s of catalog.segments) {
      expect(s.source.packId).not.toMatch(/mock|room|reserved/i);
      expect(s.review.earCheck).toBe('pending-T111');
      expect(s.source.endMs - s.source.startMs).toBeGreaterThan(1000);
      expect(s.meaning.options[s.meaning.correctIndex]).toBeTruthy();
    }
    expect(
      SegmentSchema.safeParse({
        ...segment,
        source: { ...segment.source, packId: 'a1-torfl-mock-004' },
      }).success,
    ).toBe(false);
  });
  it('requires exact version, sentence, track, stamps and local audio', () => {
    expect(resolveSegment(segment, source(), segment.source.stamps, () => true).available).toBe(
      true,
    );
    expect(resolveSegment(segment, null, [], () => true).available).toBe(false);
    expect(resolveSegment(segment, source(), segment.source.stamps, () => false).available).toBe(
      false,
    );
    const d = source();
    d.pack.version++;
    expect(resolveSegment(segment, d, segment.source.stamps, () => true).available).toBe(false);
    const changed = source();
    changed.sentences = [{ id: segment.source.sentenceId, ru: 'Другое.' }];
    expect(resolveSegment(segment, changed, segment.source.stamps, () => true).available).toBe(
      false,
    );
    expect(
      resolveSegment(segment, source(), segment.source.stamps.slice(1), () => true).available,
    ).toBe(false);
    expect(
      resolveSegment(
        segment,
        source(),
        [
          ...segment.source.stamps,
          { sentenceId: 'neighbour', tokenIndex: 0, startMs: 1, endMs: 100 },
        ],
        () => true,
      ).available,
    ).toBe(false);
  });
});
describe('dictation word alignment', () => {
  it('normalizes case, punctuation and stress while following the activity ё policy', () => {
    expect(words('— ТЁ́ПЛУЮ, куртку!', 'strict')).toEqual(['тёплую', 'куртку']);
    expect(compareDictation('всё', 'все', 'strict')[0]?.kind).toBe('wrong');
    expect(compareDictation('всё', 'все', 'fold')[0]?.kind).toBe('correct');
  });
  it('distinguishes omissions and additions without shifting the remaining words', () => {
    expect(
      compareDictation('я хочу эту книгу домой', 'я хочу книгу домой', 'strict').map((d) => d.kind),
    ).toEqual(['correct', 'correct', 'missing', 'correct', 'correct']);
    expect(
      compareDictation('я хочу книгу', 'я очень хочу книгу', 'strict').map((d) => d.kind),
    ).toEqual(['correct', 'extra', 'correct', 'correct']);
  });
  it('only labels authored ending substitutions as endings and separates spelling', () => {
    const endings = [{ expected: 'работу', actual: 'работе', note: 'Destination.' }];
    expect(compareDictation('на работу', 'на работе', 'strict', endings)[1]).toMatchObject({
      kind: 'ending',
      note: 'Destination.',
    });
    expect(compareDictation('паспорт', 'паспарт', 'strict')[0]?.kind).toBe('spelling');
    expect(compareDictation('паспорт', 'билет', 'strict')[0]?.kind).toBe('wrong');
    expect(compareDictation('я дома', '', 'strict').map((d) => d.kind)).toEqual([
      'missing',
      'missing',
    ]);
  });
});
describe('assistance and repetition', () => {
  it('only counts a single normal unaided first exposure as first listen', () => {
    const a = { ...EMPTY_ASSISTANCE, plays: 1 };
    expect(firstListen(a, 0, true)).toBe(true);
    for (const b of [
      EMPTY_ASSISTANCE,
      { ...a, plays: 2 },
      { ...a, slowPlays: 1 },
      { ...a, help: 1 },
      { ...a, transcriptSeen: true },
    ])
      expect(firstListen(b, 0, true)).toBe(false);
    expect(firstListen(a, 1, true)).toBe(false);
    expect(firstListen(a, 0, false)).toBe(false);
  });
  it('snapshots help before grading and does not rewrite first results when replaying later', () => {
    const a = { ...EMPTY_ASSISTANCE, plays: 1 };
    const answer = assessMeaning(segment, 0, a, 0, true);
    const dictation = assessDictation(segment, segment.transcript, a, 0, true);
    a.plays++;
    a.transcriptSeen = true;
    expect(answer.assistance.plays).toBe(1);
    expect(answer.firstListen).toBe(true);
    expect(dictation.correct).toBe(true);
    expect(dictation.assistance.transcriptSeen).toBe(false);
  });
});
