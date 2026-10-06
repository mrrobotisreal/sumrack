import { ExamSchema, type Exam, type Pack } from '@sumrak/schema';
import examPackJson from '@sumrak/schema/fixtures/packs/a1-exam-fixture/pack.json';
import { describe, expect, it } from 'vitest';

import { matrixCells, matrixCounts, submitConfirmCopy } from '../engine/matrix';
import type { ExamAnswer } from '../model';

const PACK = examPackJson as unknown as Pack;
const EXAM: Exam = ExamSchema.parse(PACK.exams!.find((e) => e.id === 'a1-mock-fx'));
const sub = (id: string) => EXAM.subtests.find((s) => s.id === id)!;
const ch = (i: number | null): ExamAnswer => ({ kind: 'choice', index: i });

describe('matrixCells', () => {
  it('free subtest: every cell enabled; answered / flagged / current marked; a null choice is unanswered', () => {
    const cells = matrixCells(sub('lexgram'), 1, { lg01: ch(0), lg02: ch(null) }, ['lg04']);
    expect(cells.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
    expect(cells.map((c) => c.answered)).toEqual([true, false, false, false, false]);
    expect(cells.map((c) => c.flagged)).toEqual([false, false, false, true, false]);
    expect(cells.map((c) => c.current)).toEqual([false, true, false, false, false]);
    expect(cells.every((c) => c.enabled)).toBe(true);
  });

  it('linear subtest: only the current audio group is jumpable (the fixture has one group of three)', () => {
    expect(matrixCells(sub('listening'), 0, {}, []).every((c) => c.enabled)).toBe(true);
  });

  it('linear subtest with two groups locks the other one', () => {
    const base = sub('listening');
    const first = base.parts[0]!.items[0] as Extract<
      (typeof base.parts)[number]['items'][number],
      { kind: 'choice' }
    >;
    const two: typeof base = {
      ...base,
      parts: [
        base.parts[0]!,
        {
          ...base.parts[0]!,
          id: 'p4',
          items: [{ ...first, id: 'ls10', audio: { storyId: 'ls-01' } }],
        },
      ],
    };
    const cells = matrixCells(two, 3, {}, []);
    expect(cells.map((c) => c.enabled)).toEqual([false, false, false, true]);
  });
});

describe('counts + confirm copy', () => {
  it('counts and words the confirmation', () => {
    const counts = matrixCounts(matrixCells(sub('lexgram'), 0, { lg01: ch(1) }, ['lg02', 'lg03']));
    expect(counts).toEqual({ answered: 1, unanswered: 4, flagged: 2, total: 5 });
    expect(submitConfirmCopy(counts).body).toBe(
      'Без ответа: 4. С флажком: 2. После сдачи вернуться к субтесту нельзя.',
    );
    expect(submitConfirmCopy({ answered: 5, unanswered: 0, flagged: 0, total: 5 }).body).toBe(
      'После сдачи вернуться к субтесту нельзя.',
    );
  });
});
