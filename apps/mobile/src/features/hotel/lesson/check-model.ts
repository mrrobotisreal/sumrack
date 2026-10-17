import type { CourseItem } from '@sumrak/schema';

import { scoreAttempt } from '../hotel-model';

/** A learner's answer to one check item: the raw answer and whether it is right. */
export interface CheckResponse {
  answer: number | string;
  correct: boolean;
}

/**
 * Whether a check item's answer is right. Pure: choice and trigger compare the
 * index; typed and transform go through the T89 scorer (ё/е fold, globs).
 * Half credit counts as not right for a check (checks are all-or-nothing).
 */
export function checkCorrect(item: CourseItem, answer: number | string): boolean {
  const score = scoreAttempt([item], { [item.id]: { answer } });
  return score.items[0]?.correct ?? false;
}

/** True once every check item has a response (the «Далее» gate). */
export function checkAnswered(
  items: readonly CourseItem[],
  responses: Readonly<Record<string, CheckResponse | undefined>>,
): boolean {
  return items.length > 0 && items.every((item) => responses[item.id] !== undefined);
}

/** The learner's pick as text, named when wrong («Вы выбрали …»). Null when there is nothing to name. */
export function checkChosen(item: CourseItem, response: CheckResponse): string | undefined {
  if (response.correct) return undefined;
  if (item.kind === 'choice' && typeof response.answer === 'number') {
    return item.options[response.answer];
  }
  if (item.kind === 'trigger' && typeof response.answer === 'number') {
    return item.tokens[response.answer];
  }
  if (typeof response.answer === 'string' && response.answer.trim() !== '') {
    return response.answer;
  }
  return undefined;
}
