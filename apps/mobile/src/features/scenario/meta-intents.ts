import { normalizeRu } from '@/db/normalize';
import { scoreAttempt, scoringTokens, wordsMatch } from '@/features/pronunciation/scoring';

import { isStopword, LEADING_FILLERS_RU, stemMatches } from './judge/slots';

/**
 * Meta-intents (T60, SPEAKING_SCENARIOS §6): the global spoken commands
 * («что значит…», «как сказать…», «повтори», «помедленнее», «я не
 * понимаю»), detected on every transcript BEFORE judging by scoring each
 * trigger phrase against the transcript's leading tokens
 * (`scoreAttempt(trigger, headTokens) ≥ META_TRIGGER_THRESHOLD`); the
 * remainder is the query. Pure — no React, no DB; the resolvers that need
 * the glossary / Whisper / online take injected lookups.
 *
 * Language-parameterized from day one: `ru` is filled, `uk` is empty (the
 * Сутінки UT tickets fill it) — an empty table detects nothing.
 *
 * Recorded T60 decisions:
 * - **One-token triggers («что?», «а?») must be the WHOLE transcript** —
 *   otherwise «что» would eat every real answer that starts with «что»
 *   (ticket risk note).
 * - **Leading fillers are skipped** («ну», «пожалуйста», «извините», «э-э»)
 *   so «пожалуйста, повтори» hits like «повтори».
 * - **`dont-understand` needs no query and swallows a trailing one** —
 *   «я не понимаю слово X» is `explain` (its trigger is longer and wins);
 *   the plain form with extra words after it stays `dont-understand`.
 * - **Every content word of the trigger must be heard.** The T12 scorer
 *   alone would let «я не» carry «я не понял» onto «я не знаю» (67) and a
 *   4-token trigger fire on a 3-token head; the stopwords may slip, the
 *   content words («понял», «значит», «сказать», «быстро») may not.
 */

export type MetaIntent = 'explain' | 'howtosay' | 'repeat' | 'slower' | 'dont-understand';
export type ScenarioLanguage = 'ru' | 'uk';

/** T27's number again: a clear majority of the trigger's words heard. */
export const META_TRIGGER_THRESHOLD = 60;

export interface MetaTrigger {
  intent: MetaIntent;
  /** Trigger phrase (authored spelling). */
  phrase: string;
  /** Whole-transcript triggers: a one-token command that must be the entire utterance. */
  whole?: boolean;
  /** Does the intent take a query (the remainder after the trigger)? */
  takesQuery: boolean;
}

export const META_TRIGGERS: Record<ScenarioLanguage, readonly MetaTrigger[]> = {
  ru: [
    // §6 rows, in the design's order. Longer/more specific phrases first
    // within an intent so «я не понимаю слово» beats «я не понимаю».
    { intent: 'explain', phrase: 'я не понимаю слово', takesQuery: true },
    { intent: 'explain', phrase: 'не понимаю слово', takesQuery: true },
    { intent: 'explain', phrase: 'не понял слово', takesQuery: true },
    { intent: 'explain', phrase: 'что означает', takesQuery: true },
    { intent: 'explain', phrase: 'что значит', takesQuery: true },
    { intent: 'explain', phrase: 'что такое', takesQuery: true },
    { intent: 'howtosay', phrase: 'как будет по-русски', takesQuery: true },
    { intent: 'howtosay', phrase: 'как это сказать', takesQuery: true },
    { intent: 'howtosay', phrase: 'как по-русски', takesQuery: true },
    { intent: 'howtosay', phrase: 'как сказать', takesQuery: true },
    { intent: 'repeat', phrase: 'повторите', takesQuery: false },
    { intent: 'repeat', phrase: 'повтори', takesQuery: false },
    { intent: 'repeat', phrase: 'ещё раз', takesQuery: false },
    { intent: 'repeat', phrase: 'что', whole: true, takesQuery: false },
    { intent: 'repeat', phrase: 'а', whole: true, takesQuery: false },
    { intent: 'slower', phrase: 'помедленнее', takesQuery: false },
    { intent: 'slower', phrase: 'медленнее', takesQuery: false },
    { intent: 'slower', phrase: 'не так быстро', takesQuery: false },
    { intent: 'dont-understand', phrase: 'я не понимаю', takesQuery: false },
    { intent: 'dont-understand', phrase: 'не понимаю', takesQuery: false },
    { intent: 'dont-understand', phrase: 'я не понял', takesQuery: false },
    { intent: 'dont-understand', phrase: 'я не поняла', takesQuery: false },
  ],
  uk: [],
};

export interface MetaDetection {
  intent: MetaIntent;
  /** The trigger that fired. */
  trigger: MetaTrigger;
  /** Trigger score against the head tokens (0–100). */
  score: number;
  /** Tokens after the trigger (normalized scoring tokens); empty for query-less intents. */
  queryTokens: string[];
  /** The query joined by spaces (what the resolvers and the debrief use). */
  query: string;
}

function triggerTokens(phrase: string): string[] {
  return scoringTokens(phrase);
}

/**
 * Detect a command at the head of the transcript. Returns null for a plain
 * answer. Among the triggers that fire, the LONGEST (most tokens) wins,
 * then the higher score, then table order.
 */
export function detectMetaIntent(
  transcript: string,
  language: ScenarioLanguage = 'ru',
): MetaDetection | null {
  const all = scoringTokens(transcript);
  if (all.length === 0) return null;
  // Skip leading fillers, but keep at least one token.
  let start = 0;
  while (start < all.length - 1 && LEADING_FILLERS_RU.has(all[start]!)) start++;
  const tokens = all.slice(start);

  let best: MetaDetection | null = null;
  for (const trigger of META_TRIGGERS[language]) {
    const tTokens = triggerTokens(trigger.phrase);
    if (tTokens.length === 0) continue;
    if (trigger.whole) {
      if (tokens.length === 1 && wordsMatch(tTokens[0]!, tokens[0]!)) {
        const cand: MetaDetection = {
          intent: trigger.intent,
          trigger,
          score: 100,
          queryTokens: [],
          query: '',
        };
        if (!best || better(cand, best)) best = cand;
      }
      continue;
    }
    // Head window = the trigger's length (a trigger may also be heard with one extra
    // token inside it — allow a window one longer only when the extra token is
    // absorbed by the scorer, i.e. the score still clears the bar).
    const windowLen = Math.min(tokens.length, tTokens.length);
    if (windowLen === 0) continue;
    const head = tokens.slice(0, windowLen).join(' ');
    const { score, words } = scoreAttempt(trigger.phrase, head);
    if (score < META_TRIGGER_THRESHOLD) continue;
    // The first trigger word must be heard at the head (avoids «…значит» tails matching)
    // and every content word of the trigger must be heard (stopwords may slip).
    if (!words[0]?.matched) continue;
    if (words.some((w) => !w.matched && !isStopword(w.target))) continue;
    const queryTokens = trigger.takesQuery ? tokens.slice(windowLen) : [];
    const cand: MetaDetection = {
      intent: trigger.intent,
      trigger,
      score,
      queryTokens,
      query: queryTokens.join(' '),
    };
    if (!best || better(cand, best)) best = cand;
  }
  return best;
}

function better(a: MetaDetection, b: MetaDetection): boolean {
  const la = triggerTokens(a.trigger.phrase).length;
  const lb = triggerTokens(b.trigger.phrase).length;
  if (la !== lb) return la > lb;
  return a.score > b.score;
}

// --- resolver inputs (pure lookups the executor wires to the repo / Whisper / online) ---

export interface GlossaryLookupEntry {
  id: string;
  ru: string;
  en: string;
  /** Recognizable RU surface forms / stem globs. */
  forms: readonly string[];
  /** Cyrillic garble renderings of `en`. */
  translit: readonly string[];
}

/** A host-line token the learner has already heard (played so far in this run). */
export interface PlayedToken {
  text: string;
  lemma?: string | null;
  translation?: string | null;
}

export type MetaSource = 'glossary' | 'whisper' | 'online' | 'none';

/**
 * «Что значит X?» over the glossary (§6): every query token against every
 * entry's `ru`/`forms` — exact (edit-tolerant) or stem glob. The entry
 * covering the most query tokens wins; ties → the earlier query token.
 */
export function findGlossaryByRu(
  queryTokens: readonly string[],
  glossary: readonly GlossaryLookupEntry[],
): GlossaryLookupEntry | null {
  let best: { entry: GlossaryLookupEntry; at: number } | null = null;
  for (let at = 0; at < queryTokens.length; at++) {
    const q = normalizeRu(queryTokens[at]!);
    for (const entry of glossary) {
      const hit =
        wordsMatch(normalizeRu(entry.ru), q) ||
        entry.forms.some((f) => {
          const n = normalizeRu(f);
          return n.endsWith('*') ? stemMatches(n.slice(0, -1), q) : wordsMatch(n, q);
        });
      if (hit && (!best || at < best.at)) best = { entry, at };
    }
    if (best) break;
  }
  return best?.entry ?? null;
}

/** «Что значит X?» over the tokens of host lines already played (their pack `translation`). */
export function findPlayedToken(
  queryTokens: readonly string[],
  played: readonly PlayedToken[],
): PlayedToken | null {
  for (const q of queryTokens) {
    const n = normalizeRu(q);
    for (const t of played) {
      if (!t.translation) continue;
      const surface = normalizeRu(t.text);
      const lemma = t.lemma ? normalizeRu(t.lemma) : null;
      if (wordsMatch(surface, n) || (lemma !== null && wordsMatch(lemma, n))) return t;
    }
  }
  return null;
}

export interface TranslitHit {
  entry: GlossaryLookupEntry;
  /** Similarity 0–100 of the best translit candidate to the query. */
  score: number;
  candidate: string;
}

/** Character-level similarity 0–100 (1 − distance / maxLen), the tolerant part of translit matching. */
export function similarity(a: string, b: string): number {
  if (a === b) return 100;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 100;
  return Math.round(100 * (1 - charDistanceLocal(a, b) / max));
}

function charDistanceLocal(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[n]!;
}

/** Minimum similarity for a translit garble to count as a hit (tolerant, but not a coin flip). */
export const TRANSLIT_MIN_SIMILARITY = 70;

/**
 * «Как сказать X?»: the query garble (what the RU zipformer heard for an
 * English word) against every entry's `translit` candidates — whole query
 * first, then the query's tail windows (the ASR may prefix noise), each
 * compared by character similarity with the T12 spirit (stem-ish: a
 * candidate that is a prefix of the query, or vice versa, also counts).
 */
export function findGlossaryByTranslit(
  queryTokens: readonly string[],
  glossary: readonly GlossaryLookupEntry[],
): TranslitHit | null {
  if (queryTokens.length === 0) return null;
  const joined = queryTokens.map(normalizeRu).join(' ');
  const windows = new Set<string>([joined]);
  for (let i = 1; i < queryTokens.length; i++)
    windows.add(queryTokens.slice(i).map(normalizeRu).join(' '));
  for (let i = 0; i < queryTokens.length; i++) windows.add(normalizeRu(queryTokens[i]!));
  const compact = [...windows].map((w) => w.replace(/[\s-]/g, ''));

  let best: TranslitHit | null = null;
  for (const entry of glossary) {
    for (const raw of entry.translit) {
      const cand = normalizeRu(raw).replace(/[\s-]/g, '');
      if (cand.length === 0) continue;
      for (const w of compact) {
        if (w.length === 0) continue;
        let s = similarity(cand, w);
        // Stem-ish: one is a prefix of the other and the shorter is ≥ 3 chars.
        const shorter = Math.min(cand.length, w.length);
        if (shorter >= 3 && (cand.startsWith(w) || w.startsWith(cand))) {
          s = Math.max(s, Math.round(100 * (shorter / Math.max(cand.length, w.length))) + 20);
        }
        if (s >= TRANSLIT_MIN_SIMILARITY && (!best || s > best.score)) {
          best = { entry, score: Math.min(100, s), candidate: raw };
        }
      }
    }
  }
  return best;
}

/**
 * The Whisper tail (§6, ticket risk note): the trigger is Russian and
 * Whisper is forced to English, so the RU part comes out as noise; take
 * the last 1–3 alphabetic English tokens as the query.
 */
export function englishTail(whisperText: string, max = 3): string[] {
  const words = whisperText
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length > 0);
  return words.slice(-max);
}

const STOP_EN = new Set([
  'to',
  'a',
  'an',
  'the',
  'how',
  'say',
  'do',
  'you',
  'in',
  'russian',
  'is',
  'it',
]);

/** The English content words of a Whisper tail (function words dropped; the tail itself when nothing is left). */
export function englishQuery(enWords: readonly string[]): string[] {
  const content = enWords.map((w) => w.toLowerCase()).filter((w) => !STOP_EN.has(w));
  return content.length > 0 ? content : [...enWords];
}

/** Match English words (from Whisper) against `en` tolerantly (word-level, edit-tolerant, any word of a multi-word `en`). */
export function findGlossaryByEnglish(
  enWords: readonly string[],
  glossary: readonly GlossaryLookupEntry[],
): GlossaryLookupEntry | null {
  const queries = enWords.map((w) => w.toLowerCase()).filter((w) => !STOP_EN.has(w));
  let best: { entry: GlossaryLookupEntry; score: number } | null = null;
  for (const entry of glossary) {
    const enTokens = entry.en
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .filter((w) => w.length > 0 && !STOP_EN.has(w));
    for (const q of queries) {
      for (const t of enTokens) {
        const s = similarity(t, q);
        if (s >= TRANSLIT_MIN_SIMILARITY && (!best || s > best.score)) best = { entry, score: s };
      }
    }
  }
  return best?.entry ?? null;
}

// --- resolution (what the executor plays) -----------------------------------

export type MetaResolution =
  | {
      intent: 'explain';
      source: 'glossary';
      entryId: string;
      sentenceId: string;
      ru: string;
      en: string;
    }
  | { intent: 'explain'; source: 'played'; ru: string; en: string }
  | { intent: 'explain'; source: 'online'; ru: string; en: string; line: string }
  | { intent: 'explain'; source: 'none' }
  | {
      intent: 'howtosay';
      source: 'glossary' | 'whisper';
      entryId: string;
      sentenceId: string;
      ru: string;
      en: string;
    }
  | { intent: 'howtosay'; source: 'online'; ru: string }
  | { intent: 'howtosay'; source: 'none' }
  | { intent: 'repeat' }
  | { intent: 'slower' }
  | { intent: 'dont-understand' };

/** The rate and mouth-track scale «помедленнее» uses (§6). */
export const SLOWER_RATE = 0.8;
export const SLOWER_MOUTH_SCALE = 1.25;

export interface ExplainResolverDeps {
  glossary: readonly GlossaryLookupEntry[];
  /** id → the `explain` clip's sentence id. */
  explainSentenceId: (entryId: string) => string | null;
  played: readonly PlayedToken[];
  /** Online one-liner («„X“ — это Y»), null when offline / no key / failed. */
  online?: (query: string) => Promise<string | null>;
}

export async function resolveExplain(
  detection: MetaDetection,
  deps: ExplainResolverDeps,
): Promise<Extract<MetaResolution, { intent: 'explain' }>> {
  if (detection.queryTokens.length === 0) return { intent: 'explain', source: 'none' };
  const entry = findGlossaryByRu(detection.queryTokens, deps.glossary);
  if (entry) {
    const sentenceId = deps.explainSentenceId(entry.id);
    if (sentenceId) {
      return {
        intent: 'explain',
        source: 'glossary',
        entryId: entry.id,
        sentenceId,
        ru: entry.ru,
        en: entry.en,
      };
    }
    return { intent: 'explain', source: 'played', ru: entry.ru, en: entry.en };
  }
  const played = findPlayedToken(detection.queryTokens, deps.played);
  if (played?.translation) {
    return {
      intent: 'explain',
      source: 'played',
      ru: played.lemma ?? played.text,
      en: played.translation,
    };
  }
  if (deps.online) {
    const line = await deps.online(detection.query).catch(() => null);
    if (line) return { intent: 'explain', source: 'online', ru: detection.query, en: line, line };
  }
  return { intent: 'explain', source: 'none' };
}

export interface HowToSayResolverDeps {
  glossary: readonly GlossaryLookupEntry[];
  howToSaySentenceId: (entryId: string) => string | null;
  /** Whisper re-decode of the same WAV as English, null when the assist model is absent / failed. */
  whisper?: () => Promise<string | null>;
  /** Online translation spoken by the суфлёр, null when offline / no key / failed. */
  online?: (queryEnglishOrGarble: string) => Promise<string | null>;
}

export async function resolveHowToSay(
  detection: MetaDetection,
  deps: HowToSayResolverDeps,
): Promise<Extract<MetaResolution, { intent: 'howtosay' }>> {
  const hit = findGlossaryByTranslit(detection.queryTokens, deps.glossary);
  if (hit) {
    const sentenceId = deps.howToSaySentenceId(hit.entry.id);
    if (sentenceId) {
      return {
        intent: 'howtosay',
        source: 'glossary',
        entryId: hit.entry.id,
        sentenceId,
        ru: hit.entry.ru,
        en: hit.entry.en,
      };
    }
  }
  let english: string[] = [];
  if (deps.whisper) {
    const text = await deps.whisper().catch(() => null);
    if (text) {
      // The Russian ASR already told us how long the query is (the tokens after
      // the trigger); Whisper's head is the trigger garbled into English
      // («Kex Gazette Mirror» for «как сказать mirror»), so keep only that many
      // words from the tail. Never fewer than one (the ASR may have dropped
      // the English word entirely), never more than three (T60's cap).
      english = englishTail(text, Math.max(1, Math.min(3, detection.queryTokens.length)));
      const entry = findGlossaryByEnglish(english, deps.glossary);
      if (entry) {
        const sentenceId = deps.howToSaySentenceId(entry.id);
        if (sentenceId) {
          return {
            intent: 'howtosay',
            source: 'whisper',
            entryId: entry.id,
            sentenceId,
            ru: entry.ru,
            en: entry.en,
          };
        }
      }
    }
  }
  if (deps.online) {
    const query = english.length > 0 ? englishQuery(english).join(' ') : detection.query;
    if (query.length > 0) {
      const ru = await deps.online(query).catch(() => null);
      if (ru) return { intent: 'howtosay', source: 'online', ru };
    }
  }
  return { intent: 'howtosay', source: 'none' };
}
