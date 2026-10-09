import type { Exam, WritingItem } from '@sumrak/schema';

import { bulletCoverage, sentenceSplit } from '../grading/writing';

/**
 * Pure derivations for the writing editor (T72, TORFL §8.3): the live
 * counters and the bullet checklist. Both the mock runner (counters only —
 * the exam lets candidates count) and the practice mode (counters + the
 * ticking checklist) read these.
 */

/**
 * The analytics `task` + `topic` of a writing item (T75, A2-12): `task` is
 * the 1-based position of the item among its subtest's writing items (parts
 * in order — A1's single letter → 1, A2's note → 2); `topic` is the item's
 * topic slug. Unknown item → `{ task: 0, topic: 'none' }`.
 */
export function writingTaskOf(
  exam: Exam,
  subtestId: string,
  itemId: string,
): { task: number; topic: string } {
  const subtest = exam.subtests.find((s) => s.id === subtestId);
  if (!subtest) return { task: 0, topic: 'none' };
  let position = 0;
  for (const part of subtest.parts) {
    for (const item of part.items) {
      if (item.kind !== 'writing') continue;
      position += 1;
      if (item.id === itemId) return { task: position, topic: item.topic };
    }
  }
  return { task: 0, topic: 'none' };
}

export interface WritingCounters {
  sentences: number;
  questions: number;
  minSentences: number;
  minQuestions: number;
  maxQuestions: number | null;
  /** Sentences ≥ min and questions within range. */
  lengthOk: boolean;
  questionsOk: boolean;
}

export function writingCounters(
  item: Pick<WritingItem, 'minSentences' | 'minQuestions' | 'maxQuestions'>,
  text: string,
): WritingCounters {
  const s = sentenceSplit(text);
  const maxQ = item.maxQuestions ?? null;
  return {
    sentences: s.sentences.length,
    questions: s.questions,
    minSentences: item.minSentences,
    minQuestions: item.minQuestions,
    maxQuestions: maxQ,
    lengthOk: s.sentences.length >= item.minSentences,
    questionsOk: s.questions >= item.minQuestions && (maxQ === null || s.questions <= maxQ),
  };
}

export interface ChecklistRow {
  id: string;
  ru: string;
  en: string;
  done: boolean;
}

/** The practice checklist: one row per bullet, `done` when a cue matches the current text. */
export function writingChecklist(item: Pick<WritingItem, 'bullets'>, text: string): ChecklistRow[] {
  const cov = bulletCoverage(text, item.bullets);
  const done = new Set(cov.covered);
  return item.bullets.map((b) => ({
    id: b.id,
    ru: b.text.ru,
    en: b.text.en,
    done: done.has(b.id),
  }));
}

/** «Предложений: 7 / ≥ 10 · Вопросов: 1 / 2–5» */
export function countersLine(c: WritingCounters): string {
  const q =
    c.maxQuestions !== null
      ? `${c.questions} / ${c.minQuestions}–${c.maxQuestions}`
      : `${c.questions} / ≥ ${c.minQuestions}`;
  return `Предложений: ${c.sentences} / ≥ ${c.minSentences} · Вопросов: ${q}`;
}

/** The word under / around a caret or selection inside `text` (for the dictionary pre-fill). */
export function wordAtSelection(text: string, start: number, end: number): string {
  if (end > start) return text.slice(start, end).trim();
  const isWord = (ch: string) => /[\p{L}\p{N}-]/u.test(ch);
  let a = Math.min(start, text.length);
  let b = a;
  while (a > 0 && isWord(text[a - 1]!)) a--;
  while (b < text.length && isWord(text[b]!)) b++;
  return text.slice(a, b).trim();
}
