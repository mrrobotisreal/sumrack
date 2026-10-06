import type { WritingItem } from '@sumrak/schema';

import { matchesPattern, normalizeAnswer, roundPct, type ItemScore } from '../scoring';
import type { ExamCriterion } from '../model';

/**
 * The offline (provisional) writing grader (T72, TORFL_EXAM_PREP §6.2) —
 * PURE. Scores the three criteria a machine can judge without a model:
 *
 *   task-points  30  bullet points covered (cue stem globs over normalized tokens)
 *   task-length  15  sentences ≥ minSentences (10) + questions within [min, max] (5)
 *   letter-form  10  a greeting on the first line (5) + a sign-off near the end (5)
 *
 * …and leaves `vocabulary` (20) and `grammar` (25) to the AI rubric. The
 * 55 offline-scorable points are RESCALED to a provisional 0–100 % so the
 * results card can show a number straight after «Сдать»; the AI (or the
 * «Самопроверка» sheet) later supplies the full 100. Every number here is
 * deliberately simple and explainable — Mitch reads it as "what the
 * machine could check", never as the exam's opinion of his Russian.
 */

export const WRITING_CRITERIA = [
  { id: 'task-points', max: 30, ru: 'Задание: пункты', en: 'Task: points covered' },
  { id: 'task-length', max: 15, ru: 'Объём и вопросы', en: 'Length & questions' },
  { id: 'letter-form', max: 10, ru: 'Форма письма', en: 'Letter form' },
  { id: 'vocabulary', max: 20, ru: 'Лексика', en: 'Vocabulary' },
  { id: 'grammar', max: 25, ru: 'Грамматика', en: 'Grammar' },
] as const;
export type WritingCriterionId = (typeof WRITING_CRITERIA)[number]['id'];
export const WRITING_CRITERION_IDS = WRITING_CRITERIA.map((c) => c.id) as WritingCriterionId[];
export const OFFLINE_CRITERION_IDS: readonly WritingCriterionId[] = [
  'task-points',
  'task-length',
  'letter-form',
];
export const AI_ONLY_CRITERION_IDS: readonly WritingCriterionId[] = ['vocabulary', 'grammar'];
/** Σ max over the offline-scorable criteria (30 + 15 + 10). */
export const OFFLINE_MAX = 55;
/** Σ max over every criterion — the AI grade's denominator. */
export const WRITING_MAX = 100;

export function criterionMax(id: WritingCriterionId): number {
  return WRITING_CRITERIA.find((c) => c.id === id)!.max;
}

export function criterionLabel(id: string): { ru: string; en: string } {
  const hit = WRITING_CRITERIA.find((c) => c.id === id);
  return hit ? { ru: hit.ru, en: hit.en } : { ru: id, en: id };
}

// --- text analysis -----------------------------------------------------------------------

/** A sentence terminator run: `.`, `!`, `?`, `…`, `...` — any mix, any length. */
const TERMINATOR = /[.!?…]+/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

export interface SentenceSplit {
  /** Sentences with at least one letter/digit, in order, trimmed. */
  sentences: string[];
  /** Sentences whose terminator contains `?`. */
  questions: number;
}

/**
 * Split on `.!?…` runs (newlines also end a sentence when the line has no
 * terminator — people write greetings on their own line). A fragment with
 * no letter or digit is not a sentence; a terminator run containing «?» makes
 * its sentence a question («Как дела?!» counts once).
 */
export function sentenceSplit(text: string): SentenceSplit {
  const sentences: string[] = [];
  let questions = 0;
  for (const line of text.normalize('NFC').split(/\r?\n/)) {
    let last = 0;
    TERMINATOR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TERMINATOR.exec(line)) !== null) {
      const body = line.slice(last, m.index).trim();
      last = m.index + m[0].length;
      if (!HAS_WORD.test(body)) continue;
      sentences.push(body);
      if (m[0].includes('?')) questions += 1;
    }
    const tail = line.slice(last).trim();
    if (HAS_WORD.test(tail)) sentences.push(tail);
  }
  return { sentences, questions };
}

export function countQuestions(text: string): number {
  return sentenceSplit(text).questions;
}

/** The normalized word tokens of a letter (hyphenated words stay whole). */
export function letterTokens(text: string): string[] {
  const norm = normalizeAnswer(text);
  return norm.length === 0 ? [] : norm.split(' ');
}

export interface BulletCoverage {
  covered: string[];
  missing: string[];
  total: number;
}

/**
 * A bullet counts as covered when ANY of its cues matches: a one-word cue
 * matches a token (exact or trailing-`*` stem glob, via `matchesPattern`); a
 * multi-word cue matches the normalized text as a phrase (same glob rule on
 * its last word).
 */
export function bulletCoverage(
  text: string,
  bullets: readonly Pick<WritingItem['bullets'][number], 'id' | 'cues'>[],
): BulletCoverage {
  const tokens = letterTokens(text);
  const joined = ` ${tokens.join(' ')} `;
  const covered: string[] = [];
  const missing: string[] = [];
  for (const b of bullets) {
    const hit = b.cues.some((cue) => cueMatches(cue, tokens, joined));
    (hit ? covered : missing).push(b.id);
  }
  return { covered, missing, total: bullets.length };
}

function cueMatches(cue: string, tokens: readonly string[], joined: string): boolean {
  const trimmed = cue.trim();
  if (trimmed.length === 0) return false;
  const glob = trimmed.endsWith('*');
  const words = normalizeAnswer(glob ? trimmed.slice(0, -1) : trimmed)
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1) return tokens.some((t) => matchesPattern(trimmed, t));
  const phrase = ` ${words.join(' ')}`;
  if (!glob) return joined.includes(`${phrase} `);
  return joined.includes(phrase);
}

const GREETING =
  /^(здравствуй|привет|дорог|добрый\s+(день|вечер)|доброе\s+утро|уважаем|милая|милый)/u;
const SIGN_OFF =
  /(^|\s)(пока|до\s+свидания|до\s+встречи|до\s+скорого|твой|твоя|ваш|ваша|целую|обнимаю|с\s+уважением|с\s+любовью|жду\s+ответа|всего\s+доброго|всего\s+хорошего|будь\s+здоров)(\s|$)/u;
/** How far from the end (in normalized characters) a sign-off may sit. */
const SIGN_OFF_WINDOW = 160;

export interface LetterForm {
  greeting: boolean;
  signOff: boolean;
}

/**
 * Greeting = the first non-empty line starts with a greeting word; sign-off
 * = one of the farewell formulas appears in the last ~160 normalized
 * characters (the last two or three short lines of an A1 letter).
 */
export function letterForm(text: string): LetterForm {
  const lines = text
    .normalize('NFC')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const first = normalizeAnswer(lines[0] ?? '');
  const greeting = GREETING.test(first);
  const norm = normalizeAnswer(text);
  const tail = norm.slice(Math.max(0, norm.length - SIGN_OFF_WINDOW));
  const signOff = SIGN_OFF.test(tail);
  return { greeting, signOff };
}

// --- the grade -------------------------------------------------------------------------------

export interface OfflineWritingDetails {
  sentences: number;
  questions: number;
  pointsCovered: number;
  pointsTotal: number;
  coveredIds: string[];
  missingIds: string[];
  greeting: boolean;
  signOff: boolean;
  minSentences: number;
  minQuestions: number;
  maxQuestions: number | null;
}

export interface OfflineWritingGrade {
  criteria: ExamCriterion[];
  /** Σ over the three offline criteria (0–55). */
  offlinePoints: number;
  offlineMax: typeof OFFLINE_MAX;
  /** `offlinePoints / 55 × 100`, one decimal. */
  pct: number;
  provisional: true;
  details: OfflineWritingDetails;
}

/** Points-length share of `task-length` (the rest is the questions share). */
const LENGTH_POINTS = 10;
const QUESTIONS_POINTS = 5;

function half(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Grade a letter offline. Partial credit is linear and rounded to halves:
 * covered / total of the 30; `min(1, sentences / minSentences)` of the 10;
 * questions: full 5 inside [minQuestions, maxQuestions], proportional below,
 * 2.5 above the maximum (the exam wants questions, not a questionnaire);
 * greeting 5 + sign-off 5. An empty letter scores 0 everywhere.
 */
export function gradeWritingOffline(
  item: Pick<WritingItem, 'bullets' | 'minSentences' | 'minQuestions' | 'maxQuestions'>,
  text: string,
): OfflineWritingGrade {
  const split = sentenceSplit(text);
  const coverage = bulletCoverage(text, item.bullets);
  const form = letterForm(text);
  const empty = split.sentences.length === 0;

  const taskPoints = empty
    ? 0
    : coverage.total > 0
      ? half((coverage.covered.length / coverage.total) * criterionMax('task-points'))
      : 0;

  const lengthShare = empty
    ? 0
    : half(Math.min(1, split.sentences.length / Math.max(1, item.minSentences)) * LENGTH_POINTS);
  const minQ = item.minQuestions;
  const maxQ = item.maxQuestions ?? null;
  let questionShare: number;
  if (empty) questionShare = 0;
  else if (split.questions < minQ) {
    questionShare = minQ > 0 ? half((split.questions / minQ) * QUESTIONS_POINTS) : QUESTIONS_POINTS;
  } else if (maxQ !== null && split.questions > maxQ) questionShare = QUESTIONS_POINTS / 2;
  else questionShare = QUESTIONS_POINTS;

  const formPoints = empty ? 0 : (form.greeting ? 5 : 0) + (form.signOff ? 5 : 0);

  const criteria: ExamCriterion[] = [
    { id: 'task-points', score: taskPoints, max: criterionMax('task-points') },
    { id: 'task-length', score: lengthShare + questionShare, max: criterionMax('task-length') },
    { id: 'letter-form', score: formPoints, max: criterionMax('letter-form') },
  ];
  const offlinePoints = criteria.reduce((n, c) => n + c.score, 0);
  return {
    criteria,
    offlinePoints,
    offlineMax: OFFLINE_MAX,
    pct: roundPct((offlinePoints / OFFLINE_MAX) * 100),
    provisional: true,
    details: {
      sentences: split.sentences.length,
      questions: split.questions,
      pointsCovered: coverage.covered.length,
      pointsTotal: coverage.total,
      coveredIds: coverage.covered,
      missingIds: coverage.missing,
      greeting: form.greeting,
      signOff: form.signOff,
      minSentences: item.minSentences,
      minQuestions: item.minQuestions,
      maxQuestions: maxQ,
    },
  };
}

/** The response-row points of a provisional grade over a subtest worth `maxPoints` (100 in the official shape). */
export function offlineItemScore(grade: OfflineWritingGrade, maxPoints: number): ItemScore {
  return {
    points: Math.round((grade.pct / 100) * maxPoints * 10) / 10,
    maxPoints,
    outcome: grade.pct >= 100 ? 'full' : grade.pct > 0 ? 'half' : 'wrong',
  };
}

/**
 * The percent a full criteria set (AI or self: every id present, Σ max =
 * 100) is worth: Σ score / Σ max × 100, one decimal. Tolerates a partial
 * set by using its own Σ max as the denominator.
 */
export function criteriaPercent(criteria: readonly ExamCriterion[]): number {
  const max = criteria.reduce((n, c) => n + c.max, 0);
  if (max <= 0) return 0;
  const score = criteria.reduce((n, c) => n + Math.min(c.max, Math.max(0, c.score)), 0);
  return Math.min(100, roundPct((score / max) * 100));
}

// --- «Самопроверка» ------------------------------------------------------------------------------

/**
 * The four self-check questions Mitch answers against the model letter when
 * the AI never grades (§6.2 «Самопроверка»). They split the 45 AI-only
 * points: two under `vocabulary` (10 + 10), two under `grammar` (12 + 13).
 * Each answer is 0 / ½ / 1 of its points.
 */
export const SELF_CHECKS = [
  {
    id: 'vocab-range',
    criterion: 'vocabulary' as const,
    max: 10,
    ru: 'Слов хватило: я сказал всё, что хотел, без английского и пропусков',
    en: 'Enough words: I said everything I meant, no English, no gaps',
  },
  {
    id: 'vocab-fit',
    criterion: 'vocabulary' as const,
    max: 10,
    ru: 'Слова подходят: как в образце — простые, точные, по теме',
    en: 'Words fit: like the model letter — simple, precise, on topic',
  },
  {
    id: 'grammar-cases',
    criterion: 'grammar' as const,
    max: 12,
    ru: 'Падежи и согласование: окончания существительных и прилагательных как в образце',
    en: 'Cases & agreement: noun and adjective endings match the model',
  },
  {
    id: 'grammar-verbs',
    criterion: 'grammar' as const,
    max: 13,
    ru: 'Глаголы: формы, время и порядок слов как в образце',
    en: 'Verbs: forms, tense and word order match the model',
  },
] as const;
export type SelfCheckId = (typeof SELF_CHECKS)[number]['id'];
export type SelfCheckValue = 0 | 0.5 | 1;

/**
 * Fold the four answers into the two AI-only criteria and merge them with the
 * offline criteria into a full five-criterion set (Σ max = 100).
 */
export function selfCheckCriteria(
  offline: readonly ExamCriterion[],
  answers: Record<SelfCheckId, SelfCheckValue>,
): ExamCriterion[] {
  const byCriterion = new Map<WritingCriterionId, number>();
  for (const check of SELF_CHECKS) {
    const v = answers[check.id] ?? 0;
    byCriterion.set(check.criterion, (byCriterion.get(check.criterion) ?? 0) + v * check.max);
  }
  const out: ExamCriterion[] = [];
  for (const c of WRITING_CRITERIA) {
    if (AI_ONLY_CRITERION_IDS.includes(c.id)) {
      out.push({ id: c.id, score: half(byCriterion.get(c.id) ?? 0), max: c.max });
    } else {
      const off = offline.find((o) => o.id === c.id);
      out.push({ id: c.id, score: off?.score ?? 0, max: c.max });
    }
  }
  return out;
}
