import { ExamSchema, type Exam } from '@sumrak/schema';
import a2Pack from '@sumrak/schema/fixtures/packs/a2-exam-fixture/pack.json';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  TOP_EPSILON,
  clearPassageOffsets,
  passageKey,
  recallPassageOffset,
  rememberPassageOffset,
  showToTop,
} from '../items/passage-scroll';

describe('passage scroll memory (T76)', () => {
  beforeEach(() => clearPassageOffsets());

  it('is keyed by pack + story: item 11 → 12 → 25 of one passage share an offset', () => {
    const k = passageKey('a2-exam-fixture', 'rd-films');
    rememberPassageOffset(k, 612.4);
    // item 12 mounts a fresh panel of the same story
    expect(recallPassageOffset(passageKey('a2-exam-fixture', 'rd-films'))).toBe(612);
    // item 25 too; another story / pack is independent
    expect(recallPassageOffset(passageKey('a2-exam-fixture', 'rd-article'))).toBe(0);
    expect(recallPassageOffset(passageKey('other', 'rd-films'))).toBe(0);
  });

  it('scrolling back to the top forgets the offset; the chip only shows once past the top', () => {
    const k = passageKey('p', 's');
    rememberPassageOffset(k, 300);
    rememberPassageOffset(k, TOP_EPSILON);
    expect(recallPassageOffset(k)).toBe(0);
    expect(showToTop(0)).toBe(false);
    expect(showToTop(TOP_EPSILON * 3)).toBe(false);
    expect(showToTop(TOP_EPSILON * 3 + 1)).toBe(true);
  });

  it('clear starts a fresh sitting at the top', () => {
    rememberPassageOffset('a/b', 500);
    clearPassageOffsets();
    expect(recallPassageOffset('a/b')).toBe(0);
  });

  it('the A2 fixture shares one passage story across several reading items', () => {
    const exam = ExamSchema.parse(
      (a2Pack as unknown as { exams: { id: string }[] }).exams.find((e) => e.id === 'a2-mock-fx'),
    ) as Exam;
    const reading = exam.subtests.find((s) => s.kind === 'reading')!;
    const ids = reading.parts
      .flatMap((p) => p.items)
      .map((i) => (i.kind === 'choice' || i.kind === 'typed' ? i.passage?.storyId : undefined))
      .filter(Boolean);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });
});
