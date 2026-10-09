import type { ExamSubtestKind } from '@sumrak/schema';

import type { ExamResults, ExamVerdict } from './model';
import type { TorflLevel } from './level-profile';
import { BORDERLINE_PCT, PASS_PCT, predictVerdict } from './verdict';
import { SUBTEST_LABELS, SUBTEST_ORDER } from './topics';

/**
 * Readiness (T70, TORFL_EXAM_PREP §7.4) — PURE: what the hub's «Готовность»
 * bars, the Library hub card's mini-bars and «Сегодня» are computed from.
 *
 * Per subtest kind, in this order:
 *  1. a finished full / single-subtest MOCK of that kind within the last
 *     {@link MOCK_WINDOW_DAYS} days → its latest pct (provisional allowed,
 *     labelled);
 *  2. else the DRILL ESTIMATE over the last 200 objective responses of that
 *     kind, shrunk toward 50 % when there are few: `(correct + 15) / (n + 30)
 *     × 100` (n = 0 → 50, so the estimate only exists once n ≥ 1);
 *  3. else unknown. Writing / speaking have no objective responses, so only
 *     a mock (T71–T73) ever fills them.
 */

export const MOCK_WINDOW_DAYS = 21;
export const DRILL_ESTIMATE_WINDOW = 200;
/** Shrinkage prior: 15 imaginary correct out of 30 = a 50 % prior worth 30 answers. */
export const SHRINK_CORRECT = 15;
export const SHRINK_N = 30;
const DAY_MS = 86_400_000;

/** The SPbU lines (§6.3) live in `verdict.ts`; re-exported for the T70 importers. */
export { BORDERLINE_PCT, PASS_PCT };
/** «с запасом»: gold band. */
export const MARGIN_PCT = 80;

/** § 7.4 bands: < 60 red · 60–66 amber · 66–80 green · ≥ 80 gold. */
export type ReadinessBand = 'fail' | 'borderline' | 'pass' | 'margin';

export function bandFor(pct: number): ReadinessBand {
  if (pct >= MARGIN_PCT) return 'margin';
  if (pct >= PASS_PCT) return 'pass';
  if (pct >= BORDERLINE_PCT) return 'borderline';
  return 'fail';
}

/** Theme-token class per band (tokens in `global.css`: danger · track-warm · success · gold). */
export const BAND_BAR_CLASS: Record<ReadinessBand, string> = {
  fail: 'bg-danger',
  borderline: 'bg-track-warm',
  pass: 'bg-success',
  margin: 'bg-gold',
};

/** Same hues for text, on the dark surface. */
export const BAND_TEXT_CLASS: Record<ReadinessBand, string> = {
  fail: 'text-danger',
  borderline: 'text-track-warm',
  pass: 'text-success',
  margin: 'text-gold',
};

export type ReadinessSource = 'mock' | 'estimate' | 'none';

export interface ReadinessRow {
  kind: ExamSubtestKind;
  pct: number | null;
  band: ReadinessBand | null;
  source: ReadinessSource;
  /** Mock results waiting on AI grading (writing / speaking offline-scored). */
  provisional: boolean;
  /** Days since the mock (0 = today); null unless `source === 'mock'`. */
  mockDaysAgo: number | null;
  /** Objective responses behind an estimate; 0 otherwise. */
  answered: number;
  /** The source line under the bar. */
  label: string;
}

/** The latest mock pct of one kind (output of {@link latestMockPcts}). */
export interface MockPct {
  pct: number;
  finishedAt: number;
  provisional: boolean;
}

export interface DrillAccuracy {
  answered: number;
  correct: number;
}

/** What {@link latestMockPcts} needs of an attempt (repos.exams.listAttempts). */
export interface MockAttemptLike {
  status: string;
  mode: string;
  finishedAt: number | null;
  results: ExamResults | null;
  state: { subtests: readonly { id: string; kind: ExamSubtestKind }[] } | null;
}

const KIND_SET = new Set<string>(SUBTEST_ORDER);

/**
 * Latest finished mock pct per subtest kind. The kind of a results entry
 * comes from the attempt's state cursors (subtest id → kind); an id that IS
 * a kind name is accepted when the state is unreadable. Attempts may be in
 * any order.
 */
export function latestMockPcts(
  attempts: readonly MockAttemptLike[],
): Partial<Record<ExamSubtestKind, MockPct>> {
  const out: Partial<Record<ExamSubtestKind, MockPct>> = {};
  for (const a of attempts) {
    if (a.status !== 'finished' || a.mode !== 'mock' || a.finishedAt === null || !a.results) {
      continue;
    }
    const kindOfId = new Map((a.state?.subtests ?? []).map((s) => [s.id, s.kind]));
    for (const [subtestId, result] of Object.entries(a.results)) {
      const kind = kindOfId.get(subtestId) ?? (KIND_SET.has(subtestId) ? subtestId : null);
      if (!kind) continue;
      const k = kind as ExamSubtestKind;
      const prev = out[k];
      if (!prev || a.finishedAt > prev.finishedAt) {
        out[k] = { pct: result.pct, finishedAt: a.finishedAt, provisional: result.provisional };
      }
    }
  }
  return out;
}

/** `(correct + 15) / (n + 30) × 100`, one decimal; null when there is no response at all. */
export function drillEstimate(acc: DrillAccuracy | undefined): number | null {
  if (!acc || acc.answered <= 0) return null;
  const est = ((acc.correct + SHRINK_CORRECT) / (acc.answered + SHRINK_N)) * 100;
  return Math.round(est * 10) / 10;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'пробный экзамен сегодня';
  if (days === 1) return 'пробный экзамен вчера';
  return `пробный экзамен ${days} дн. назад`;
}

export interface ReadinessInput {
  now: number;
  mocks: Partial<Record<ExamSubtestKind, MockPct>>;
  drills: Partial<Record<ExamSubtestKind, DrillAccuracy>>;
}

export function computeReadiness(input: ReadinessInput): ReadinessRow[] {
  return SUBTEST_ORDER.map((kind): ReadinessRow => {
    const mock = input.mocks[kind];
    if (mock) {
      const days = Math.floor((input.now - mock.finishedAt) / DAY_MS);
      if (days <= MOCK_WINDOW_DAYS) {
        return {
          kind,
          pct: mock.pct,
          band: bandFor(mock.pct),
          source: 'mock',
          provisional: mock.provisional,
          mockDaysAgo: Math.max(0, days),
          answered: 0,
          label: `${daysAgoLabel(days)}${mock.provisional ? ' · предварительно' : ''}`,
        };
      }
    }
    const acc = input.drills[kind];
    const est = drillEstimate(acc);
    if (est !== null) {
      return {
        kind,
        pct: est,
        band: bandFor(est),
        source: 'estimate',
        provisional: false,
        mockDaysAgo: null,
        answered: acc!.answered,
        label: `оценка по тренировкам · ${acc!.answered} ${acc!.answered === 1 ? 'ответ' : 'отв.'}`,
      };
    }
    return {
      kind,
      pct: null,
      band: null,
      source: 'none',
      provisional: false,
      mockDaysAgo: null,
      answered: 0,
      label:
        kind === 'writing' || kind === 'speaking'
          ? 'появится после пробного экзамена'
          : 'появится после первой тренировки',
    };
  });
}

// --- predicted verdict (T71: the rule lives in verdict.ts; re-exported here) ----------

export { predictVerdict };

export interface PredictedLine {
  verdict: ExamVerdict;
  /** «Сейчас: сдал бы» / «Сейчас: почти» / «Сейчас: пока нет — подтяни: Аудирование». */
  text: string;
  retake: ExamSubtestKind[];
}

/** The hub's one-line predicted verdict (§5.3), from the five readiness rows. */
export function predictedLine(
  rows: readonly ReadinessRow[],
  level: TorflLevel = 'A1',
): PredictedLine {
  const pcts: Partial<Record<ExamSubtestKind, number | null>> = {};
  for (const r of rows) pcts[r.kind] = r.pct;
  const { verdict, retake } = predictVerdict(pcts, level);
  if (verdict === 'pass') return { verdict, text: 'Сейчас: сдал бы', retake };
  if (verdict === 'pass-borderline') {
    return { verdict, text: 'Сейчас: почти — один субтест на грани', retake };
  }
  const names = retake.slice(0, 3).map((k) => SUBTEST_LABELS[k].short);
  return { verdict, text: `Сейчас: пока нет — подтяни: ${names.join(', ')}`, retake };
}

// --- «Сегодня» --------------------------------------------------------------------

export interface TopicAccuracy {
  topic: string;
  answered: number;
  correct: number;
}

/** A topic needs this many answers before it can be called «the weakest». */
export const MIN_TOPIC_ANSWERS = 3;

/** Lowest-accuracy topic among `topics` with ≥ {@link MIN_TOPIC_ANSWERS} answers (ties → fewer answers, then slug). */
export function weakestTopic(
  stats: readonly TopicAccuracy[],
  topics: ReadonlySet<string>,
): TopicAccuracy | null {
  const candidates = stats.filter((s) => topics.has(s.topic) && s.answered >= MIN_TOPIC_ANSWERS);
  if (candidates.length === 0) return null;
  const acc = (s: TopicAccuracy) => s.correct / s.answered;
  return [...candidates].sort(
    (a, b) => acc(a) - acc(b) || a.answered - b.answered || a.topic.localeCompare(b.topic),
  )[0]!;
}

export type TodayStep =
  | { kind: 'topic'; subtestKind: ExamSubtestKind; topic: string; accuracy: number }
  | { kind: 'deck'; due: number }
  | { kind: 'mock' }
  | { kind: 'start'; subtestKind: ExamSubtestKind };

export interface TodayInput {
  rows: readonly ReadinessRow[];
  /** topic slugs per subtest kind that have a drill tile (the practisable set). */
  topicsByKind: Partial<Record<ExamSubtestKind, ReadonlySet<string>>>;
  topicStats: readonly TopicAccuracy[];
  deckDue: number;
  /** Latest finished mock of ANY kind (epoch ms), or null. */
  lastMockAt: number | null;
  now: number;
  /** Is a mock exam installed (the «time for a mock» step needs somewhere to go)? */
  mockInstalled: boolean;
}

/**
 * The recommended next step (TORFL §5.3). Order:
 *  1. the weakest topic of the weakest subtest whose readiness is under the
 *     66 % line (needs ≥ 3 answers in that topic);
 *  2. due deck items;
 *  3. «time for a mock»: no mock in 7 days and the three objective subtests
 *     all known and ≥ 60 %;
 *  4. otherwise the practisable topic with the lowest accuracy anywhere, else
 *     the first drill of the first subtest that has one; null with no drills.
 */
export function recommendToday(input: TodayInput): TodayStep | null {
  const { rows } = input;
  const objective = rows.filter((r) => r.kind !== 'writing' && r.kind !== 'speaking');
  const weakRows = [...objective]
    .filter((r) => r.pct !== null && r.pct < PASS_PCT)
    .sort((a, b) => a.pct! - b.pct!);
  for (const row of weakRows) {
    const topics = input.topicsByKind[row.kind];
    if (!topics) continue;
    const t = weakestTopic(input.topicStats, topics);
    if (t) {
      return {
        kind: 'topic',
        subtestKind: row.kind,
        topic: t.topic,
        accuracy: Math.round((t.correct / t.answered) * 100),
      };
    }
  }
  if (input.deckDue > 0) return { kind: 'deck', due: input.deckDue };
  const sevenDays = 7 * DAY_MS;
  const noRecentMock = input.lastMockAt === null || input.now - input.lastMockAt > sevenDays;
  const objectiveAllKnown = objective.length > 0 && objective.every((r) => r.pct !== null);
  if (
    input.mockInstalled &&
    noRecentMock &&
    objectiveAllKnown &&
    objective.every((r) => r.pct! >= BORDERLINE_PCT)
  ) {
    return { kind: 'mock' };
  }
  const all = new Set<string>();
  for (const set of Object.values(input.topicsByKind)) for (const t of set ?? []) all.add(t);
  const any = weakestTopic(input.topicStats, all);
  if (any) {
    const kind = SUBTEST_ORDER.find((k) => input.topicsByKind[k]?.has(any.topic));
    if (kind) {
      return {
        kind: 'topic',
        subtestKind: kind,
        topic: any.topic,
        accuracy: Math.round((any.correct / any.answered) * 100),
      };
    }
  }
  const first = SUBTEST_ORDER.find((k) => (input.topicsByKind[k]?.size ?? 0) > 0);
  return first ? { kind: 'start', subtestKind: first } : null;
}
