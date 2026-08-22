import type { BankItemRow } from '@/db/repositories/bank';
import { MIXED_SESSION_DIRECTIONS, type CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';
import type { CardDirection } from '@/db/schema';

export type SessionMode = 'flashcard' | 'mc';

export interface McChoice {
  bankItemId: string;
  /** Display text: translation for ru-en, Russian headword for en-ru. */
  text: string;
  correct: boolean;
}

export interface SessionItem {
  card: CardRow;
  item: BankItemRow;
  direction: CardDirection;
  mode: SessionMode;
  /** MC only — MC_CHOICE_COUNT entries, pre-shuffled. */
  choices?: McChoice[];
}

export const SESSION_SIZE = 20;
export const MC_CHOICE_COUNT = 4;
/** Overfetch factor: due cards whose items lack a translation get skipped. */
const OVERFETCH = 2;

/** The side of a bank item each direction asks for vs. answers with. */
export function promptText(item: BankItemRow, direction: CardDirection): string {
  return direction === 'en-ru' ? item.translation : headword(item);
}

export function answerText(item: BankItemRow, direction: CardDirection): string {
  return direction === 'en-ru' ? headword(item) : item.translation;
}

export function headword(item: BankItemRow): string {
  return item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** One swap pass so the same bank item (two directions due) isn't back-to-back. */
function spreadSameItem(items: SessionItem[]): SessionItem[] {
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.item.id !== items[i - 1]!.item.id) continue;
    const j = items.findIndex((it, k) => k > i && it.item.id !== items[i]!.item.id);
    if (j > i) [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Build a mixed flashcard/MC session from the due queue (design §7.3).
 *
 * Selection: the `limit` most-overdue cards (due-order fairness — FSRS
 * already encodes priority in due dates); presentation order is then
 * shuffled. Cards whose bank item has no translation yet (needsEnrichment
 * captures) are skipped — they stay due and flow in once enriched (T16).
 *
 * Modes alternate ~50/50; an MC slot falls back to flashcard when the bank
 * can't supply MC_CHOICE_COUNT-1 distractors with distinct display texts
 * (tiny bank, or every candidate shares the answer's translation).
 */
export async function buildSession(
  repos: Repositories,
  opts: { limit?: number; now?: number } = {},
): Promise<SessionItem[]> {
  const { limit = SESSION_SIZE, now = Date.now() } = opts;

  const due = await repos.reviews.listDueCards({
    now,
    limit: limit * OVERFETCH,
    // T12: production cards are due to the pronunciation session, not here.
    directions: MIXED_SESSION_DIRECTIONS,
  });
  const items = await repos.bank.getItemsByIds([...new Set(due.map((c) => c.bankItemId))]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const usable: { card: CardRow; item: BankItemRow }[] = [];
  for (const card of due) {
    const item = itemById.get(card.bankItemId);
    if (!item || item.translation.trim().length === 0) continue;
    usable.push({ card, item });
    if (usable.length >= limit) break;
  }

  const ordered = spreadSameItem(
    shuffle(usable).map(({ card, item }) => ({
      card,
      item,
      direction: card.direction,
      mode: 'flashcard' as SessionMode,
    })),
  );

  // Even slots try MC; failed distractor lookups stay flashcards.
  for (let i = 0; i < ordered.length; i += 2) {
    const entry = ordered[i]!;
    const choices = await buildMcChoices(repos, entry.item, entry.direction);
    if (choices) {
      entry.mode = 'mc';
      entry.choices = choices;
    }
  }
  return ordered;
}

/** null = not enough usable distractors; play this card as a flashcard. */
async function buildMcChoices(
  repos: Repositories,
  item: BankItemRow,
  direction: CardDirection,
): Promise<McChoice[] | null> {
  const correctText = answerText(item, direction);
  // Overfetch: some candidates collide with the answer text (e.g. two words
  // both glossed "house") or with each other, and get deduped away.
  const candidates = await repos.bank.findDistractors(item, (MC_CHOICE_COUNT - 1) * 3);

  const seen = new Set([displayKey(correctText)]);
  const distractors: McChoice[] = [];
  for (const candidate of candidates) {
    const text = answerText(candidate, direction);
    const key = displayKey(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    distractors.push({ bankItemId: candidate.id, text, correct: false });
    if (distractors.length === MC_CHOICE_COUNT - 1) break;
  }
  if (distractors.length < MC_CHOICE_COUNT - 1) return null;

  return shuffle([{ bankItemId: item.id, text: correctText, correct: true }, ...distractors]);
}

function displayKey(text: string): string {
  return text.trim().toLowerCase();
}
