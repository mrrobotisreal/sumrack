import type { BankItemRow } from '@/db/repositories/bank';
import type { TokenRow } from '@/db/repositories/content';
import { MIXED_SESSION_DIRECTIONS, type CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';
import { answersMatch, foldForAnswer } from '@/lib/text';

import {
  buildReadIndex,
  pickSentenceForLemma,
  type CefrLevel,
  type ReadIndex,
  type SourcedSentence,
} from '../sentence-source';

export const SB_SESSION_SIZE = 10;

/**
 * Longest sentence served, in word tokens — more tiles than this stops
 * being a puzzle and starts being a chore (same spirit as T12's
 * MAX_PROMPT_WORDS for pronunciation).
 */
export const SB_MAX_WORDS = 10;

/**
 * T13 decision — distractor tiles scale with the *story's* CEFR level
 * (design §7.3: "distractor tiles at higher levels"): A1 gets a clean
 * reconstruction, the count ramps toward C1.
 */
export const SB_DISTRACTOR_COUNT: Record<CefrLevel, number> = {
  A1: 0,
  A2: 1,
  B1: 1,
  B2: 2,
  C1: 3,
};

export interface SbTile {
  /** Unique within the item (duplicate words are distinct tiles). */
  id: string;
  /** Display text, lowercased (capitalization would reveal the first word). */
  text: string;
  distractor: boolean;
}

export interface SbItem {
  card: CardRow;
  item: BankItemRow;
  source: SourcedSentence;
  /** Word tokens in canonical order — the answer key (punctuation auto-placed, never scored). */
  answerTokens: TokenRow[];
  /** Shuffled pool: every word token + level-scaled distractors. */
  tiles: SbTile[];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Positional check of an arrangement against the canonical word-token order,
 * tolerant per tile (ё/е, case) via the shared comparator — so duplicate
 * words are interchangeable and a distractor that happens to equal a correct
 * word counts at that slot.
 */
export function arrangementCorrect(chosen: string[], answer: string[]): boolean {
  if (chosen.length !== answer.length) return false;
  return chosen.every((text, i) => answersMatch(answer[i]!, text));
}

/**
 * Build one sentence-builder exercise for a card, or null when it can't
 * play: word items with a lemma only, needing an eligible read-story
 * sentence of 2–SB_MAX_WORDS words containing the lemma. Extracted in T14
 * so the daily session composes the same generation the standalone uses.
 */
export async function buildSbItemForCard(
  repos: Repositories,
  card: CardRow,
  item: BankItemRow,
  index: ReadIndex,
  opts: { unseenAllowed?: boolean } = {},
): Promise<SbItem | null> {
  const { unseenAllowed = false } = opts;
  if (item.kind !== 'word' || !item.lemma) return null;
  const source = await pickSentenceForLemma(repos, item.lemma, index, {
    unseenAllowed,
    maxWords: SB_MAX_WORDS,
  });
  if (!source) return null;
  // A one-word "sentence" reconstructs itself — nothing to build.
  const answerTokens = source.tokens.filter((t) => !t.isPunct);
  if (answerTokens.length < 2) return null;

  const distractors = await buildSbDistractors(repos, item, source, answerTokens);
  const tiles: SbTile[] = shuffle([
    ...answerTokens.map((t, i) => ({
      id: `w${i}`,
      text: t.text.toLocaleLowerCase('ru-RU'),
      distractor: false,
    })),
    ...distractors.map((text, i) => ({ id: `d${i}`, text, distractor: true })),
  ]);
  return { card, item, source, answerTokens, tiles };
}

/**
 * Build a sentence-builder session (design §7.3 mode 4): same card sourcing
 * as cloze (due first, weakest fill, word items only, one per bank item),
 * each with a read-story sentence of ≤ SB_MAX_WORDS words containing the
 * item's lemma. The English gloss is the prompt; tiles are the sentence's
 * word tokens plus SB_DISTRACTOR_COUNT[storyLevel] wrong tiles sampled from
 * the bank (never colliding with a real word of the sentence).
 */
export async function buildSbSession(
  repos: Repositories,
  opts: { limit?: number; now?: number; unseenAllowed?: boolean } = {},
): Promise<SbItem[]> {
  const { limit = SB_SESSION_SIZE, now = Date.now(), unseenAllowed = false } = opts;
  const index = await buildReadIndex(repos);

  const due = await repos.reviews.listDueCards({
    now,
    limit: limit * 3,
    directions: MIXED_SESSION_DIRECTIONS,
  });
  const weak = await repos.reviews.listWeakestCards({
    now,
    limit: limit * 3,
    directions: MIXED_SESSION_DIRECTIONS,
  });
  const pool = [...due, ...weak];

  const items = await repos.bank.getItemsByIds([...new Set(pool.map((c) => c.bankItemId))]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const seenItems = new Set<string>();
  const session: SbItem[] = [];
  for (const card of pool) {
    if (session.length >= limit) break;
    if (seenItems.has(card.bankItemId)) continue;
    const item = itemById.get(card.bankItemId);
    if (!item) continue;
    seenItems.add(card.bankItemId);
    const entry = await buildSbItemForCard(repos, card, item, index, { unseenAllowed });
    if (entry) session.push(entry);
  }
  return session;
}

async function buildSbDistractors(
  repos: Repositories,
  item: BankItemRow,
  source: SourcedSentence,
  answerTokens: TokenRow[],
): Promise<string[]> {
  const want = SB_DISTRACTOR_COUNT[source.storyLevel ?? 'A1'];
  if (want === 0) return [];

  const inSentence = new Set(answerTokens.map((t) => foldForAnswer(t.text)));
  const candidates = await repos.bank.findDistractors(item, want * 3);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const text = candidate.surface.toLocaleLowerCase('ru-RU');
    const key = foldForAnswer(text);
    // Multi-word surfaces can't be a single tile; sentence collisions would
    // make a "distractor" silently correct.
    if (!text || text.includes(' ') || inSentence.has(key) || seen.has(key)) continue;
    seen.add(key);
    picked.push(text);
    if (picked.length >= want) break;
  }
  return picked;
}
