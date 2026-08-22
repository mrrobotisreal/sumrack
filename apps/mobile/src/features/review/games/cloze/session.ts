import type { BankItemRow } from '@/db/repositories/bank';
import { MIXED_SESSION_DIRECTIONS, type CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';
import { foldForAnswer } from '@/lib/text';

import {
  buildReadIndex,
  pickSentenceForLemma,
  type ReadIndex,
  type SourcedSentence,
} from '../sentence-source';

export const CLOZE_SESSION_SIZE = 10;
export const CLOZE_TILE_COUNT = 4;

export type ClozeVariant = 'tiles' | 'typed';

export interface ClozeItem {
  card: CardRow;
  item: BankItemRow;
  source: SourcedSentence;
  variant: ClozeVariant;
  /** tiles variant only — CLOZE_TILE_COUNT display texts, pre-shuffled, lowercased. */
  tiles?: string[];
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
 * Build one cloze exercise for a card, or null when the card can't play:
 * cloze blanks a single token, so words with a lemma only (phrases can't),
 * and only when an eligible *read*-story sentence contains the lemma
 * (sentence-source rules — skipped, never loosened). `wantVariant: 'tiles'`
 * degrades to typed when the bank can't supply CLOZE_TILE_COUNT-1 distinct
 * distractor surfaces. Extracted in T14 so the daily session composes the
 * same generation the standalone game uses.
 */
export async function buildClozeItemForCard(
  repos: Repositories,
  card: CardRow,
  item: BankItemRow,
  index: ReadIndex,
  opts: { unseenAllowed?: boolean; wantVariant?: ClozeVariant } = {},
): Promise<ClozeItem | null> {
  const { unseenAllowed = false, wantVariant = 'typed' } = opts;
  if (item.kind !== 'word' || !item.lemma) return null;
  const source = await pickSentenceForLemma(repos, item.lemma, index, { unseenAllowed });
  if (!source) return null;
  const entry: ClozeItem = { card, item, source, variant: 'typed' };
  if (wantVariant === 'tiles') {
    const tiles = await buildClozeTiles(repos, entry);
    if (tiles) {
      entry.variant = 'tiles';
      entry.tiles = tiles;
    }
  }
  return entry;
}

/**
 * Build a cloze session (design §7.3 mode 3): word cards from the due queue
 * first (most-overdue order, T06 semantics), topped up with the weakest
 * not-yet-due cards so the standalone game is always playable — each with a
 * real sentence from a *read* story containing the lemma (sentence-source
 * rules; `unseenAllowed` mirrors the settings toggle). One exercise per bank
 * item per session. Items with no eligible sentence are skipped, never
 * loosened. Variants alternate tiles/typed on even/odd slots; a tile slot
 * falls back to typed when distractors run short (mirror of T06's
 * MC→flashcard fallback).
 */
export async function buildClozeSession(
  repos: Repositories,
  opts: { limit?: number; now?: number; unseenAllowed?: boolean } = {},
): Promise<ClozeItem[]> {
  const { limit = CLOZE_SESSION_SIZE, now = Date.now(), unseenAllowed = false } = opts;
  const index = await buildReadIndex(repos);

  // Due first, weakest fill after — both capped generously since many
  // candidates get skipped (phrases, lemma-less items, unsourceable ones).
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
  const session: ClozeItem[] = [];
  for (const card of pool) {
    if (session.length >= limit) break;
    if (seenItems.has(card.bankItemId)) continue;
    const item = itemById.get(card.bankItemId);
    if (!item) continue;
    seenItems.add(card.bankItemId);
    const entry = await buildClozeItemForCard(repos, card, item, index, {
      unseenAllowed,
      wantVariant: session.length % 2 === 0 ? 'tiles' : 'typed',
    });
    if (entry) session.push(entry);
  }
  return session;
}

/**
 * Distractor tiles via T06's tiered bank sampler (`findDistractors`:
 * POS+level → POS → level → kind → any). Tiles show *surface forms* — the
 * blank expects the sentence's inflected form, so distractor surfaces (also
 * as-encountered inflections) read plausibly. All tiles are lowercased so a
 * sentence-initial capital never gives the answer away.
 */
async function buildClozeTiles(repos: Repositories, entry: ClozeItem): Promise<string[] | null> {
  const answer = entry.source.tokens[entry.source.targetIndex]!.text;
  const answerTile = answer.toLocaleLowerCase('ru-RU');

  const candidates = await repos.bank.findDistractors(entry.item, (CLOZE_TILE_COUNT - 1) * 3);
  const seen = new Set([foldForAnswer(answer)]);
  const distractors: string[] = [];
  for (const candidate of candidates) {
    const text = candidate.surface.toLocaleLowerCase('ru-RU');
    const key = foldForAnswer(text);
    // The blank is one token — a multi-word (phrase) surface can't fill it.
    if (!text || text.includes(' ') || seen.has(key)) continue;
    seen.add(key);
    distractors.push(text);
    if (distractors.length === CLOZE_TILE_COUNT - 1) break;
  }
  if (distractors.length < CLOZE_TILE_COUNT - 1) return null;

  return shuffle([answerTile, ...distractors]);
}
