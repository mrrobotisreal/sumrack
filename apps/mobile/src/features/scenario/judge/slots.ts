import { normalizeRu } from '@/db/normalize';
import { allowedEdits, charDistance, wordsMatch } from '@/features/pronunciation/scoring';

/**
 * Slot primitives for the scenario judge (T60, SPEAKING_SCENARIOS §5.1):
 * stopwords, Russian numerals, and the form matcher (exact forms via the
 * T12 tolerant `wordsMatch`; trailing-`*` stem globs compare the stem
 * against the token's prefix with the T12 `allowedEdits` budget applied
 * to the STEM, so «голава» still hits «голов*»). Pure — no React, no DB.
 *
 * Everything here runs over already-normalized scoring tokens
 * (`scoringTokens`: NFC, lowercase, ё→е, punctuation stripped).
 */

/**
 * Stopwords never satisfy a `free` slot's `minTokens` (§5.1 — the design's
 * list plus fillers, pronoun/possessive forms and the ASR's usual hesitation
 * noises). «из» is deliberately NOT here — it carries "from" (scripts §0).
 */
export const STOP_RU: ReadonlySet<string> = new Set(
  [
    // the §5.1 list
    'я',
    'ты',
    'мы',
    'и',
    'а',
    'но',
    'да',
    'нет',
    'ну',
    'вот',
    'это',
    'в',
    'на',
    'у',
    'с',
    'к',
    'о',
    'же',
    'ли',
    'не',
    'что',
    'как',
    'так',
    'там',
    'тут',
    'очень',
    'пожалуйста',
    'спасибо',
    // pronouns + possessives (they never carry the answer)
    'он',
    'она',
    'оно',
    'они',
    'вы',
    'меня',
    'мне',
    'мной',
    'тебя',
    'тебе',
    'вас',
    'вам',
    'нас',
    'нам',
    'его',
    'ему',
    'ее',
    'ей',
    'их',
    'им',
    'мой',
    'моя',
    'мое',
    'мои',
    'твой',
    'твоя',
    'твое',
    'твои',
    'наш',
    'наша',
    'наше',
    'наши',
    'ваш',
    'ваша',
    'ваше',
    'ваши',
    'себя',
    'себе',
    // particles / conjunctions / prepositions
    'то',
    'бы',
    'уже',
    'еще',
    'тоже',
    'также',
    'здесь',
    'за',
    'от',
    'до',
    'по',
    'для',
    'об',
    'обо',
    'из-за',
    'при',
    'без',
    'или',
    'если',
    'ведь',
    'даже',
    'просто',
    'вообще',
    'типа',
    'значит',
    // fillers and hesitation noises the ASR tends to emit
    'э',
    'э-э',
    'ээ',
    'эм',
    'м',
    'мм',
    'м-м',
    'хм',
    'ой',
    'ах',
    'ох',
    'ага',
    'угу',
    'ладно',
    'окей',
    'ок',
    'кстати',
  ].map((w) => normalizeRu(w)),
);

/** Fillers that may precede a spoken command («пожалуйста, повтори», «ну, что значит…»). */
export const LEADING_FILLERS_RU: ReadonlySet<string> = new Set(
  [
    'ну',
    'а',
    'э',
    'э-э',
    'ээ',
    'эм',
    'вот',
    'пожалуйста',
    'извини',
    'извините',
    'простите',
    'ой',
    'так',
  ].map((w) => normalizeRu(w)),
);

export function isStopword(token: string): boolean {
  return STOP_RU.has(normalizeRu(token));
}

/** A token that can satisfy a `free` slot: not a stopword (numerals and names count). */
export function isContentToken(token: string): boolean {
  return token.length > 0 && !isStopword(token);
}

export function contentTokens(tokens: readonly string[]): string[] {
  return tokens.filter(isContentToken);
}

/**
 * Russian numerals 1–100 (§5.1): nominative units/teens/tens/«сто» plus the
 * oblique forms the ASR hears in «… лет / года» phrases. Compounds are two
 * tokens («двадцать пять») — each is in the map, so `hasNumeral` and
 * `parseRuNumber` both see them. Digits (`/^\d+$/`) count too.
 */
export const RU_NUMERALS: ReadonlyMap<string, number> = new Map<string, number>(
  (
    [
      ['ноль', 0],
      ['один', 1],
      ['одна', 1],
      ['одно', 1],
      ['одного', 1],
      ['одной', 1],
      ['раз', 1],
      ['два', 2],
      ['две', 2],
      ['двух', 2],
      ['три', 3],
      ['трех', 3],
      ['трёх', 3],
      ['четыре', 4],
      ['четырех', 4],
      ['четырёх', 4],
      ['пять', 5],
      ['пяти', 5],
      ['шесть', 6],
      ['шести', 6],
      ['семь', 7],
      ['семи', 7],
      ['восемь', 8],
      ['восьми', 8],
      ['девять', 9],
      ['девяти', 9],
      ['десять', 10],
      ['десяти', 10],
      ['одиннадцать', 11],
      ['двенадцать', 12],
      ['тринадцать', 13],
      ['четырнадцать', 14],
      ['пятнадцать', 15],
      ['шестнадцать', 16],
      ['семнадцать', 17],
      ['восемнадцать', 18],
      ['девятнадцать', 19],
      ['двадцать', 20],
      ['двадцати', 20],
      ['тридцать', 30],
      ['тридцати', 30],
      ['сорок', 40],
      ['сорока', 40],
      ['пятьдесят', 50],
      ['пятидесяти', 50],
      ['шестьдесят', 60],
      ['шестидесяти', 60],
      ['семьдесят', 70],
      ['семидесяти', 70],
      ['восемьдесят', 80],
      ['восьмидесяти', 80],
      ['девяносто', 90],
      ['девяноста', 90],
      ['сто', 100],
      ['ста', 100],
    ] as [string, number][]
  ).map(([w, n]) => [normalizeRu(w), n]),
);

const DIGITS = /^\d+$/;

/** Exact (ё/е-folded) numeral word or a digit string — never edit-tolerant («путь» must not read as «пять»). */
export function isNumeralToken(token: string): boolean {
  const t = normalizeRu(token);
  return DIGITS.test(t) || RU_NUMERALS.has(t);
}

export function hasNumeral(tokens: readonly string[]): boolean {
  return tokens.some(isNumeralToken);
}

/**
 * The value of the first numeral run in the tokens («двадцать пять лет» →
 * 25, «сто» → 100, «7» → 7), null when none. Consecutive numeral words are
 * summed while each is smaller than the previous (tens + units); anything
 * else starts a new number. Informational — slots only need presence.
 */
export function parseRuNumber(tokens: readonly string[]): number | null {
  let i = 0;
  while (i < tokens.length && !isNumeralToken(tokens[i]!)) i++;
  if (i >= tokens.length) return null;
  const first = normalizeRu(tokens[i]!);
  if (DIGITS.test(first)) return Number.parseInt(first, 10);
  let total = RU_NUMERALS.get(first)!;
  let prev = total;
  for (let j = i + 1; j < tokens.length; j++) {
    const t = normalizeRu(tokens[j]!);
    const v = RU_NUMERALS.get(t);
    if (v === undefined || DIGITS.test(t) || v >= prev || v === 0) break;
    total += v;
    prev = v;
  }
  return total;
}

// --- form matching ---------------------------------------------------------

/** A stem glob («голов*») compared against the token's prefix with the stem's edit budget. */
export function stemMatches(stem: string, token: string): boolean {
  if (stem.length === 0) return false;
  if (token.startsWith(stem)) return true;
  const budget = allowedEdits(stem.length);
  if (budget === 0) return false;
  // The token may be shorter than the stem by up to the budget («чит» vs «чита*»).
  if (token.length < stem.length - budget) return false;
  const prefix = token.slice(0, stem.length);
  return charDistance(stem, prefix) <= budget;
}

const NEGATION_PREFIX = 'не';

/**
 * The T12 edit budget was tuned for ASR misspellings, but two edits also
 * cover the negation prefix: «плохо» sits inside «неплохо»'s budget and
 * «давно» inside «недавно»'s — a wrong BRANCH, not a tolerance. When exactly
 * one side carries a leading «не» and the remainders match, the words are
 * opposites, never the same word. (Recorded T60 decision.)
 */
export function negationMismatch(a: string, b: string): boolean {
  const na = a.startsWith(NEGATION_PREFIX) && a.length > 4;
  const nb = b.startsWith(NEGATION_PREFIX) && b.length > 4;
  if (na === nb) return false;
  const ra = na ? a.slice(NEGATION_PREFIX.length) : a;
  const rb = nb ? b.slice(NEGATION_PREFIX.length) : b;
  return (
    ra === rb ||
    wordsMatch(ra, rb) ||
    (ra.length >= 3 && rb.startsWith(ra)) ||
    (rb.length >= 3 && ra.startsWith(rb))
  );
}

/** One authored form word (normalized) against one scoring token. */
export function formWordMatches(formWord: string, token: string): boolean {
  if (formWord.endsWith('*')) {
    const stem = formWord.slice(0, -1);
    return stemMatches(stem, token) && !negationMismatch(stem, token);
  }
  return wordsMatch(formWord, token) && !negationMismatch(formWord, token);
}

export interface FormHit {
  /** Index of the first token the form covered. */
  at: number;
  /** How many tokens the form spans (multi-word forms like «не очень»). */
  span: number;
  /** The form as authored (ё preserved). */
  form: string;
}

/**
 * Does an authored form (possibly multi-word, a trailing `*` on any word
 * making it a stem glob) occur as a consecutive run inside the tokens?
 * Returns the first hit, or null.
 */
export function matchForm(form: string, tokens: readonly string[]): FormHit | null {
  const words = normalizeRu(form)
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}*-]+|[^\p{L}\p{N}*-]+$/gu, ''))
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  for (let at = 0; at + words.length <= tokens.length; at++) {
    let ok = true;
    for (let k = 0; k < words.length; k++) {
      if (!formWordMatches(words[k]!, tokens[at + k]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return { at, span: words.length, form };
  }
  return null;
}

/**
 * Ranking of two hits: the longer token span wins («не люблю» beats «люблю»
 * — the longer authored form is the more specific claim); a tie keeps the
 * incumbent, i.e. the earlier form / earlier option. Authoring convention
 * (scripts file): catch-all options («elsewhere = из», «working = работаю»)
 * are listed LAST, so option order is the authors' priority signal.
 */
export function betterHit(candidate: FormHit, incumbent: FormHit | null): boolean {
  if (!incumbent) return true;
  return candidate.span > incumbent.span;
}

/** The best hit among several forms (see `betterHit`). Null when none hits. */
export function matchForms(forms: readonly string[], tokens: readonly string[]): FormHit | null {
  let best: FormHit | null = null;
  for (const form of forms) {
    const hit = matchForm(form, tokens);
    if (hit && betterHit(hit, best)) best = hit;
  }
  return best;
}

/** Index set of the tokens a set of forms covers (used to mask reject words out of `free` counting). */
export function coveredTokenIndexes(
  forms: readonly string[],
  tokens: readonly string[],
): Set<number> {
  const covered = new Set<number>();
  for (const form of forms) {
    const hit = matchForm(form, tokens);
    if (!hit) continue;
    for (let i = 0; i < hit.span; i++) covered.add(hit.at + i);
  }
  return covered;
}
