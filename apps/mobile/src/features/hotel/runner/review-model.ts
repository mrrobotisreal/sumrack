import type { CourseItem } from '@sumrak/schema';

import { verdictOf, type Verdict } from './runner-model';

/** One reviewed item of a floor/экстерн run: the learner's answer, the key and the full explanation (decision 5). */
export interface ReviewRow {
  item: CourseItem;
  verdict: Verdict;
  /** The learner's answer, as text (`—` when blank). */
  yourAnswer: string;
  /** The right answer, as text. */
  key: string;
}

/** Build the review rows for a finished sitting. Pure. */
export function reviewRows(
  items: readonly CourseItem[],
  responses: Readonly<
    Record<string, { answer: unknown; correct: boolean; half?: boolean } | undefined>
  >,
  pointsOf: (id: string) => number,
): ReviewRow[] {
  return items.map((item) => {
    const r = responses[item.id];
    return {
      item,
      verdict: verdictOf(pointsOf(item.id)),
      yourAnswer: answerText(item, r?.answer),
      key: keyText(item),
    };
  });
}

function answerText(item: CourseItem, answer: unknown): string {
  if (answer === undefined || answer === null || answer === '') return '—';
  if (typeof answer === 'number') {
    if (item.kind === 'choice') return item.options[answer] ?? '—';
    if (item.kind === 'trigger') return item.tokens[answer] ?? '—';
  }
  return typeof answer === 'string' ? answer : '—';
}

function keyText(item: CourseItem): string {
  if (item.kind === 'choice') return item.options[item.answer] ?? '';
  if (item.kind === 'trigger') return item.tokens[item.answer] ?? '';
  if (item.kind === 'typed' || item.kind === 'transform') return item.accept[0] ?? '';
  return '';
}
