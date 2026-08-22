import { describe, expect, it } from 'vitest';

import type { PackRow } from '@/db/repositories/content';

import { buildPathState, buildUnitState, unitGoalTarget, type BuildPathInput } from '../path-model';

/** T17: the derived path model — the out-of-order-credit heart of the ticket. */

function pack(id: string, type: PackRow['type'], level: PackRow['level'] = 'A1'): PackRow {
  return {
    id,
    version: 1,
    type,
    titleRu: `Т-${id}`,
    titleEn: `T-${id}`,
    level,
    tags: [],
    importedAt: 0,
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
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 111 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: null },
      ],
    });
    const unit = buildUnitState(input.packs[0]!, input);
    expect(unit.stories[0]!.finished).toBe(true);
    expect(unit.stepsDone).toBe(1);
  });

  it('meets the goal from derived review counts and completes when all steps hold', () => {
    const input = baseInput({
      storyProgress: [
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: 2 },
      ],
      unitProgress: [
        {
          packId: 'a1-unit-1',
          lessonReadAt: 5,
          quizPassedAt: 9,
          quizBestScorePercent: 90,
          completedAt: null,
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
    const done = { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1 };
    const both = [done, { packId: 'a1-unit-1', storyId: 's2', finishedAt: 1 }];
    const lessonRead = {
      packId: 'a1-unit-1',
      lessonReadAt: 1,
      quizPassedAt: null,
      quizBestScorePercent: null,
      completedAt: null,
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
    expect(state.levels[0]!.nodes.map((n) => n.pack.id)).toEqual(['a1-unit-1', 'a1-cp']);
    expect(state.current?.pack.id).toBe('a1-unit-1');
  });

  it('moves current past a complete unit to the level checkpoint', () => {
    const input = baseInput({
      storyProgress: [
        { packId: 'a1-unit-1', storyId: 's1', finishedAt: 1 },
        { packId: 'a1-unit-1', storyId: 's2', finishedAt: 1 },
      ],
      unitProgress: [
        {
          packId: 'a1-unit-1',
          lessonReadAt: 1,
          quizPassedAt: 1,
          quizBestScorePercent: 100,
          completedAt: 1,
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
    const cp = state.levels[0]!.nodes.find((n) => n.kind === 'checkpoint');
    expect(cp && cp.kind === 'checkpoint' && cp.passed).toBe(true);
    expect(cp && cp.kind === 'checkpoint' && cp.bestScorePercent).toBe(85);
  });
});
