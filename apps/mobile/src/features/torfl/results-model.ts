import {
  OBJECTIVE_SUBTEST_KINDS,
  type Exam,
  type ExamItem,
  type ExamSubtest,
  type ExamSubtestKind,
} from '@sumrak/schema';

import { OPTION_LETTERS, acceptedDisplay, scoreItem, type ItemOutcome } from './scoring';
import { isAnswered, type ExamAnswer, type ExamResults } from './model';

/**
 * Results / review derivations (T71, TORFL §8.2) — PURE: the five result
 * rows, the topic breakdown and the per-item review entries are computed
 * here from the attempt + exam + stored answers, so the screens only render.
 */

/** The slice of a stored attempt the rows need (`repos.exams.getAttempt`). */
export interface ResultsAttemptLike {
  scope: string;
  subtestIds: string[] | null;
  results: ExamResults | null;
  state: {
    subtests: readonly {
      id: string;
      kind: string;
      status: string;
      skipped?: unknown;
      autoSubmitted?: unknown;
      timeUsedSec?: unknown;
    }[];
  } | null;
}

export interface ResultRow {
  subtestId: string;
  kind: ExamSubtestKind;
  titleRu: string;
  /** scored = has a result; skipped = a «скоро» placeholder / skipped subtest; pending = never reached. */
  status: 'scored' | 'skipped' | 'pending';
  pct: number | null;
  points: number | null;
  maxPoints: number;
  provisional: boolean;
  timeUsedSec: number | null;
  autoSubmitted: boolean;
}

export function buildResultRows(exam: Exam, attempt: ResultsAttemptLike): ResultRow[] {
  const ids = attempt.subtestIds ?? exam.subtests.map((s) => s.id);
  const rows: ResultRow[] = [];
  for (const subtest of exam.subtests) {
    if (!ids.includes(subtest.id)) continue;
    const run = attempt.state?.subtests.find((s) => s.id === subtest.id);
    const result = attempt.results?.[subtest.id];
    const skipped = run?.skipped === true;
    rows.push({
      subtestId: subtest.id,
      kind: subtest.kind,
      titleRu: subtest.title.ru,
      status: result ? 'scored' : skipped || run?.status === 'submitted' ? 'skipped' : 'pending',
      pct: result?.pct ?? null,
      points: result?.points ?? null,
      maxPoints: result?.maxPoints ?? subtest.maxPoints,
      provisional: result?.provisional ?? false,
      timeUsedSec: typeof run?.timeUsedSec === 'number' ? run.timeUsedSec : null,
      autoSubmitted: run?.autoSubmitted === true,
    });
  }
  return rows;
}

/** `{writing: pct, …}` for the verdict, from the scored rows only. */
export function pctsFromRows(rows: readonly ResultRow[]): Partial<Record<ExamSubtestKind, number>> {
  const out: Partial<Record<ExamSubtestKind, number>> = {};
  for (const r of rows) if (r.pct !== null) out[r.kind] = r.pct;
  return out;
}

export function provisionalFromRows(
  rows: readonly ResultRow[],
): Partial<Record<ExamSubtestKind, boolean>> {
  const out: Partial<Record<ExamSubtestKind, boolean>> = {};
  for (const r of rows) if (r.provisional) out[r.kind] = true;
  return out;
}

/** «Вердикт — после Письма и Говорения»: the missing subtests in the genitive. */
const GENITIVE: Record<ExamSubtestKind, string> = {
  writing: 'Письма',
  lexgram: 'Лексики. Грамматики',
  reading: 'Чтения',
  listening: 'Аудирования',
  speaking: 'Говорения',
};

export function missingVerdictLine(missing: readonly ExamSubtestKind[]): string {
  if (missing.length === 0) return '';
  const names = missing.map((k) => GENITIVE[k]);
  const joined =
    names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} и ${names.at(-1)}`;
  return `Вердикт — после ${joined}`;
}

// --- answers → scoring helpers -----------------------------------------------------------------

export function answerArgFor(
  item: ExamItem,
  answer: ExamAnswer | undefined,
): { index: number | null } | { text: string } {
  const given = answer && isAnswered(answer) ? answer : undefined;
  if (item.kind === 'typed') return { text: given?.kind === 'typed' ? given.text : '' };
  return { index: given?.kind === 'choice' ? given.index : null };
}

// --- topic breakdown ------------------------------------------------------------------------------

export interface TopicResult {
  topic: string;
  kind: ExamSubtestKind;
  correct: number;
  total: number;
  /** 0..1 */
  accuracy: number;
}

/** Per-topic accuracy over the OBJECTIVE items of the scored subtests, weakest first. */
export function topicBreakdown(
  exam: Exam,
  scoredSubtestIds: readonly string[],
  answers: Record<string, ExamAnswer>,
): TopicResult[] {
  const acc = new Map<string, TopicResult>();
  for (const subtest of exam.subtests) {
    if (!scoredSubtestIds.includes(subtest.id) || !OBJECTIVE_SUBTEST_KINDS.includes(subtest.kind)) {
      continue;
    }
    for (const item of subtest.parts.flatMap((p) => p.items)) {
      const score = scoreItem(item, answerArgFor(item, answers[item.id]), subtest);
      if (!score) continue;
      const key = `${subtest.kind}\u0000${item.topic}`;
      const t = acc.get(key) ?? {
        topic: item.topic,
        kind: subtest.kind,
        correct: 0,
        total: 0,
        accuracy: 0,
      };
      t.total += 1;
      if (score.outcome === 'full') t.correct += 1;
      acc.set(key, t);
    }
  }
  return [...acc.values()]
    .map((t) => ({ ...t, accuracy: t.total > 0 ? t.correct / t.total : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || a.topic.localeCompare(b.topic));
}

// --- review ---------------------------------------------------------------------------------------

export interface ReviewEntry {
  /** 1-based number within the subtest (the matrix number). */
  number: number;
  item: ExamItem;
  partInstructionsRu: string;
  outcome: ItemOutcome;
  /** The stem / prompt text. */
  stem: string;
  /** Choice: the options with the chosen / correct marks. */
  options: { letter: string; text: string; chosen: boolean; correct: boolean }[];
  /** Typed: what was typed and the accepted display form. */
  typed: { given: string; accepted: string } | null;
  explain?: string;
  /** Story ids for the passage / transcript link. */
  passageStoryId?: string;
  audioStoryId?: string;
}

export function reviewEntries(
  subtest: ExamSubtest,
  answers: Record<string, ExamAnswer>,
): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  let number = 0;
  for (const part of subtest.parts) {
    for (const [itemIdx, item] of part.items.entries()) {
      number += 1;
      const answer = answers[item.id];
      const score = scoreItem(item, answerArgFor(item, answer), subtest);
      if (!score || (item.kind !== 'choice' && item.kind !== 'typed')) continue;
      const first = part.items[0];
      const inheritedAudio =
        first && (first.kind === 'choice' || first.kind === 'typed') ? first.audio : undefined;
      const audioStoryId = (item.audio ?? (itemIdx > 0 ? inheritedAudio : undefined))?.storyId;
      const base = {
        number,
        item,
        partInstructionsRu: part.instructions.ru,
        outcome: score.outcome,
        explain: item.explain,
        passageStoryId: item.passage?.storyId,
        audioStoryId,
      };
      if (item.kind === 'choice') {
        const chosen = answer?.kind === 'choice' ? answer.index : null;
        out.push({
          ...base,
          stem: item.stem,
          options: item.options.map((text, idx) => ({
            letter: OPTION_LETTERS[idx] ?? String(idx + 1),
            text,
            chosen: chosen === idx,
            correct: item.answer === idx,
          })),
          typed: null,
        });
      } else {
        out.push({
          ...base,
          stem: item.prompt,
          options: [],
          typed: {
            given: answer?.kind === 'typed' ? answer.text : '',
            accepted: acceptedDisplay(item),
          },
        });
      }
    }
  }
  return out;
}

/** Counts for the review header: full / half / wrong / blank. */
export function outcomeCounts(entries: readonly ReviewEntry[]): Record<ItemOutcome, number> {
  const c: Record<ItemOutcome, number> = { full: 0, half: 0, wrong: 0, blank: 0 };
  for (const e of entries) c[e.outcome] += 1;
  return c;
}

/** «1 ч 05 мин» / «12 мин 30 с» for the time-used line. */
export function formatUsed(sec: number | null): string {
  if (sec === null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
  return m > 0 ? `${m} мин ${String(s).padStart(2, '0')} с` : `${s} с`;
}
