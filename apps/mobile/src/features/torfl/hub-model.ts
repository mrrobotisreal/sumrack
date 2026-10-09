import {
  examStoryRefs,
  itemPoints,
  type Exam,
  type ExamRefField,
  type ExamSubtestKind,
} from '@sumrak/schema';

import { diffDayKeys, isDayKey } from '@/lib/dates';

import { ruleLine, torflLevelOf, type TorflLevel } from './level-profile';
import type { ExamMode, ExamResults, ExamVerdict } from './model';
import type { ReadinessBand } from './readiness';
import { compareTopics, SUBTEST_ORDER } from './topics';

/**
 * «ТРКИ» hub + shelf derivations (T69, TORFL_EXAM_PREP §5) — pure, no DB or
 * React, so the countdown, the exam rows, the topic tiles and the «Тексты»
 * grouping are unit-tested without a device. Screens read hooks and pass
 * their data through these functions; nothing re-derives elsewhere.
 */

// --- countdown ----------------------------------------------------------------

/**
 * Whole calendar days from `todayKey` to the exam date (both local
 * 'YYYY-MM-DD' day keys): 0 = the exam is today, negative = past. Day-key
 * arithmetic, so midnight and DST never shift the count (lib/dates).
 */
export function daysUntil(examDate: string, todayKey: string): number {
  return diffDayKeys(examDate, todayKey);
}

/** Russian plural picker: `ruPlural(n, ['день', 'дня', 'дней'])`. */
export function ruPlural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

const DAYS: readonly [string, string, string] = ['день', 'дня', 'дней'];

/** The countdown line on the hub card and the hub header. */
export function countdownLabel(examDate: string | null, todayKey: string): string {
  if (examDate === null || !isDayKey(examDate)) return 'Назначь дату экзамена';
  const n = daysUntil(examDate, todayKey);
  if (n === 0) return 'Экзамен сегодня';
  if (n === 1) return 'Экзамен завтра';
  if (n < 0) return 'Дата экзамена прошла';
  return `До экзамена: ${n} ${ruPlural(n, DAYS)}`;
}

/** `torfl_exam_date_set {daysOut}` — negative clamps to 0; cleared = -1. */
export function daysOutProp(examDate: string | null, todayKey: string): number {
  if (examDate === null) return -1;
  return Math.max(0, daysUntil(examDate, todayKey));
}

/** The SPbU rule in one line (§6.3, the hub header). */
export const SPBU_RULE_LINE = ruleLine('A1');

// --- readiness (placeholder shape; T70 fills it) -------------------------------

/**
 * One readiness row (§7.4): the shape the hub card and the hub section
 * render. T69 shipped `pct: null` placeholders; T70's `computeReadiness`
 * (`features/torfl/readiness.ts`) fills it with real numbers + bands.
 */
export interface ReadinessView {
  kind: ExamSubtestKind;
  pct: number | null;
  band: ReadinessBand | null;
  /** Source line («пробный экзамен 3 дн. назад» / «оценка по тренировкам»), or the empty-state hint. */
  label: string;
}

export function placeholderReadiness(): ReadinessView[] {
  return SUBTEST_ORDER.map((kind) => ({
    kind,
    pct: null,
    band: null,
    label: 'появится после первой тренировки',
  }));
}

// --- exam rows (Library «ТРКИ» shelf + hub mock cards) -------------------------

export interface ExamListItem {
  packId: string;
  examId: string;
  mode: ExamMode;
  titleRu: string;
  titleEn: string;
  /** Subtest kinds in exam order (the row's chips). */
  subtestKinds: ExamSubtestKind[];
  itemCount: number;
  /** Σ durationMin of every subtest. */
  totalMin: number;
  /** Best finished attempt, or null = «не пройден». */
  best: { pct: number; verdict: ExamVerdict | null } | null;
}

/** What the row builder needs of an exam summary (repos.exams.listExams). */
export interface ExamSummaryLike {
  packId: string;
  examId: string;
  mode: ExamMode;
  titleRu: string;
  titleEn: string;
  exam: Exam | null;
}

/** What the row builder needs of an attempt (repos.exams.listAttempts). */
export interface AttemptLike {
  packId: string;
  examId: string;
  status: string;
  results: ExamResults | null;
  verdict: ExamVerdict | null;
}

/** Overall % of an attempt's results: Σ points / Σ maxPoints × 100 (one decimal); null when empty. */
export function overallPct(results: ExamResults | null): number | null {
  if (!results) return null;
  let points = 0;
  let max = 0;
  for (const r of Object.values(results)) {
    points += r.points;
    max += r.maxPoints;
  }
  return max > 0 ? Math.round((points / max) * 1000) / 10 : null;
}

const VERDICT_RANK: Record<ExamVerdict, number> = { fail: 0, 'pass-borderline': 1, pass: 2 };

/**
 * Library / hub rows, one per exam with readable JSON (an unreadable row
 * already logged its `app_error` in the repo and is skipped). `best` =
 * the finished attempt with the best verdict, then the best overall %.
 */
export function buildExamListItems(
  summaries: readonly ExamSummaryLike[],
  attempts: readonly AttemptLike[],
): ExamListItem[] {
  const out: ExamListItem[] = [];
  for (const s of summaries) {
    if (!s.exam) continue;
    let best: ExamListItem['best'] = null;
    for (const a of attempts) {
      if (a.packId !== s.packId || a.examId !== s.examId || a.status !== 'finished') continue;
      const pct = overallPct(a.results);
      if (pct === null) continue;
      const candidate = { pct, verdict: a.verdict };
      const rank = (v: ExamVerdict | null) => (v === null ? -1 : VERDICT_RANK[v]);
      if (
        best === null ||
        rank(candidate.verdict) > rank(best.verdict) ||
        (rank(candidate.verdict) === rank(best.verdict) && candidate.pct > best.pct)
      ) {
        best = candidate;
      }
    }
    out.push({
      packId: s.packId,
      examId: s.examId,
      mode: s.mode,
      titleRu: s.titleRu,
      titleEn: s.titleEn,
      subtestKinds: s.exam.subtests.map((st) => st.kind),
      itemCount: s.exam.subtests.reduce(
        (n, st) => n + st.parts.reduce((m, p) => m + p.items.length, 0),
        0,
      ),
      totalMin: s.exam.subtests.reduce((n, st) => n + st.durationMin, 0),
      best,
    });
  }
  return out;
}

/** «2 ч 40 мин» / «40 мин» / «1 ч». */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/** The row's status line: best result or «не пройден». */
export function bestLabel(best: ExamListItem['best']): string {
  if (!best) return 'не пройден';
  const pct = `${best.pct.toLocaleString('ru-RU')} %`;
  if (best.verdict === 'pass') return `лучший: ${pct} · сдал`;
  if (best.verdict === 'pass-borderline') return `лучший: ${pct} · сдал (на грани)`;
  if (best.verdict === 'fail') return `лучший: ${pct} · не сдал`;
  return `лучший: ${pct}`;
}

export const MODE_LABELS: Record<ExamMode, string> = {
  mock: 'Пробный экзамен',
  drill: 'Тренировка',
};

// --- «Тренировки» topic tiles ---------------------------------------------------

export interface TopicTile {
  subtestKind: ExamSubtestKind;
  topic: string;
  itemCount: number;
  /** The drill exam holding the most items of this topic — the tile's intro target. */
  packId: string;
  examId: string;
}

/**
 * Topic tiles per subtest kind from DRILL exams: items grouped by `topic`
 * with counts. A topic spread over several drill exams points at the one
 * holding the most of its items (ties → the first in list order). Tiles in
 * §3.4 order, unknown topics last.
 */
export function buildTopicTiles(
  drills: readonly ExamSummaryLike[],
): Record<ExamSubtestKind, TopicTile[]> {
  // kind → topic → { total, per exam counts in first-seen order }
  const acc = new Map<
    string,
    { kind: ExamSubtestKind; topic: string; total: number; byExam: Map<string, number> }
  >();
  for (const s of drills) {
    if (!s.exam || s.mode !== 'drill') continue;
    const examKey = `${s.packId}\u0000${s.examId}`;
    for (const st of s.exam.subtests) {
      for (const part of st.parts) {
        for (const item of part.items) {
          const key = `${st.kind}\u0000${item.topic}`;
          let entry = acc.get(key);
          if (!entry) {
            entry = { kind: st.kind, topic: item.topic, total: 0, byExam: new Map() };
            acc.set(key, entry);
          }
          entry.total += 1;
          entry.byExam.set(examKey, (entry.byExam.get(examKey) ?? 0) + 1);
        }
      }
    }
  }
  const out = Object.fromEntries(SUBTEST_ORDER.map((k) => [k, [] as TopicTile[]])) as Record<
    ExamSubtestKind,
    TopicTile[]
  >;
  for (const entry of acc.values()) {
    let target = '';
    let targetCount = -1;
    for (const [examKey, n] of entry.byExam) {
      if (n > targetCount) {
        target = examKey;
        targetCount = n;
      }
    }
    const [packId = '', examId = ''] = target.split('\u0000');
    out[entry.kind].push({
      subtestKind: entry.kind,
      topic: entry.topic,
      itemCount: entry.total,
      packId,
      examId,
    });
  }
  for (const kind of SUBTEST_ORDER) out[kind].sort((a, b) => compareTopics(a.topic, b.topic));
  return out;
}

// --- «Тексты» ---------------------------------------------------------------------

export interface TextStoryLike {
  packId: string;
  id: string;
  orderIdx: number;
  titleRu: string;
  titleEn: string;
  sentenceCount: number;
}

export interface TextEntry {
  packId: string;
  storyId: string;
  titleRu: string;
  titleEn: string;
  sentenceCount: number;
  hasAudio: boolean;
  /** Every ref field that points at this story (passage / audio / prompt / model). */
  roles: ExamRefField[];
  /** T75 (THE LEVEL RULE): the level of the exam that references this story's pack. */
  level: TorflLevel;
}

export interface TextGroup {
  kind: ExamSubtestKind;
  texts: TextEntry[];
}

/**
 * Which subtest group a story belongs to (§5.3 «Тексты», ticket item 6):
 * the subtest of the FIRST item that references it, in exam order — so a
 * listening script goes under Аудирование, a passage under Чтение, an
 * examiner prompt or a monologue model under Говорение, a model letter
 * under Письмо. Stories no item references go under the subtest of their
 * pack's first exam (still listed: everything readable is reachable).
 */
export function groupTexts(
  exams: readonly ExamSummaryLike[],
  stories: readonly TextStoryLike[],
  audioStoryKeys: ReadonlySet<string>,
): TextGroup[] {
  const kindOf = new Map<string, ExamSubtestKind>();
  const rolesOf = new Map<string, Set<ExamRefField>>();
  const fallbackKindOfPack = new Map<string, ExamSubtestKind>();
  const levelOfPack = new Map<string, TorflLevel>();
  const examPackIds = new Set<string>();
  for (const s of exams) {
    if (!s.exam) continue;
    examPackIds.add(s.packId);
    if (!levelOfPack.has(s.packId)) levelOfPack.set(s.packId, torflLevelOf(s.exam.level));
    const first = s.exam.subtests[0];
    if (first && !fallbackKindOfPack.has(s.packId)) fallbackKindOfPack.set(s.packId, first.kind);
    const kindBySubtest = new Map(s.exam.subtests.map((st) => [st.id, st.kind]));
    for (const ref of examStoryRefs(s.exam)) {
      const key = `${s.packId}/${ref.ref.storyId}`;
      const kind = kindBySubtest.get(ref.subtestId);
      if (kind && !kindOf.has(key)) kindOf.set(key, kind);
      let roles = rolesOf.get(key);
      if (!roles) rolesOf.set(key, (roles = new Set()));
      roles.add(ref.field);
    }
  }
  const groups = new Map<ExamSubtestKind, TextEntry[]>();
  const ordered = [...stories]
    .filter((st) => examPackIds.has(st.packId))
    .sort((a, b) =>
      a.packId === b.packId ? a.orderIdx - b.orderIdx : a.packId < b.packId ? -1 : 1,
    );
  for (const st of ordered) {
    const key = `${st.packId}/${st.id}`;
    const kind = kindOf.get(key) ?? fallbackKindOfPack.get(st.packId);
    if (!kind) continue;
    const entries = groups.get(kind) ?? [];
    entries.push({
      packId: st.packId,
      storyId: st.id,
      titleRu: st.titleRu,
      titleEn: st.titleEn,
      sentenceCount: st.sentenceCount,
      hasAudio: audioStoryKeys.has(key),
      roles: [...(rolesOf.get(key) ?? [])],
      level: levelOfPack.get(st.packId) ?? 'A1',
    });
    groups.set(kind, entries);
  }
  return SUBTEST_ORDER.filter((k) => groups.has(k)).map((kind) => ({
    kind,
    texts: groups.get(kind)!,
  }));
}

// --- intro screen ------------------------------------------------------------------

export interface IntroSubtestRow {
  id: string;
  kind: ExamSubtestKind;
  titleRu: string;
  durationMin: number;
  itemCount: number;
  /** Objective subtests: Σ item points; writing/speaking: null (rubric %). */
  points: number | null;
  maxPoints: number;
  dictionary: boolean;
  audioPlays: number | null;
}

/** The intro's subtest table, in the exam's order (mocks are authored in the official order). */
export function introSubtestRows(exam: Exam): IntroSubtestRow[] {
  return exam.subtests.map((st) => {
    const items = st.parts.flatMap((p) => p.items);
    const objective = items.every((i) => i.kind === 'choice' || i.kind === 'typed');
    return {
      id: st.id,
      kind: st.kind,
      titleRu: st.title.ru,
      durationMin: st.durationMin,
      itemCount: items.length,
      points: objective ? items.reduce((n, i) => n + itemPoints(st, i), 0) : null,
      maxPoints: st.maxPoints,
      dictionary: st.dictionary,
      audioPlays: st.audioPlays ?? null,
    };
  });
}

/** A drill's topics with item counts, §3.4 order (the drill intro's list). */
export function examTopics(exam: Exam): { topic: string; itemCount: number }[] {
  const counts = new Map<string, number>();
  for (const st of exam.subtests) {
    for (const p of st.parts) {
      for (const i of p.items) counts.set(i.topic, (counts.get(i.topic) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([topic, itemCount]) => ({ topic, itemCount }))
    .sort((a, b) => compareTopics(a.topic, b.topic));
}

/**
 * The mock rules list (§1.3 decisions 8, 9; §8.2). Lookup is per-subtest,
 * so the dictionary line names exactly the subtests that allow it.
 */
export function mockRules(exam: Exam): string[] {
  const rules = [
    'Во время экзамена нет подсказок и проверки ответов — результат после сдачи.',
    'Таймер идёт с начала субтеста; когда время выходит, ответы сдаются автоматически.',
  ];
  if (exam.subtests.some((st) => st.kind === 'listening')) {
    const plays = exam.subtests.find((st) => st.kind === 'listening')?.audioPlays ?? 2;
    rules.push(
      `Аудирование: каждый текст звучит ${plays === 2 ? 'два раза' : `${plays} ${ruPlural(plays, ['раз', 'раза', 'раз'])}`}, без паузы и перемотки.`,
    );
  }
  const withDict = exam.subtests.filter((st) => st.dictionary).map((st) => st.title.ru);
  const without = exam.subtests.filter((st) => !st.dictionary).map((st) => st.title.ru);
  if (withDict.length > 0) rules.push(`Словарь (поиск слова) можно: ${withDict.join(', ')}.`);
  if (without.length > 0) rules.push(`Без словаря: ${without.join(', ')}.`);
  const monologue = exam.subtests.some(
    (st) =>
      st.kind === 'speaking' &&
      st.parts.some((p) => p.items.some((i) => i.kind === 'speaking-monologue')),
  );
  if (monologue) rules.push('Говорение, задание 3: словарь можно только во время подготовки.');
  return rules;
}
