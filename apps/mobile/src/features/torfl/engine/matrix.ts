import type { ExamSubtest } from '@sumrak/schema';

import { isAnswered, type ExamAnswer } from '../model';
import { buildLayout } from './layout';

/**
 * The answer matrix (T71, TORFL §8.2) — PURE: one cell per item of the
 * subtest, numbered in the flat order, with answered / flagged / current and
 * (in a LINEAR subtest) whether the cell may be jumped to — only the items of
 * the current audio group, the reducer refuses every other `GOTO`.
 */

export interface MatrixCell {
  number: number;
  flat: number;
  itemId: string;
  answered: boolean;
  flagged: boolean;
  current: boolean;
  /** False when the engine would refuse a jump here (linear lock). */
  enabled: boolean;
}

export function matrixCells(
  subtest: ExamSubtest,
  cursorFlat: number,
  answers: Record<string, ExamAnswer>,
  flagged: readonly string[],
): MatrixCell[] {
  const layout = buildLayout(subtest);
  const group = layout.groups[layout.groupOf[cursorFlat] ?? 0];
  return layout.items.map((it) => {
    const a = answers[it.id];
    return {
      number: it.flat + 1,
      flat: it.flat,
      itemId: it.id,
      answered: a !== undefined && isAnswered(a),
      flagged: flagged.includes(it.id),
      current: it.flat === cursorFlat,
      enabled:
        subtest.navigation === 'free' ||
        (!!group && it.flat >= group.start && it.flat <= group.end),
    };
  });
}

export interface MatrixCounts {
  answered: number;
  unanswered: number;
  flagged: number;
  total: number;
}

export function matrixCounts(cells: readonly MatrixCell[]): MatrixCounts {
  const answered = cells.filter((c) => c.answered).length;
  return {
    answered,
    unanswered: cells.length - answered,
    flagged: cells.filter((c) => c.flagged).length,
    total: cells.length,
  };
}

/** The «Сдать субтест» confirmation copy (unanswered count, flagged count). */
export function submitConfirmCopy(counts: MatrixCounts): { title: string; body: string } {
  const parts: string[] = [];
  if (counts.unanswered > 0) parts.push(`Без ответа: ${counts.unanswered}.`);
  if (counts.flagged > 0) parts.push(`С флажком: ${counts.flagged}.`);
  parts.push('После сдачи вернуться к субтесту нельзя.');
  return { title: 'Сдать субтест?', body: parts.join(' ') };
}
