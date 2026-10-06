import type { Exam, SpeakingMonologueItem, SpeakingTurnItem } from '@sumrak/schema';

import type { ExamSummaryLike } from '../hub-model';

/**
 * Speaking practice catalogs (T73, TORFL §10 + the hub «Тренировки →
 * Говорение» tab) — PURE.
 *
 * - `speakingPracticeEntries`: every task-1 / task-2 item of every installed
 *   exam (drill sets first, then mocks) for the untimed one-by-one drill.
 * - `monologueTickets`: every `speaking-monologue` item — the «Билеты»
 *   pool — with how often it has been answered, so `drawTicket` can weight
 *   the draw to the least practised (weight = 1 / (1 + answered)).
 */
export interface SpeakingPracticeEntry {
  packId: string;
  examId: string;
  examTitleRu: string;
  mode: 'drill' | 'mock';
  subtestId: string;
  item: SpeakingTurnItem;
}

export interface MonologueTicket {
  packId: string;
  examId: string;
  examTitleRu: string;
  subtestId: string;
  item: SpeakingMonologueItem;
  /** Finished responses on this item (any attempt scope). */
  answered: number;
}

export function speakingPracticeEntries(
  summaries: readonly ExamSummaryLike[],
): SpeakingPracticeEntry[] {
  const out: SpeakingPracticeEntry[] = [];
  const push = (s: ExamSummaryLike, exam: Exam) => {
    for (const subtest of exam.subtests) {
      if (subtest.kind !== 'speaking') continue;
      for (const item of subtest.parts.flatMap((p) => p.items)) {
        if (item.kind !== 'speaking-reply' && item.kind !== 'speaking-situation') continue;
        out.push({
          packId: s.packId,
          examId: s.examId,
          examTitleRu: s.titleRu,
          mode: s.mode,
          subtestId: subtest.id,
          item,
        });
      }
    }
  };
  for (const s of summaries) if (s.exam && s.mode === 'drill') push(s, s.exam);
  for (const s of summaries) if (s.exam && s.mode === 'mock') push(s, s.exam);
  return out;
}

/** `answeredCounts`: `${packId}:${examId}:${itemId}` → responses recorded. */
export function monologueTickets(
  summaries: readonly ExamSummaryLike[],
  answeredCounts: ReadonlyMap<string, number> = new Map(),
): MonologueTicket[] {
  const out: MonologueTicket[] = [];
  for (const s of summaries) {
    if (!s.exam) continue;
    for (const subtest of s.exam.subtests) {
      if (subtest.kind !== 'speaking') continue;
      for (const item of subtest.parts.flatMap((p) => p.items)) {
        if (item.kind !== 'speaking-monologue') continue;
        out.push({
          packId: s.packId,
          examId: s.examId,
          examTitleRu: s.titleRu,
          subtestId: subtest.id,
          item,
          answered: answeredCounts.get(`${s.packId}:${s.examId}:${item.id}`) ?? 0,
        });
      }
    }
  }
  return out;
}

/**
 * Draw one ticket, weighted to the least practised: weight 1 / (1 +
 * answered). `rand` ∈ [0, 1) is injected (tests pin the draw).
 */
export function drawTicket(
  tickets: readonly MonologueTicket[],
  rand: () => number = Math.random,
): MonologueTicket | null {
  if (tickets.length === 0) return null;
  const weights = tickets.map((t) => 1 / (1 + Math.max(0, t.answered)));
  const total = weights.reduce((n, w) => n + w, 0);
  let r = rand() * total;
  for (let i = 0; i < tickets.length; i++) {
    r -= weights[i]!;
    if (r < 0) return tickets[i]!;
  }
  return tickets[tickets.length - 1]!;
}

export function ticketHref(): { pathname: '/torfl/tickets' } {
  return { pathname: '/torfl/tickets' };
}

export function speakingPracticeHref(
  e: Pick<SpeakingPracticeEntry, 'packId' | 'examId' | 'item'>,
): {
  pathname: '/torfl/speak';
  params: Record<string, string>;
} {
  return {
    pathname: '/torfl/speak',
    params: { packId: e.packId, examId: e.examId, itemId: e.item.id },
  };
}
