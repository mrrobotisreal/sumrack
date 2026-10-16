import { describe, expect, it } from 'vitest';

import {
  resolveContinueTarget,
  type ContinueProgress,
  type ContinueStory,
} from '../continue-target';

const pw = (n: number): ContinueStory => ({
  packId: 'a2-peeking-wife-001',
  id: `part-${n}`,
  orderIdx: n - 1,
  titleRu: `Часть ${n}`,
});
const STORIES: ContinueStory[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map(pw),
  { packId: 'a2-news-001', id: 'drones', orderIdx: 0, titleRu: 'Новости' },
];
const row = (
  packId: string,
  storyId: string,
  updatedAt: number,
  finishedAt: number | null = null,
): ContinueProgress => ({ packId, storyId, updatedAt, finishedAt });

describe('resolveContinueTarget (T84)', () => {
  it("Mitch's real S24U shape: finished part-5 newest, unfinished news just before → part-6, not the news", () => {
    // story_progress pulled 2026-10-11 (times = minutes for readability).
    const progress = [
      row('a2-peeking-wife-001', 'part-5', 1002, 900),
      row('a2-news-001', 'drones', 1001),
      row('a2-peeking-wife-001', 'part-4', 500, 400),
    ];
    expect(resolveContinueTarget(progress, STORIES)).toEqual({
      packId: 'a2-peeking-wife-001',
      storyId: 'part-6',
      title: 'Часть 6',
      kind: 'next',
    });
  });

  it('resumes the last-read story when it is unfinished (e.g. 47 % into part 4)', () => {
    const progress = [row('a2-peeking-wife-001', 'part-4', 50), row('a2-news-001', 'drones', 10)];
    expect(resolveContinueTarget(progress, STORIES)).toMatchObject({
      storyId: 'part-4',
      kind: 'resume',
    });
  });

  it('opening the news once and leaving it does not lock it in: finishing a part moves on', () => {
    const progress = [
      row('a2-peeking-wife-001', 'part-4', 60, 60),
      row('a2-news-001', 'drones', 59),
    ];
    expect(resolveContinueTarget(progress, STORIES)).toMatchObject({
      storyId: 'part-5',
      kind: 'next',
    });
  });

  it('a started-but-unfinished next part is resumed as the next target', () => {
    const progress = [
      row('a2-peeking-wife-001', 'part-4', 60, 60),
      row('a2-peeking-wife-001', 'part-5', 30),
    ];
    expect(resolveContinueTarget(progress, STORIES)).toMatchObject({
      storyId: 'part-5',
      kind: 'next',
    });
  });

  it('last part of a pack finished → newest unfinished story anywhere', () => {
    const progress = [
      row('a2-peeking-wife-001', 'part-7', 90, 90),
      row('a2-news-001', 'drones', 20),
    ];
    expect(resolveContinueTarget(progress, STORIES)).toMatchObject({
      packId: 'a2-news-001',
      kind: 'fallback',
    });
  });

  it('next part already finished → fallback (never re-serves finished reading)', () => {
    const progress = [
      row('a2-peeking-wife-001', 'part-4', 90, 90),
      row('a2-peeking-wife-001', 'part-5', 80, 80),
    ];
    expect(resolveContinueTarget(progress, STORIES)).toBeNull();
  });

  it('everything finished at the end of a pack → null (open the Library)', () => {
    expect(resolveContinueTarget([row('a2-peeking-wife-001', 'part-7', 9, 9)], STORIES)).toBeNull();
  });

  it('ignores progress rows whose story was removed', () => {
    const progress = [row('gone-pack', 'x', 99), row('a2-peeking-wife-001', 'part-2', 10)];
    expect(resolveContinueTarget(progress, STORIES)).toMatchObject({
      storyId: 'part-2',
      kind: 'resume',
    });
  });

  it('no progress → null', () => {
    expect(resolveContinueTarget([], STORIES)).toBeNull();
  });
});

describe('resolveContinueTarget series step (T86)', () => {
  const tb = (packId: string): ContinueStory[] =>
    [1, 2].map((p) => ({ packId, id: `${packId}-p${p}`, orderIdx: p - 1, titleRu: `${packId} ${p}` }));
  const placements: Record<string, { series: string; chapter: number; level: string }> = {
    'a2-three-body-ch04': { series: 'three-body', chapter: 4, level: 'A2' },
    'a2-three-body-ch05': { series: 'three-body', chapter: 5, level: 'A2' },
    'a1-three-body-ch05': { series: 'three-body', chapter: 5, level: 'A1' },
    'a2-three-body-ch06': { series: 'three-body', chapter: 6, level: 'A2' },
  };
  const seriesOf = (packId: string) => placements[packId] ?? null;
  const STORIES_TB: ContinueStory[] = [
    ...tb('a2-three-body-ch04'),
    ...tb('a2-three-body-ch05'),
    ...tb('a1-three-body-ch05'),
    ...tb('a2-three-body-ch06'),
  ];
  // Last part of ch04 (p2) finished; the next chapter's p1 is what matters.
  const endOfCh4 = row('a2-three-body-ch04', 'a2-three-body-ch04-p2', 100, 100);

  it('chooses chapter + 1, part 1, at the same level', () => {
    expect(resolveContinueTarget([endOfCh4], STORIES_TB, seriesOf)).toEqual({
      packId: 'a2-three-body-ch05',
      storyId: 'a2-three-body-ch05-p1',
      title: 'a2-three-body-ch05 1',
      kind: 'next',
      fromPackId: 'a2-three-body-ch04',
    });
  });

  it('does not choose chapter + 1 at a different level', () => {
    const onlyA1Next = STORIES_TB.filter((s) => s.packId !== 'a2-three-body-ch05');
    // Only the A1 ch05 is installed as chapter + 1: not the same level, so no series step.
    expect(resolveContinueTarget([endOfCh4], onlyA1Next, seriesOf)).toBeNull();
  });

  it('falls back to rule 4 when chapter + 1 is not installed', () => {
    const noNext = STORIES_TB.filter((s) => s.packId !== 'a2-three-body-ch05');
    const unfinished = row('a2-peeking-wife-001', 'part-1', 50);
    const out = resolveContinueTarget([endOfCh4, unfinished], [...noNext, ...STORIES], seriesOf);
    expect(out).toMatchObject({ kind: 'fallback', storyId: 'part-1' });
  });

  it('leaves a non-series pack exactly as before', () => {
    const progress = [row('a2-peeking-wife-001', 'part-5', 1002, 900)];
    const plain = resolveContinueTarget(progress, STORIES, () => null);
    expect(plain).toMatchObject({ storyId: 'part-6', kind: 'next' });
  });
});
