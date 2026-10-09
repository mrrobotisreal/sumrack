import { XP_TABLE } from '@/features/motivation/xp';
import {
  cardinal,
  formatAge,
  formatClock,
  formatDate,
  formatPrice,
  formatYear,
  type Currency,
} from '@/lib/ru-numbers';

/**
 * The numbers drill's pure engine (T34, V2 §7.5): tiers, the item generator,
 * answer checking, per-magnitude-band stats and the suggested tier. No DB,
 * no React. `rng` is injectable everywhere so generation is testable.
 *
 * Recorded decisions:
 * - Answers are compared as DIGIT STRINGS after stripping everything but
 *   digits (so «14:30», «1430» and «14.30» are the same answer; «05.03» and
 *   «5.3» are the same date). The canonical display keeps separators.
 * - Typed tiers: 2, 3, 4, 5 (numpad). Tier 1 (0–20) is pick-from-4 — the
 *   point at that level is recognising the word, not keyboard speed.
 *   Distractors are near-misses (±1, ±10, the teen/ty confusion 13 ↔ 30).
 * - Prices in tier 3 are roubles OR hryvnias (Mitch's Ukrainian context);
 *   kopecks appear on a third of prices; the typed answer is «12.50».
 * - Times use the `digital` clock reading (recorded in lib/ru-numbers).
 * - Dates are spoken without a year («пятое марта») and answered «5.3».
 */

export type NumbersTier = 1 | 2 | 3 | 4 | 5;
export const NUMBERS_TIERS: readonly NumbersTier[] = [1, 2, 3, 4, 5];

export type NumbersKind = 'number' | 'price' | 'time' | 'date' | 'year' | 'age';

/**
 * Magnitude bands for the persisted per-band accuracy (ticket: "stats per
 * magnitude band"). Plain numbers band by size; the formatted kinds are each
 * their own band (they are their own listening skill).
 */
export type NumbersBand =
  '0-20' | '21-100' | '101-1000' | '1001+' | 'price' | 'time' | 'date' | 'year' | 'age';

export const NUMBERS_BANDS: readonly NumbersBand[] = [
  '0-20',
  '21-100',
  '101-1000',
  '1001+',
  'price',
  'time',
  'date',
  'year',
  'age',
];

export const BAND_LABEL: Record<NumbersBand, string> = {
  '0-20': '0–20',
  '21-100': '21–100',
  '101-1000': '101–1000',
  '1001+': '1000+',
  price: 'Prices',
  time: 'Times',
  date: 'Dates',
  year: 'Years',
  age: 'Ages',
};

export const TIER_INFO: Record<NumbersTier, { title: string; subtitle: string }> = {
  1: { title: '0–20', subtitle: 'Pick what you hear' },
  2: { title: '0–100', subtitle: 'Type the digits' },
  3: { title: 'Up to 1000 + prices', subtitle: 'рубли · гривны · копейки' },
  4: { title: 'Years, dates, times', subtitle: '«пятое марта», «четырнадцать тридцать»' },
  5: { title: 'Ages + big numbers', subtitle: 'год / года / лет, up to a million' },
};

export type AnswerMode = 'choice' | 'typed';

export interface NumbersItem {
  /** Stable within a round (index-based). */
  id: string;
  kind: NumbersKind;
  band: NumbersBand;
  /** What TTS speaks — always words, never digits. NFC. */
  spoken: string;
  /** Canonical display answer («14:30», «12.50», «5.3», «1987»). */
  answer: string;
  /** How to answer this item. */
  mode: AnswerMode;
  /** Pick-from-4 options (display strings, shuffled, one is `answer`). */
  options?: string[];
  /** Typing hint shown under the numpad («hh:mm», «day.month», …). */
  hint?: string;
}

/** Items per round (ticket: 10-item rounds). */
export const ROUND_SIZE = 10;

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export function bandForNumber(n: number): NumbersBand {
  if (n <= 20) return '0-20';
  if (n <= 100) return '21-100';
  if (n <= 1000) return '101-1000';
  return '1001+';
}

/** Digits only — the comparison key for typed and picked answers. */
export function answerKey(text: string): string {
  return text.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
}

/** The numeric parts of an answer, raw: «05.03» → ['05','03']. */
function rawParts(text: string): string[] {
  return text.split(/\D+/).filter((p) => p !== '');
}

/**
 * Is the typed answer right? (recorded rule)
 * - dates («5.3») compare part by part, zero-stripped, any separator
 *   («05/03» = «5.3»);
 * - times and kopeck prices compare part by part too, but the minute /
 *   kopeck part must be TWO digits, as on a clock face or a price tag
 *   («9:05» ✓, «9.5» ✗ — it could mean 9:50; «12,50» ✓, «12.5» ✗);
 * - a time may also be typed without a separator («905», «1430») — a clock
 *   reading is unambiguous; a date or kopeck price may not («111» could be
 *   11.1 or 1.11; «1250» could be 1 250 roubles);
 * - single-part answers compare digit keys.
 */
export function isCorrectAnswer(
  item: Pick<NumbersItem, 'kind' | 'answer'>,
  typed: string,
): boolean {
  const want = rawParts(item.answer);
  const got = rawParts(typed);
  if (got.length === 0) return false;
  if (want.length > 1) {
    if (got.length === want.length) {
      const strictTail = item.kind !== 'date';
      return got.every((p, i) => {
        if (strictTail && i === got.length - 1 && p.length !== 2) return false;
        return Number(p) === Number(want[i]);
      });
    }
    return item.kind === 'time' && got.length === 1 && answerKey(typed) === answerKey(item.answer);
  }
  return answerKey(typed) === answerKey(item.answer);
}

/** Near-miss distractors for a pick-from-4 number (always distinct, ≥ 0). */
export function numberDistractors(n: number, rng: Rng, max = 20): number[] {
  const pool = new Set<number>();
  const teenTy: Record<number, number> = { 13: 30, 14: 40, 15: 50, 16: 60, 17: 70, 18: 80, 19: 90 };
  const candidates = [n - 1, n + 1, n + 2, n - 2, n + 10, n - 10, teenTy[n] ?? -1];
  for (const c of candidates) {
    if (c >= 0 && c <= Math.max(max, 90) && c !== n) pool.add(c);
  }
  const shuffled = [...pool].sort(() => rng() - 0.5);
  const out = shuffled.slice(0, 3);
  while (out.length < 3) {
    const c = randInt(rng, 0, max);
    if (c !== n && !out.includes(c)) out.push(c);
  }
  return out;
}

function shuffle<T>(xs: T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function numberItem(id: string, n: number, mode: AnswerMode, rng: Rng): NumbersItem {
  const item: NumbersItem = {
    id,
    kind: 'number',
    band: bandForNumber(n),
    spoken: cardinal(n),
    answer: String(n),
    mode,
  };
  if (mode === 'choice') {
    item.options = shuffle([String(n), ...numberDistractors(n, rng).map(String)], rng);
  }
  return item;
}

function priceItem(id: string, rng: Rng): NumbersItem {
  const currency: Currency = rng() < 0.5 ? 'rub' : 'uah';
  const whole = rng() < 0.5 ? randInt(rng, 1, 99) : randInt(rng, 100, 999);
  const kopecks = rng() < 1 / 3 ? randInt(rng, 1, 99) : 0;
  return {
    id,
    kind: 'price',
    band: 'price',
    spoken: formatPrice(whole, kopecks, currency),
    answer: kopecks > 0 ? `${whole}.${String(kopecks).padStart(2, '0')}` : String(whole),
    mode: 'typed',
    hint: kopecks > 0 ? 'whole.kopecks' : undefined,
  };
}

function timeItem(id: string, rng: Rng): NumbersItem {
  const h = randInt(rng, 0, 23);
  // Mostly round-ish minutes (how times are actually said), sometimes any.
  const m = rng() < 0.6 ? pick(rng, [0, 5, 10, 15, 20, 30, 40, 45, 50]) : randInt(rng, 0, 59);
  return {
    id,
    kind: 'time',
    band: 'time',
    spoken: formatClock(h, m),
    answer: `${h}:${String(m).padStart(2, '0')}`,
    mode: 'typed',
    hint: 'hours.minutes',
  };
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function dateItem(id: string, rng: Rng): NumbersItem {
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, MONTH_DAYS[month - 1]!);
  return {
    id,
    kind: 'date',
    band: 'date',
    spoken: formatDate(day, month),
    answer: `${day}.${month}`,
    mode: 'typed',
    hint: 'day.month',
  };
}

function yearItem(id: string, rng: Rng): NumbersItem {
  const year = randInt(rng, 1900, 2035);
  return {
    id,
    kind: 'year',
    band: 'year',
    spoken: formatYear(year),
    answer: String(year),
    mode: 'typed',
  };
}

function ageItem(id: string, rng: Rng): NumbersItem {
  // Bias toward the 1/2–4/5+ edges the ending depends on.
  const age =
    rng() < 0.5
      ? pick(rng, [1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 25, 31, 34, 41, 44, 51, 61, 71, 81, 91])
      : randInt(rng, 1, 99);
  return {
    id,
    kind: 'age',
    band: 'age',
    spoken: formatAge(age),
    answer: String(age),
    mode: 'typed',
  };
}

function largeNumber(rng: Rng): number {
  const shape = randInt(rng, 0, 3);
  if (shape === 0) return randInt(rng, 1001, 9999);
  if (shape === 1) return randInt(rng, 10, 99) * 1000 + (rng() < 0.5 ? 0 : randInt(rng, 1, 999));
  if (shape === 2) return randInt(rng, 100_000, 999_999);
  return rng() < 0.3 ? 1_000_000 : randInt(rng, 1, 9) * 100_000;
}

/** One item for a tier (the generator's single entry point). */
export function generateItem(
  tier: NumbersTier,
  index: number,
  rng: Rng = Math.random,
): NumbersItem {
  const id = `n${index}`;
  switch (tier) {
    case 1:
      return numberItem(id, randInt(rng, 0, 20), 'choice', rng);
    case 2:
      return numberItem(id, randInt(rng, 0, 100), 'typed', rng);
    case 3:
      return rng() < 0.4
        ? priceItem(id, rng)
        : numberItem(id, randInt(rng, 100, 1000), 'typed', rng);
    case 4: {
      const k = randInt(rng, 0, 2);
      return k === 0 ? yearItem(id, rng) : k === 1 ? dateItem(id, rng) : timeItem(id, rng);
    }
    case 5:
      return rng() < 0.5 ? ageItem(id, rng) : numberItem(id, largeNumber(rng), 'typed', rng);
  }
}

/** A full round; never two identical answers back to back. */
export function generateRound(
  tier: NumbersTier,
  rng: Rng = Math.random,
  size = ROUND_SIZE,
): NumbersItem[] {
  const items: NumbersItem[] = [];
  let guard = 0;
  while (items.length < size && guard < size * 20) {
    guard += 1;
    const item = generateItem(tier, items.length, rng);
    const prev = items[items.length - 1];
    if (prev && prev.answer === item.answer && prev.kind === item.kind) continue;
    items.push(item);
  }
  return items;
}

// --- results, band stats, suggested tier ----------------------------------

export interface NumbersAttempt {
  band: NumbersBand;
  kind: NumbersKind;
  correct: boolean;
  /** How many times the item was played (first play included). */
  plays: number;
}

export type BandTally = Partial<Record<NumbersBand, { seen: number; correct: number }>>;

/** Per-band tallies of one round (what `game_sessions.detail.bands` stores). */
export function tallyBands(attempts: readonly NumbersAttempt[]): BandTally {
  const out: BandTally = {};
  for (const a of attempts) {
    const t = out[a.band] ?? { seen: 0, correct: 0 };
    t.seen += 1;
    if (a.correct) t.correct += 1;
    out[a.band] = t;
  }
  return out;
}

/** Sum many rounds' tallies (the pure aggregator over game_sessions.detail). */
export function mergeBandTallies(tallies: readonly BandTally[]): BandTally {
  const out: BandTally = {};
  for (const tally of tallies) {
    for (const band of NUMBERS_BANDS) {
      const t = tally[band];
      if (!t) continue;
      const acc = out[band] ?? { seen: 0, correct: 0 };
      acc.seen += t.seen;
      acc.correct += t.correct;
      out[band] = acc;
    }
  }
  return out;
}

/** XP for a finished round (data table XP_TABLE.numbersRound): base + per correct. */
export function xpForNumbersRound(correct: number, total: number): number {
  if (total === 0) return 0;
  return XP_TABLE.numbersRound.base + XP_TABLE.numbersRound.perCorrect * correct;
}

export interface TierRound {
  tier: NumbersTier;
  correct: number;
  total: number;
}

/** Accuracy that counts as "this tier is comfortable" over the window. */
export const SUGGEST_PROMOTE_ACCURACY = 0.8;
/** Accuracy below which the tier is too hard and the suggestion steps down. */
export const SUGGEST_DEMOTE_ACCURACY = 0.5;
/** How many recent rounds of a tier the suggestion looks at. */
export const SUGGEST_WINDOW = 3;

/**
 * Suggested tier from recent rounds (newest first). Rule (recorded):
 * start from the most recently played tier; if its last ≤ 3 rounds average
 * ≥ 80 % → suggest the next tier up (cap 5); if they average < 50 % →
 * one down (floor 1); otherwise stay. No history → tier 1.
 */
export function suggestTier(recentNewestFirst: readonly TierRound[]): NumbersTier {
  const latest = recentNewestFirst[0];
  if (!latest) return 1;
  const sameTier = recentNewestFirst.filter((r) => r.tier === latest.tier).slice(0, SUGGEST_WINDOW);
  const total = sameTier.reduce((a, r) => a + r.total, 0);
  const correct = sameTier.reduce((a, r) => a + r.correct, 0);
  const acc = total > 0 ? correct / total : 0;
  if (acc >= SUGGEST_PROMOTE_ACCURACY) return Math.min(5, latest.tier + 1) as NumbersTier;
  if (acc < SUGGEST_DEMOTE_ACCURACY) return Math.max(1, latest.tier - 1) as NumbersTier;
  return latest.tier;
}
