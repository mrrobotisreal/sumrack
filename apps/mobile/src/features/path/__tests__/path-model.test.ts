import { describe, expect, it } from 'vitest';

import type { PackRow } from '@/db/repositories/content';

import {
  buildPathState,
  buildUnitState,
  nodeTrack,
  packTrack,
  trackTitle,
  unitGoalTarget,
  type BuildPathInput,
  type PathState,
} from '../path-model';

/** T17: the derived path model — the out-of-order-credit heart of the ticket.
 *  T30 adds track grouping + the most-recently-touched-track current rule. */

function pack(
  id: string,
  type: PackRow['type'],
  level: PackRow['level'] = 'A1',
  extra: Partial<PackRow> = {},
): PackRow {
  return {
    id,
    version: 1,
    type,
    titleRu: `Т-${id}`,
    titleEn: `T-${id}`,
    level,
    tags: [],
    importedAt: 0,
    origin: 'remote',
    themeScene: null,
    themeAccent: null,
    track: null,
    category: null,
    genre: null,
    ...extra,
  };
}

function baseInput(overrides: Partial<BuildPathInput> = {}): BuildPathInput {
  return {
    packs: [pack('a1-unit-1', 'course-unit'), pack('a1-cp', 'checkpoint')],
    stories: [
      { packId: 'a1-unit-1', id: 's1', orderIdx: 0, titleRu: 'Один', titleEn: 'One' },
      { packId: 'a1-unit-1', id: 's2', orderIdx: 1, titleRu: 'Два', titleEn: 'Two' },
    ],
    storyProgress: [],
    unitProgress: [],
    lemmaStats: { 'a1-unit-1': { totalLemmas: 20, collected: 0, reviewed: 0 } },
    checkpointResults: [],
    ...overrides,
  };
}

/** All nodes of a level in rendered order (tracks flattened). */
function levelNodes(state: PathState, i: number) {
  return state.levels[i]!.tracks.flatMap((t) => t.nodes);
}

describe('unitGoalTarget', () => {
  it('caps at 10 and never exceeds the unit lemma count', () => {
    expect(unitGoalTarget(40)).toBe(10);
    expect(unitGoalTarget(6)).toBe(6);
    expect(unitGoalTarget(0)).toBe(0);
  });
});

describe('buildUnitState', () => {
  it('starts with the lesson as the next step and counts steps', () => {
    const input = baseInput();
    const unit = buildUnitState(input.packs[0]!, input);
    expect(unit.stepsTotal).toBe(5); // lesson + 2 stories + goal + quiz
    expect(unit.stepsDone).toBe(0);
    expect(unit.nextStep).toBe('lesson');
    expect(unit.complete).toBe(false);
  });

  it('credits stories finished via the Library (no path facts at all)', () => {
    const input = baseInput({
      storyProgress: [
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 111, updatedAt: 111 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: null, updatedAt: 100 },
      ],
    });
    const unit = buildUnitState(input.packs[0]!, input);
    expect(unit.stories[0]!.finished).toBe(true);
    expect(unit.stepsDone).toBe(1);
  });

  it('meets the goal from derived review counts and completes when all steps hold', () => {
    const input = baseInput({
      storyProgress: [
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1, updatedAt: 1 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: 2, updatedAt: 2 },
      ],
      unitProgress: [
        {
          packId: 'a1-unit-1',
          lessonReadAt: 5,
          quizPassedAt: 9,
          quizBestScorePercent: 90,
          completedAt: null,
          updatedAt: 9,
        },
      ],
      lemmaStats: { 'a1-unit-1': { totalLemmas: 20, collected: 12, reviewed: 10 } },
    });
    const unit = buildUnitState(input.packs[0]!, input);
    expect(unit.goal.target).toBe(10);
    expect(unit.goal.met).toBe(true);
    expect(unit.complete).toBe(true);
    expect(unit.nextStep).toBeNull();
    expect(unit.completedAtRecorded).toBe(false); // fetch layer stamps it
  });

  it('orders next steps lesson → story → goal → quiz', () => {
    const done = { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1, updatedAt: 1 };
    const both = [done, { packId: 'a1-unit-1', storyId: 's2', finishedAt: 1, updatedAt: 1 }];
    const lessonRead = {
      packId: 'a1-unit-1',
      lessonReadAt: 1,
      quizPassedAt: null,
      quizBestScorePercent: null,
      completedAt: null,
      updatedAt: 1,
    };
    const input1 = baseInput({ unitProgress: [lessonRead] });
    expect(buildUnitState(input1.packs[0]!, input1).nextStep).toBe('story');
    const input2 = baseInput({ unitProgress: [lessonRead], storyProgress: both });
    expect(buildUnitState(input2.packs[0]!, input2).nextStep).toBe('goal');
    const input3 = baseInput({
      unitProgress: [lessonRead],
      storyProgress: both,
      lemmaStats: { 'a1-unit-1': { totalLemmas: 20, collected: 12, reviewed: 10 } },
    });
    expect(buildUnitState(input3.packs[0]!, input3).nextStep).toBe('quiz');
  });
});

describe('buildPathState', () => {
  it('groups by level, units before checkpoints, and picks the first incomplete node', () => {
    const input = baseInput({
      packs: [
        pack('a2-unit-1', 'course-unit', 'A2'),
        pack('a1-cp', 'checkpoint', 'A1'),
        pack('a1-unit-1', 'course-unit', 'A1'),
      ],
    });
    const state = buildPathState(input);
    expect(state.levels.map((l) => l.level)).toEqual(['A1', 'A2']);
    expect(levelNodes(state, 0).map((n) => n.pack.id)).toEqual(['a1-unit-1', 'a1-cp']);
    expect(state.current?.pack.id).toBe('a1-unit-1');
  });

  it('moves current past a complete unit to the level checkpoint', () => {
    const input = baseInput({
      storyProgress: [
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1, updatedAt: 1 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: 1, updatedAt: 1 },
      ],
      unitProgress: [
        {
          packId: 'a1-unit-1',
          lessonReadAt: 1,
          quizPassedAt: 1,
          quizBestScorePercent: 100,
          completedAt: 1,
          updatedAt: 1,
        },
      ],
      lemmaStats: { 'a1-unit-1': { totalLemmas: 8, collected: 8, reviewed: 8 } },
    });
    const state = buildPathState(input);
    expect(state.current?.kind).toBe('checkpoint');
  });

  it('checkpoint state carries best score / passed across attempts', () => {
    const input = baseInput({
      checkpointResults: [
        { checkpointPackId: 'a1-cp', scorePercent: 60, passed: false },
        { checkpointPackId: 'a1-cp', scorePercent: 85, passed: true },
      ],
    });
    const state = buildPathState(input);
    const cp = levelNodes(state, 0).find((n) => n.kind === 'checkpoint');
    expect(cp && cp.kind === 'checkpoint' && cp.passed).toBe(true);
    expect(cp && cp.kind === 'checkpoint' && cp.bestScorePercent).toBe(85);
  });
});

describe('tracks (T30)', () => {
  const familyStories = [
    { packId: 'a2-family-1', id: 'f1', orderIdx: 0, titleRu: 'Приезд', titleEn: 'Arrival' },
  ];

  function twoTrackInput(overrides: Partial<BuildPathInput> = {}): BuildPathInput {
    return baseInput({
      packs: [
        pack('a1-unit-1', 'course-unit'),
        pack('a1-cp', 'checkpoint'),
        pack('a2-family-1', 'course-unit', 'A1', { track: 'family' }),
      ],
      stories: [...baseInput().stories, ...familyStories],
      lemmaStats: {
        'a1-unit-1': { totalLemmas: 20, collected: 0, reviewed: 0 },
        'a2-family-1': { totalLemmas: 4, collected: 0, reviewed: 0 },
      },
      ...overrides,
    });
  }

  it('absent track resolves to main at the app layer', () => {
    expect(packTrack(pack('x', 'course-unit'))).toBe('main');
    expect(packTrack(pack('x', 'course-unit', 'A1', { track: 'family' }))).toBe('family');
    expect(trackTitle('family').ru).toBe('Семья');
    expect(trackTitle('mystery-guests')).toEqual({ ru: 'mystery-guests', en: 'mystery-guests' });
  });

  it('groups main first, then other tracks in first-seen pack order; checkpoints close main', () => {
    const state = buildPathState(twoTrackInput());
    const level = state.levels[0]!;
    expect(level.tracks.map((t) => t.track)).toEqual(['main', 'family']);
    expect(level.tracks[0]!.nodes.map((n) => n.pack.id)).toEqual(['a1-unit-1', 'a1-cp']);
    expect(level.tracks[1]!.nodes.map((n) => n.pack.id)).toEqual(['a2-family-1']);
    expect(nodeTrack(level.tracks[0]!.nodes[1]!)).toBe('main');
  });

  it('orders extra tracks by first-seen pack id order, not alphabetically', () => {
    const state = buildPathState(
      twoTrackInput({
        packs: [
          pack('a1-unit-1', 'course-unit'),
          pack('a1-zz-unit', 'course-unit', 'A1', { track: 'zz-first' }),
          pack('a2-family-1', 'course-unit', 'A1', { track: 'family' }),
        ],
      }),
    );
    expect(state.levels[0]!.tracks.map((t) => t.track)).toEqual(['main', 'zz-first', 'family']);
  });

  it('a level with only non-main units renders without an empty main section', () => {
    const state = buildPathState(
      twoTrackInput({ packs: [pack('a2-family-1', 'course-unit', 'A1', { track: 'family' })] }),
    );
    expect(state.levels[0]!.tracks.map((t) => t.track)).toEqual(['family']);
  });

  it('T17 regression: out-of-order credit works identically on a family-track unit', () => {
    const input = twoTrackInput({
      // Library-only usage: story finished + goal met, no path facts at all.
      storyProgress: [{ packId: 'a2-family-1', storyId: 'f1', finishedAt: 7, updatedAt: 7 }],
      unitProgress: [
        {
          packId: 'a2-family-1',
          lessonReadAt: 8,
          quizPassedAt: 9,
          quizBestScorePercent: 100,
          completedAt: null,
          updatedAt: 9,
        },
      ],
      lemmaStats: {
        'a1-unit-1': { totalLemmas: 20, collected: 0, reviewed: 0 },
        'a2-family-1': { totalLemmas: 4, collected: 4, reviewed: 4 },
      },
    });
    const family = buildPathState(input).levels[0]!.tracks[1]!.nodes[0]!;
    expect(family.kind === 'unit' && family.complete).toBe(true);
    expect(family.kind === 'unit' && family.completedAtRecorded).toBe(false); // fetch stamps it
  });

  describe('current follows the most recently touched track', () => {
    it('picks the family track after a family unit was touched last', () => {
      const state = buildPathState(
        twoTrackInput({
          storyProgress: [
            { packId: 'a1-unit-1', storyId: 's1', finishedAt: 10, updatedAt: 10 },
            { packId: 'a2-family-1', storyId: 'f1', finishedAt: null, updatedAt: 20 },
          ],
        }),
      );
      expect(state.current?.pack.id).toBe('a2-family-1');
    });

    it('returns to main when a main unit was touched more recently', () => {
      const state = buildPathState(
        twoTrackInput({
          storyProgress: [
            { packId: 'a2-family-1', storyId: 'f1', finishedAt: null, updatedAt: 20 },
            { packId: 'a1-unit-1', storyId: 's1', finishedAt: null, updatedAt: 30 },
          ],
        }),
      );
      expect(state.current?.pack.id).toBe('a1-unit-1');
    });

    it('unit_progress touches (lesson read) count too', () => {
      const state = buildPathState(
        twoTrackInput({
          storyProgress: [{ packId: 'a1-unit-1', storyId: 's1', finishedAt: 5, updatedAt: 5 }],
          unitProgress: [
            {
              packId: 'a2-family-1',
              lessonReadAt: 50,
              quizPassedAt: null,
              quizBestScorePercent: null,
              completedAt: null,
              updatedAt: 50,
            },
          ],
        }),
      );
      expect(state.current?.pack.id).toBe('a2-family-1');
    });

    it('falls back to the global first incomplete node when the touched track is complete', () => {
      const state = buildPathState(
        twoTrackInput({
          storyProgress: [{ packId: 'a2-family-1', storyId: 'f1', finishedAt: 99, updatedAt: 99 }],
          unitProgress: [
            {
              packId: 'a2-family-1',
              lessonReadAt: 99,
              quizPassedAt: 99,
              quizBestScorePercent: 100,
              completedAt: 99,
              updatedAt: 99,
            },
          ],
          lemmaStats: {
            'a1-unit-1': { totalLemmas: 20, collected: 0, reviewed: 0 },
            'a2-family-1': { totalLemmas: 4, collected: 4, reviewed: 4 },
          },
        }),
      );
      // family track fully complete → fall back to main's first incomplete
      expect(state.current?.pack.id).toBe('a1-unit-1');
    });

    it('untouched path keeps the T17 rule: global first incomplete node', () => {
      const state = buildPathState(twoTrackInput());
      expect(state.current?.pack.id).toBe('a1-unit-1');
    });
  });
});
