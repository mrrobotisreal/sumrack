import type {
  ExamItem,
  ExamSubtest,
  SpeakingMonologueItem,
  SpeakingTurnItem,
} from '@sumrak/schema';

import { judgeAnswer, type JudgeResult } from '@/features/scenario/judge/judge';
import { contentTokens } from '@/features/scenario/judge/slots';
import { scoringTokens } from '@/features/pronunciation/scoring';

import type { ExamCriterion, SpeakingAnswer, SpeakingWordStamp } from '../model';
import { profileFor } from '../level-profile';
import { roundPct } from '../scoring';
import { bulletCoverage } from './writing';

/**
 * The offline (provisional) speaking grader (T73, TORFL_EXAM_PREP §6.2) —
 * PURE. Every speaking response is graded to a 0–100 rubric whose
 * criterion ids the AI prompt pins (Σ max = 100, like writing):
 *
 *   tasks 1–2 (reply / situation)        task-response 60 · completeness 20 · grammar 20 (AI)
 *   task 3 (monologue)                   coverage 40 · length 20 · fluency 10 · lexis-grammar 30 (AI)
 *
 * which is the design's 5-point scale ×20: judge `matched` → 3/5 (60),
 * near miss → 1.5/5 (30), else 0; a FULL answer (≥ `minTokens` content
 * tokens — «да / нет / не знаю» is not one) +1 (20); the AI's grammar /
 * appropriacy +1 (20) is pending offline. The monologue's offline parts are
 * cue coverage (20 of 50 → 40), the sentence estimate vs `minSentences`
 * (10 → 20) and fluency (5 → 10); lexis / grammar (15 → 30) is AI-only.
 *
 * The provisional percent RESCALES the offline-scorable points to 100
 * (80 for tasks 1–2, 70 for task 3 — the writing grader's 55 → 100 rule),
 * so the results card shows "how the machine-checkable parts went"; the AI
 * grade later supplies the full 100 through the kind-agnostic queue.
 *
 * Subtest weights (§6.2): task 1 = 25 %, task 2 = 25 %, task 3 = 50 % of
 * the subtest's `maxPoints`; `responseShare` splits each task's weight
 * equally over its items (a monologue pair = ONE slot: only the chosen
 * topic gets a response).
 *
 * THE JUDGE IS M17's `judgeAnswer`, UNCHANGED (decision 4). When a Whisper
 * assist transcript exists, both transcripts are judged and the better
 * verdict (then the higher paraphrase score) wins — ASR mis-hearings
 * should never cost a point the other recognizer would have given.
 */

export type SpeakingTask = 1 | 2 | 3;

export const SPEAKING_TURN_CRITERIA = [
  { id: 'task-response', max: 60, ru: 'Ответ по заданию', en: 'Task response' },
  { id: 'completeness', max: 20, ru: 'Полный ответ', en: 'Full answer' },
  { id: 'grammar', max: 20, ru: 'Грамматика и уместность', en: 'Grammar & appropriacy' },
] as const;

export const SPEAKING_MONOLOGUE_CRITERIA = [
  { id: 'coverage', max: 40, ru: 'Ответы на вопросы темы', en: 'Questions covered' },
  { id: 'length', max: 20, ru: 'Объём (предложений)', en: 'Length (sentences)' },
  { id: 'fluency', max: 10, ru: 'Беглость', en: 'Fluency' },
  { id: 'lexis-grammar', max: 30, ru: 'Лексика и грамматика', en: 'Lexis & grammar' },
] as const;

export const SPEAKING_AI_ONLY_IDS: readonly string[] = ['grammar', 'lexis-grammar'];
/** Σ max over the offline-scorable criteria. */
export const TURN_OFFLINE_MAX = 80;
export const MONOLOGUE_OFFLINE_MAX = 70;

/** §6.2 subtest weights per task. */
export const TASK_WEIGHT: Record<SpeakingTask, number> = { 1: 25, 2: 25, 3: 50 };

export function speakingCriteria(task: SpeakingTask) {
  return task === 3 ? SPEAKING_MONOLOGUE_CRITERIA : SPEAKING_TURN_CRITERIA;
}

export function speakingCriterionLabel(id: string): { ru: string; en: string } {
  const hit =
    SPEAKING_TURN_CRITERIA.find((c) => c.id === id) ??
    SPEAKING_MONOLOGUE_CRITERIA.find((c) => c.id === id);
  return hit ? { ru: hit.ru, en: hit.en } : { ru: id, en: id };
}

/** The official task number of a speaking item (by kind, never by part index). */
export function speakingTaskOf(item: Pick<ExamItem, 'kind'>): SpeakingTask | null {
  switch (item.kind) {
    case 'speaking-reply':
      return 1;
    case 'speaking-situation':
      return 2;
    case 'speaking-monologue':
      return 3;
    default:
      return null;
  }
}

export const TASK_LABEL: Record<SpeakingTask, { ru: string; en: string }> = {
  1: { ru: 'Задание 1 · ответы', en: 'Task 1 · replies' },
  2: { ru: 'Задание 2 · ситуации', en: 'Task 2 · situations' },
  3: { ru: 'Задание 3 · монолог', en: 'Task 3 · monologue' },
};

// --- shares -----------------------------------------------------------------------------------

/** The minimum a share computation needs: the items, grouped in parts. */
export interface SpeakingPartsLike {
  parts: readonly { items: readonly ExamItem[] }[];
  maxPoints: number;
}

/** Slots per task: items for tasks 1–2; distinct `group`s (or ungrouped items) for task 3. */
export function taskSlots(subtest: Pick<SpeakingPartsLike, 'parts'>): Record<SpeakingTask, number> {
  const slots: Record<SpeakingTask, number> = { 1: 0, 2: 0, 3: 0 };
  const groups = new Set<string>();
  for (const item of subtest.parts.flatMap((p) => p.items)) {
    const task = speakingTaskOf(item);
    if (task === null) continue;
    if (task === 3 && item.kind === 'speaking-monologue') {
      groups.add(item.group ?? `item:${item.id}`);
    } else slots[task] += 1;
  }
  slots[3] = groups.size;
  return slots;
}

/**
 * The points one response is worth inside the subtest: the task's weight
 * (renormalized over the tasks the subtest actually has) split equally
 * over the task's slots, in `maxPoints` units.
 */
export function responseShare(subtest: SpeakingPartsLike, item: Pick<ExamItem, 'kind'>): number {
  const task = speakingTaskOf(item);
  if (task === null) return 0;
  const slots = taskSlots(subtest);
  if (slots[task] === 0) return 0;
  const present = ([1, 2, 3] as SpeakingTask[]).filter((t) => slots[t] > 0);
  const total = present.reduce((n, t) => n + TASK_WEIGHT[t], 0);
  const taskPoints = (TASK_WEIGHT[task] / total) * subtest.maxPoints;
  return Math.round((taskPoints / slots[task]) * 1000) / 1000;
}

// --- transcript analysis -------------------------------------------------------------------------

/** A pause at least this long between two words ends a clause (§6.2; device-calibrated, recorded in the T73 row). */
export const PAUSE_CLAUSE_MS = 600;
/** The clause count may exceed the verb count by this much (an undetected verb is not a lost sentence). */
export const VERB_SLACK = 1;

/**
 * A1 verb stems (prefix match, ≤ 4 extra letters) + whole forms. Small and
 * explainable on purpose: it caps the pause-based estimate, nothing more.
 */
const VERB_STEMS = [
  'жив',
  'работа',
  'люб',
  'уч',
  'хоч',
  'хот',
  'мог',
  'мож',
  'зов',
  'нрав',
  'чита',
  'пиш',
  'писа',
  'говор',
  'слуша',
  'смотр',
  'гуля',
  'игра',
  'ход',
  'езж',
  'езд',
  'ед',
  'ид',
  'буд',
  'зна',
  'дума',
  'понима',
  'отдыха',
  'готов',
  'покупа',
  'дела',
  'помога',
  'встава',
  'встаю',
  'ложу',
  'сплю',
  'спи',
  'спа',
  'пь',
  'пи',
  'ем',
  'еш',
  'ест',
  'есть',
  'изуча',
  'занима',
  'стою',
  'сто',
  'сид',
  'лежу',
  'леж',
  'звон',
  'отвеча',
  'спрашива',
  'расскаж',
  'рассказыва',
  'приход',
  'приезжа',
  'бег',
  'плава',
  'танцу',
  'пою',
  'по',
  'рису',
  'путешеству',
  'жд',
  'вид',
  'слыш',
  'помн',
  'забыва',
  'забыл',
  'открыва',
  'закрыва',
  'начина',
  'конча',
  'заканчива',
  'прода',
  'плат',
  'сто',
  'дар',
  'получа',
  'отправля',
  'гото',
  'убира',
  'мою',
  'мо',
  'нос',
  'вожу',
  'вод',
  'лет',
];
/**
 * A2 additions (T76, TORFL_A2 §5.3): prefixed motion (при-/у-/вы-/по-/до-/за-/пере-/под-/в- + ход/езжа/ед/ид),
 * carrying (нес/нош/вез/вож), reflexives and the common A2 verbs. A DATA list — `A2_VERB_TEST_CORPUS`
 * in the tests is its proof set. Stems match as prefixes (≤ 4 extra letters) and a token must still end
 * like a verb, so nouns stay out (a test asserts a noun corpus is rejected).
 */
export const A2_VERB_STEMS: readonly string[] = [
  // past of prefixed motion / irregulars
  'приш',
  'ушл',
  'уш',
  'уех',
  'зашл',
  'заш',
  'дошл',
  'дош',
  'вышл',
  'выш',
  'нашл',
  'пошл',
  'перешл',
  'переех',
  'приех',
  'привезл',
  'вывезл',
  'встретил',
  'познакомил',
  'уста',
  'дал',
  'взял',
  'принесл',
  // prefixed motion
  'приход',
  'прихож',
  'приед',
  'приезжа',
  'прийд',
  'приду',
  'уход',
  'ухож',
  'уйд',
  'уйду',
  'уезжа',
  'уед',
  'выход',
  'выхож',
  'выйд',
  'выйду',
  'выезжа',
  'выед',
  'заход',
  'захож',
  'зайд',
  'зайду',
  'заезжа',
  'заед',
  'доход',
  'дойд',
  'доезжа',
  'доед',
  'переход',
  'перейд',
  'переезжа',
  'переед',
  'подход',
  'подойд',
  'вход',
  'войд',
  'пойд',
  'поед',
  'поех',
  // carrying / leading
  'принес',
  'принос',
  'принош',
  'привез',
  'привоз',
  'привож',
  'унес',
  'увез',
  'нес',
  'нош',
  'вез',
  'вож',
  'веду',
  'вел',
  // meeting, inviting, deciding, calling
  'встреч',
  'встрет',
  'пригласи',
  'приглаша',
  'предлож',
  'предлага',
  'реша',
  'реши',
  'решу',
  'звон',
  'позвон',
  'собира',
  'собер',
  // everyday A2 verbs
  'купи',
  'куплю',
  'продава',
  'отдыха',
  'отдохн',
  'устава',
  'болит',
  'болею',
  'лечи',
  'лечу',
  'выздоравл',
  'готовит',
  'приготов',
  'заказыв',
  'заказа',
  'принима',
  'бра',
  'бер',
  'взя',
  'дава',
  'даю',
  'дад',
  'сказа',
  'скаж',
  'объясн',
  'объясня',
  'спроси',
  'спраш',
  'проси',
  'прош',
  'найд',
  'наход',
  'нашл',
  'ищу',
  'ищет',
  'поним',
  'узна',
  'выуч',
  'повтор',
  'пробу',
  'стара',
  'мечта',
  'интересу',
  'увлека',
  'улыба',
  'смея',
  'плака',
  'радуе',
  'радую',
  'волну',
  'беспокои',
  'ссор',
  'помир',
  'полюб',
  'вырос',
  'расту',
  'поступ',
  'окончи',
  'закончи',
  'провод',
  'провел',
  'провёл',
  'проведу',
  'праздну',
  'поздравл',
  'подар',
  'дарю',
  'отмеча',
  'ожида',
  'надею',
  'верю',
  'пользу',
  'использу',
  'трати',
  'зараб',
  'платит',
  'стоит',
  'стоят',
  'требу',
  'получи',
  'получа',
  'послал',
  'пошл',
  'посыл',
  'напиш',
  'написа',
  'прочита',
  'прочт',
  'просмотр',
  'посмотр',
  'услыш',
  'послуша',
  'увид',
  'заметил',
  'вспомин',
  'вспомн',
  'забуд',
  'запомн',
  'запомин',
  'помог',
  'помога',
  'меша',
  'разреш',
  // reflexive-leaning (the `-ся` ending rule completes them)
  'встреча',
  'знакомл',
  'познаком',
  'собира',
  'чувству',
  'называ',
  'находи',
  'оказыва',
  'каже',
  'каж',
  'надо',
  'занима',
  'готови',
  'одева',
  'умыва',
  'купа',
  'моюс',
  'просыпа',
  'просып',
  'засып',
  'засыпа',
  'ложи',
  'ляг',
  'лёг',
  'лег',
  'сяд',
  'сад',
  'сид',
  'встава',
  'встан',
  'встаю',
];

const VERB_FORMS = new Set([
  'был',
  'была',
  'было',
  'были',
  'есть',
  'нет',
  'можно',
  'нельзя',
  'надо',
  'нужно',
  'зовут',
  'будет',
  'будут',
  'буду',
  'хочу',
  'хочешь',
  'хочет',
  'хотим',
  'хотите',
  'хотят',
  'могу',
  'можешь',
  'может',
  'можем',
  'можете',
  'могут',
  'нравится',
  'нравятся',
  'ем',
  'ешь',
  'ест',
  'едим',
  'едите',
  'едят',
  'иду',
  'идёшь',
  'идешь',
  'идёт',
  'идет',
  'идём',
  'идем',
  'идут',
  'еду',
  'едешь',
  'едет',
  'едем',
  'едут',
  'живу',
  'живёшь',
  'живешь',
  'живёт',
  'живет',
  'живём',
  'живем',
  'живут',
  'люблю',
  'любишь',
  'любит',
  'любим',
  'любите',
  'любят',
  'учусь',
  'учишься',
  'учится',
  'учимся',
  'учитесь',
  'учатся',
]);
const VERB_ENDINGS = [
  'ю',
  'ешь',
  'ет',
  'ем',
  'ете',
  'ют',
  'у',
  'ишь',
  'ит',
  'им',
  'ите',
  'ат',
  'ят',
];
const PAST_ENDINGS = ['л', 'ла', 'ло', 'ли', 'лся', 'лась', 'лось', 'лись'];

/** Heuristic: is this (normalized) token a verb form? Stems + whole forms + a conservative ending rule. */
export function looksLikeVerb(token: string): boolean {
  const t = token.replace('ё', 'е');
  if (VERB_FORMS.has(t)) return true;
  const stemHit =
    VERB_STEMS.some((s) => t.startsWith(s) && t.length - s.length <= 4 && t.length >= 3) ||
    A2_VERB_STEMS.some((s) => t.startsWith(s) && t.length - s.length <= 4 && t.length >= 3);
  if (!stemHit) return false;
  return (
    VERB_ENDINGS.some((e) => t.endsWith(e)) ||
    PAST_ENDINGS.some((e) => t.endsWith(e)) ||
    t.endsWith('ся') ||
    t.endsWith('сь') ||
    t.endsWith('ть')
  );
}

export function countVerbs(tokens: readonly string[]): number {
  return tokens.filter(looksLikeVerb).length;
}

export interface SentenceEstimate {
  /** The final estimate (≥ 1 when anything was said). */
  sentences: number;
  /** Clauses split at pauses ≥ `pauseMs`. */
  clauses: number;
  verbs: number;
  words: number;
  /** Speech span = last word end − first word start (ms). */
  speechMs: number;
  longestPauseMs: number;
  wpm: number;
}

/**
 * ASR has no punctuation (§6.2 risk): sentences ≈ clauses split at pauses
 * ≥ 600 ms between consecutive words, capped by the verb count (+ slack).
 * Stamps absent → the clause count falls back to the verb count alone.
 */
export function estimateSentences(
  transcript: string,
  stamps: readonly SpeakingWordStamp[] | undefined,
  opts: { pauseMs?: number } = {},
): SentenceEstimate {
  const pauseMs = opts.pauseMs ?? PAUSE_CLAUSE_MS;
  const tokens = scoringTokens(transcript);
  const verbs = countVerbs(tokens);
  const words = tokens.length;
  if (words === 0) {
    return { sentences: 0, clauses: 0, verbs: 0, words: 0, speechMs: 0, longestPauseMs: 0, wpm: 0 };
  }
  let clauses = 1;
  let longestPauseMs = 0;
  let speechMs = 0;
  if (stamps && stamps.length > 1) {
    const sorted = [...stamps].sort((a, b) => a.s - b.s);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i]!.s - sorted[i - 1]!.e;
      if (gap > longestPauseMs) longestPauseMs = gap;
      if (gap >= pauseMs) clauses += 1;
    }
    speechMs = Math.max(0, sorted[sorted.length - 1]!.e - sorted[0]!.s);
  } else if (stamps && stamps.length === 1) {
    speechMs = Math.max(0, stamps[0]!.e - stamps[0]!.s);
  }
  const cap = Math.max(1, verbs + VERB_SLACK);
  // Device finding (T73, S25): Zipformer stamps are CONTIGUOUS (each word's end = the next
  // word's start), so no pause is ever visible and `clauses` stays 1 — the verb count is then
  // the only signal. A pause-split only counts when the stamps actually show pauses.
  const sentences =
    stamps && stamps.length > 1 && clauses > 1 ? Math.min(clauses, cap) : Math.max(1, verbs);
  const wpm = speechMs > 0 ? Math.round((words / (speechMs / 60_000)) * 10) / 10 : 0;
  return { sentences, clauses, verbs, words, speechMs, longestPauseMs, wpm };
}

/** A1 fluency bands (recorded; tune once on the device walk). */
export const WPM_BANDS = { full: 70, good: 45, weak: 25 } as const;
export const PAUSE_BANDS_MS = { full: 2_000, half: 4_000 } as const;

/** 0..1 fluency share: 60 % words-per-minute band + 40 % longest-pause band. */
export function fluencyShare(
  est: Pick<SentenceEstimate, 'wpm' | 'longestPauseMs' | 'words'>,
  /** T76: the level profile's bands (A1 default = `WPM_BANDS`). */
  bands: { full: number; good: number; weak: number } = WPM_BANDS,
): number {
  if (est.words === 0) return 0;
  if (est.wpm === 0) return 0.5; // no stamps: neutral
  const wpmBand =
    est.wpm >= bands.full ? 1 : est.wpm >= bands.good ? 2 / 3 : est.wpm >= bands.weak ? 1 / 3 : 0;
  const pauseBand =
    est.longestPauseMs <= PAUSE_BANDS_MS.full
      ? 1
      : est.longestPauseMs <= PAUSE_BANDS_MS.half
        ? 0.5
        : 0;
  return 0.6 * wpmBand + 0.4 * pauseBand;
}

// --- the grades ----------------------------------------------------------------------------------

export interface OfflineTurnDetails {
  task: 1 | 2;
  verdict: JudgeResult['verdict'];
  nearMiss: boolean;
  judgeScore: number;
  /** Which transcript the judge preferred. */
  transcriptUsed: 'primary' | 'assist';
  contentTokens: number;
  minTokens: number;
  fullAnswer: boolean;
  /** The judge's per-slot hits (the debrief chips). */
  slots: Record<string, string | null>;
  target: string;
}

export interface OfflineMonologueDetails {
  task: 3;
  covered: number;
  total: number;
  coveredIdx: number[];
  missingIdx: number[];
  sentences: number;
  minSentences: number;
  clauses: number;
  verbs: number;
  words: number;
  speechMs: number;
  longestPauseMs: number;
  wpm: number;
  transcriptUsed: 'primary' | 'assist';
}

export type OfflineSpeakingDetails = OfflineTurnDetails | OfflineMonologueDetails;

export interface OfflineSpeakingGrade {
  task: SpeakingTask;
  criteria: ExamCriterion[];
  offlinePoints: number;
  offlineMax: number;
  /** `offlinePoints / offlineMax × 100`, one decimal. */
  pct: number;
  provisional: true;
  details: OfflineSpeakingDetails;
}

function half(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * The content-token count a FULL answer needs (recorded T73 deviation):
 * the item's `minTokens` (schema default 4) counted against the M17
 * stop-word list fails the fixture's own model answers — «Я сейчас в
 * Москве» is 2 content tokens — so the threshold is calibrated to the
 * model answer: `min(minTokens, contentTokens(accept[0]))`, never below 1.
 * «да» / «нет» / «не знаю» stay below it; «в Москве» (1) does too.
 */
export function fullAnswerThreshold(item: Pick<SpeakingTurnItem, 'expect' | 'minTokens'>): number {
  const model = contentTokens(scoringTokens(item.expect.accept[0] ?? '')).length;
  return Math.max(1, model > 0 ? Math.min(item.minTokens, model) : item.minTokens);
}

/** The better of two judge results: verdict first (matched > near-miss > miss), then score. */
function better(a: JudgeResult, b: JudgeResult): boolean {
  const rank = (r: JudgeResult) =>
    r.verdict === 'matched' ? 2 : r.nearMiss ? 1 : r.verdict === 'miss' ? 0 : -1;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb;
  return a.score > b.score;
}

/** Tasks 1–2: judge (unchanged M17) → 60/30/0, full answer → +20, grammar pending. */
export function gradeTurnOffline(
  item: Pick<SpeakingTurnItem, 'kind' | 'expect' | 'minTokens'>,
  answer: Pick<SpeakingAnswer, 'transcript' | 'assistTranscript'>,
): OfflineSpeakingGrade {
  const task: 1 | 2 = item.kind === 'speaking-reply' ? 1 : 2;
  const primary = judgeAnswer(answer.transcript, item.expect);
  let used: 'primary' | 'assist' = 'primary';
  let judge = primary;
  if (answer.assistTranscript && answer.assistTranscript.trim().length > 0) {
    const assist = judgeAnswer(answer.assistTranscript, item.expect);
    if (better(assist, primary)) {
      judge = assist;
      used = 'assist';
    }
  }
  const transcript = used === 'assist' ? answer.assistTranscript! : answer.transcript;
  const content = contentTokens(scoringTokens(transcript)).length;
  const responseMax = 60;
  const response = judge.verdict === 'matched' ? responseMax : judge.nearMiss ? responseMax / 2 : 0;
  const threshold = fullAnswerThreshold(item);
  const fullAnswer = judge.verdict !== 'no-speech' && content >= threshold;
  const completeness = fullAnswer ? 20 : 0;
  const criteria: ExamCriterion[] = [
    { id: 'task-response', score: response, max: 60 },
    { id: 'completeness', score: completeness, max: 20 },
  ];
  const offlinePoints = response + completeness;
  return {
    task,
    criteria,
    offlinePoints,
    offlineMax: TURN_OFFLINE_MAX,
    pct: roundPct((offlinePoints / TURN_OFFLINE_MAX) * 100),
    provisional: true,
    details: {
      task,
      verdict: judge.verdict,
      nearMiss: judge.nearMiss,
      judgeScore: judge.score,
      transcriptUsed: used,
      contentTokens: content,
      minTokens: threshold,
      fullAnswer,
      slots: judge.slots,
      target: judge.target,
    },
  };
}

/** Task 3: cue coverage (40) + sentence estimate (20) + fluency (10); lexis/grammar pending. */
export function gradeMonologueOffline(
  item: Pick<SpeakingMonologueItem, 'questions' | 'minSentences'>,
  answer: Pick<SpeakingAnswer, 'transcript' | 'assistTranscript' | 'words'>,
  opts: { pauseMs?: number; level?: string | null } = {},
): OfflineSpeakingGrade {
  const bullets = item.questions.map((q, i) => ({ id: `q${i}`, cues: q.cues }));
  const primaryCov = bulletCoverage(answer.transcript, bullets);
  let coverage = primaryCov;
  let used: 'primary' | 'assist' = 'primary';
  if (answer.assistTranscript && answer.assistTranscript.trim().length > 0) {
    const assistCov = bulletCoverage(answer.assistTranscript, bullets);
    if (assistCov.covered.length > primaryCov.covered.length) {
      coverage = assistCov;
      used = 'assist';
    }
  }
  const est = estimateSentences(answer.transcript, answer.words, opts);
  const empty = est.words === 0 && !(answer.assistTranscript ?? '').trim();
  const coverageScore = empty
    ? 0
    : coverage.total > 0
      ? half((coverage.covered.length / coverage.total) * 40)
      : 0;
  const lengthScore = empty
    ? 0
    : half(Math.min(1, est.sentences / Math.max(1, item.minSentences)) * 20);
  const fluencyScore = empty
    ? 0
    : half(fluencyShare(est, profileFor(opts.level).fluencyBands) * 10);
  const criteria: ExamCriterion[] = [
    { id: 'coverage', score: coverageScore, max: 40 },
    { id: 'length', score: lengthScore, max: 20 },
    { id: 'fluency', score: fluencyScore, max: 10 },
  ];
  const offlinePoints = coverageScore + lengthScore + fluencyScore;
  const idx = (ids: string[]) => ids.map((id) => Number(id.slice(1)));
  return {
    task: 3,
    criteria,
    offlinePoints,
    offlineMax: MONOLOGUE_OFFLINE_MAX,
    pct: roundPct((offlinePoints / MONOLOGUE_OFFLINE_MAX) * 100),
    provisional: true,
    details: {
      task: 3,
      covered: coverage.covered.length,
      total: coverage.total,
      coveredIdx: idx(coverage.covered),
      missingIdx: idx(coverage.missing),
      sentences: est.sentences,
      minSentences: item.minSentences,
      clauses: est.clauses,
      verbs: est.verbs,
      words: est.words,
      speechMs: est.speechMs,
      longestPauseMs: est.longestPauseMs,
      wpm: est.wpm,
      transcriptUsed: used,
    },
  };
}

/** Grade any speaking item offline; null for a non-speaking item. */
export function gradeSpeakingOffline(
  item: ExamItem,
  answer: SpeakingAnswer | undefined,
  opts: { pauseMs?: number; level?: string | null } = {},
): OfflineSpeakingGrade | null {
  const blank: SpeakingAnswer = {
    kind:
      item.kind === 'speaking-monologue'
        ? 'speaking-monologue'
        : item.kind === 'speaking-situation'
          ? 'speaking-situation'
          : 'speaking-reply',
    transcript: '',
    recordingPath: null,
    durationMs: 0,
  };
  const a = answer ?? blank;
  if (item.kind === 'speaking-reply' || item.kind === 'speaking-situation') {
    return gradeTurnOffline(item, a);
  }
  if (item.kind === 'speaking-monologue') return gradeMonologueOffline(item, a, opts);
  return null;
}

/** Response-row points of a provisional grade worth `share` points of the subtest. */
export function offlineSpeakingPoints(grade: OfflineSpeakingGrade, share: number): number {
  return Math.round((grade.pct / 100) * share * 10) / 10;
}

/**
 * The subtest's provisional result from the stored speaking answers (the
 * `computeFinish` path): Σ over answered items of pct × share; items with
 * no answer (skipped, the unchosen monologue) contribute 0.
 */
export function scoreSpeakingSubtest(
  subtest: ExamSubtest,
  answers: Record<string, { kind: string } & Partial<SpeakingAnswer>>,
  level?: string | null,
): { points: number; maxPoints: number; pct: number } {
  let points = 0;
  for (const item of subtest.parts.flatMap((p) => p.items)) {
    const task = speakingTaskOf(item);
    if (task === null) continue;
    const a = answers[item.id];
    if (!a || typeof a.transcript !== 'string') continue;
    const grade = gradeSpeakingOffline(item, a as SpeakingAnswer, { level });
    if (!grade) continue;
    points += offlineSpeakingPoints(grade, responseShare(subtest, item));
  }
  points = Math.round(points * 10) / 10;
  return {
    points,
    maxPoints: subtest.maxPoints,
    pct:
      subtest.maxPoints > 0
        ? Math.min(100, Math.max(0, roundPct((points / subtest.maxPoints) * 100)))
        : 0,
  };
}

/** The percent a full criteria set is worth (Σ score / Σ max). Shared with writing via the same formula. */
export function speakingCriteriaPercent(criteria: readonly ExamCriterion[]): number {
  const max = criteria.reduce((n, c) => n + c.max, 0);
  if (max <= 0) return 0;
  const score = criteria.reduce((n, c) => n + Math.min(c.max, Math.max(0, c.score)), 0);
  return Math.min(100, roundPct((score / max) * 100));
}
