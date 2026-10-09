import type { Exam, ExamItem, ExamPart, ExamSubtest, ExamSubtestKind } from '@sumrak/schema';

import { torflLevelOf, type TorflLevel } from '../level-profile';
import { examItemKey, findExamItem } from '../model';
import { LIGHTNING_ITEMS } from '../pace';
import { topicLabel } from '../topics';
import type { ItemOutcome } from '../scoring';

/**
 * Drill-runner pure core (T70, TORFL §7.1–§7.3): which items a session
 * serves (a drill set, due deck cards, a «Молния» draw), and what its
 * summary says. No DB / React — the screens and the recorder call these.
 */

export type DrillSource = 'set' | 'deck' | 'lightning';

/** One servable (objective) item with everything the views need. */
export interface DrillEntry {
  packId: string;
  examId: string;
  subtest: ExamSubtest;
  part: ExamPart;
  partIdx: number;
  itemIdx: number;
  item: Extract<ExamItem, { kind: 'choice' | 'typed' }>;
  itemKey: string;
  /** T75: the exam's TORFL level (THE LEVEL RULE) — pace + analytics read it. */
  level: TorflLevel;
}

export const isObjective = (item: ExamItem): item is DrillEntry['item'] =>
  item.kind === 'choice' || item.kind === 'typed';

function entryOf(
  packId: string,
  exam: Exam,
  subtest: ExamSubtest,
  part: ExamPart,
  partIdx: number,
  itemIdx: number,
): DrillEntry | null {
  const item = part.items[itemIdx];
  if (!item || !isObjective(item)) return null;
  return {
    packId,
    examId: exam.id,
    subtest,
    part,
    partIdx,
    itemIdx,
    item,
    itemKey: examItemKey(packId, exam.id, item.id),
    level: torflLevelOf(exam.level),
  };
}

export interface DrillQueue {
  entries: DrillEntry[];
  /** Writing / speaking items left out (practice lives in Письмо / Говорение, T72/T73). */
  skipped: { writing: number; speaking: number };
}

/** A drill exam's items in authored order, optionally one topic; rubric kinds are counted, not served. */
export function drillEntriesFromExam(
  exam: Exam,
  packId: string,
  opts: { topic?: string } = {},
): DrillQueue {
  const entries: DrillEntry[] = [];
  const skipped = { writing: 0, speaking: 0 };
  for (const subtest of exam.subtests) {
    subtest.parts.forEach((part, partIdx) => {
      part.items.forEach((item, itemIdx) => {
        if (opts.topic && item.topic !== opts.topic) return;
        const entry = entryOf(packId, exam, subtest, part, partIdx, itemIdx);
        if (entry) entries.push(entry);
        else if (subtest.kind === 'writing') skipped.writing += 1;
        else if (subtest.kind === 'speaking') skipped.speaking += 1;
      });
    });
  }
  return { entries, skipped };
}

/** A deck card's item in the CURRENT exam; null when a pack update removed it (§12) or it is not objective. */
export function entryForDeckCard(
  card: { packId: string; examId: string; itemId: string },
  exam: Exam | null,
): DrillEntry | null {
  if (!exam) return null;
  const hit = findExamItem(exam, card.itemId);
  if (!hit) return null;
  return entryOf(card.packId, exam, hit.subtest, hit.part, hit.partIdx, hit.itemIdx);
}

export interface TopicAccuracyLike {
  topic: string;
  answered: number;
  correct: number;
}

/** The `n` topics with the lowest accuracy (≥ 1 answer); fewer when stats are thin. */
export function weakestTopics(stats: readonly TopicAccuracyLike[], n = 3): string[] {
  return [...stats]
    .filter((s) => s.answered > 0)
    .sort(
      (a, b) =>
        a.correct / a.answered - b.correct / b.answered ||
        b.answered - a.answered ||
        a.topic.localeCompare(b.topic),
    )
    .slice(0, n)
    .map((s) => s.topic);
}

/** Weight of an item in the lightning draw: 3× when its topic is among the weakest. */
export const WEAK_TOPIC_WEIGHT = 3;

/**
 * «Молния» draw (§7.3): `count` distinct lexgram items, weighted toward the
 * 3 weakest topics (weight 3 vs 1), sampled without replacement. `rng` is
 * injected (0 ≤ r < 1) so tests are deterministic; the result is in draw order.
 */
export function pickLightning(
  candidates: readonly DrillEntry[],
  stats: readonly TopicAccuracyLike[],
  rng: () => number = Math.random,
  count: number = LIGHTNING_ITEMS,
): DrillEntry[] {
  const weak = new Set(weakestTopics(stats, 3));
  const pool = candidates
    .filter((e) => e.subtest.kind === 'lexgram')
    .map((entry) => ({ entry, weight: weak.has(entry.item.topic) ? WEAK_TOPIC_WEIGHT : 1 }));
  const out: DrillEntry[] = [];
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((n, p) => n + p.weight, 0);
    let r = rng() * total;
    let idx = pool.findIndex((p) => {
      r -= p.weight;
      return r < 0;
    });
    if (idx < 0) idx = pool.length - 1;
    out.push(pool[idx]!.entry);
    pool.splice(idx, 1);
  }
  return out;
}

// --- results + summary ---------------------------------------------------------------

export interface DrillResult {
  itemKey: string;
  itemId: string;
  topic: string;
  subtestKind: ExamSubtestKind;
  outcome: ItemOutcome;
  ms: number;
  /** The stem / prompt, for the summary's item list (display only — never sent to analytics). */
  label?: string;
}

export interface TopicRow {
  topic: string;
  ru: string;
  answered: number;
  correct: number;
  pct: number;
}

export interface DrillSummary {
  answered: number;
  /** Full-credit answers. */
  correct: number;
  /** Half-credit answers (typed). */
  half: number;
  accuracyPct: number;
  totalMs: number;
  /** Items now in the deck as due-today mistakes (wrong / blank / half). */
  toDeck: number;
  perTopic: TopicRow[];
}

export function summarizeDrill(results: readonly DrillResult[]): DrillSummary {
  const per = new Map<string, TopicRow>();
  let correct = 0;
  let half = 0;
  let toDeck = 0;
  let totalMs = 0;
  for (const r of results) {
    totalMs += r.ms;
    if (r.outcome === 'full') correct += 1;
    else {
      toDeck += 1;
      if (r.outcome === 'half') half += 1;
    }
    const row = per.get(r.topic) ?? {
      topic: r.topic,
      ru: topicLabel(r.topic).ru,
      answered: 0,
      correct: 0,
      pct: 0,
    };
    row.answered += 1;
    if (r.outcome === 'full') row.correct += 1;
    per.set(r.topic, row);
  }
  const perTopic = [...per.values()].map((row) => ({
    ...row,
    pct: row.answered > 0 ? Math.round((row.correct / row.answered) * 100) : 0,
  }));
  perTopic.sort((a, b) => a.pct - b.pct || a.topic.localeCompare(b.topic));
  return {
    answered: results.length,
    correct,
    half,
    accuracyPct: results.length > 0 ? Math.round((correct / results.length) * 100) : 0,
    totalMs,
    toDeck,
    perTopic,
  };
}

/** `exam_drill_*` analytics identity of a session: packId / examId / kind / topic slugs only. */
export function drillIdentity(
  source: DrillSource,
  entries: readonly DrillEntry[],
  opts: { packId?: string; examId?: string; topic?: string },
): { packId: string; examId: string; subtestKind: string; topic: string; source: DrillSource } {
  const kinds = new Set(entries.map((e) => e.subtest.kind));
  return {
    packId: source === 'set' ? (opts.packId ?? '') : 'mixed',
    examId: source === 'set' ? (opts.examId ?? '') : source,
    subtestKind: kinds.size === 1 ? [...kinds][0]! : 'mixed',
    topic: opts.topic ?? 'all',
    source,
  };
}

/** Max due deck items per deck session (§7.2). */
export const DECK_SESSION_MAX = 20;
/** Max deck items inside the daily session (§7.2). */
export const DAILY_DECK_MAX = 10;

/** The drill route (`app/torfl/drill.tsx`) for a session — one place builds the params. */
export function drillHref(opts: {
  source: DrillSource;
  packId?: string;
  examId?: string;
  topic?: string;
  /** T75: the deck / «Молния» sources are level-scoped; absent = A1 (back-compat). */
  level?: TorflLevel;
}): { pathname: '/torfl/drill'; params: Record<string, string> } {
  const params: Record<string, string> = { source: opts.source };
  if (opts.packId) params.packId = opts.packId;
  if (opts.examId) params.examId = opts.examId;
  if (opts.topic) params.topic = opts.topic;
  if (opts.level) params.level = opts.level;
  return { pathname: '/torfl/drill', params };
}
