import type { BankItemRow } from '@/db/repositories/bank';
import { type CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';
import { track } from '@/services/analytics';
import { foldForAnswer } from '@/lib/text';

import { resolveListeningAudio, spokenText, type ListeningAudio } from './audio-source';

export const LISTENING_SESSION_SIZE = 10;
export const LISTENING_CHOICE_COUNT = 4;

export type ListeningVariant = 'pick4' | 'typed';

export interface ListeningItem {
  card: CardRow;
  item: BankItemRow;
  audio: ListeningAudio;
  /** The Russian actually spoken — the answer key (ё/casing as in source). */
  answerRu: string;
  /** Gloss shown as post-answer feedback (null for unenriched captures). */
  translation: string | null;
  variant: ListeningVariant;
  /** pick4 only — LISTENING_CHOICE_COUNT display texts, pre-shuffled, lowercased. */
  choices?: string[];
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
 * Build one listening exercise for a card. Never fails: the audio resolver
 * always lands on a source (pack segment → TTS), and the variant degrades
 * pick4 → typed when the bank can't field enough distinct distractors
 * (T06's MC→flashcard fallback pattern). Phrase items are always typed —
 * one multi-word option among single-word distractors would give the
 * answer away before the audio finished.
 */
export async function buildListeningItemForCard(
  repos: Repositories,
  card: CardRow,
  item: BankItemRow,
  wantVariant: ListeningVariant,
): Promise<ListeningItem> {
  const audio = await resolveListeningAudio(repos, item);
  track('listening_audio_resolved', { source: audio.kind, itemKind: item.kind });
  const entry: ListeningItem = {
    card,
    item,
    audio,
    answerRu: spokenText(audio),
    translation: item.translation.trim() ? item.translation : null,
    variant: 'typed',
  };
  if (wantVariant === 'pick4' && item.kind === 'word') {
    const choices = await buildListeningChoices(repos, entry);
    if (choices) {
      entry.variant = 'pick4';
      entry.choices = choices;
    }
  }
  return entry;
}

/**
 * Distractor options via T06's tiered bank sampler (`findDistractors`).
 * Options show *surface forms* (as-encountered inflections, the cloze-tile
 * decision) so a stamped segment's inflected answer doesn't stand out among
 * dictionary forms. Lowercased; deduped through the tolerant fold so two
 * options never read (or sound) identical. null = not enough → typed.
 */
async function buildListeningChoices(
  repos: Repositories,
  entry: ListeningItem,
): Promise<string[] | null> {
  const answerOption = entry.answerRu.toLocaleLowerCase('ru-RU');
  const candidates = await repos.bank.findDistractors(entry.item, (LISTENING_CHOICE_COUNT - 1) * 3);
  const seen = new Set([foldForAnswer(answerOption)]);
  const distractors: string[] = [];
  for (const candidate of candidates) {
    const text = candidate.surface.toLocaleLowerCase('ru-RU');
    const key = foldForAnswer(text);
    if (!text || text.includes(' ') || seen.has(key)) continue;
    seen.add(key);
    distractors.push(text);
    if (distractors.length === LISTENING_CHOICE_COUNT - 1) break;
  }
  if (distractors.length < LISTENING_CHOICE_COUNT - 1) return null;
  return shuffle([answerOption, ...distractors]);
}

/**
 * Build the standalone listening session (design §7.3 mode 5): due
 * `listening` cards first (most-overdue, T06 semantics), topped up with the
 * weakest not-yet-due so the game is always playable from the games menu
 * (T13 pattern). Unenriched items stay in — the answer is the Russian side,
 * which always exists; a missing gloss only blanks the feedback subtitle.
 * Variants alternate pick4/typed on even/odd slots.
 */
export async function buildListeningSession(
  repos: Repositories,
  opts: { limit?: number; now?: number } = {},
): Promise<ListeningItem[]> {
  const { limit = LISTENING_SESSION_SIZE, now = Date.now() } = opts;

  const due = await repos.reviews.listDueCards({ now, limit, directions: ['listening'] });
  const weak = await repos.reviews.listWeakestCards({ now, limit, directions: ['listening'] });
  const pool = [...due, ...weak];

  const items = await repos.bank.getItemsByIds([...new Set(pool.map((c) => c.bankItemId))]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const seenItems = new Set<string>();
  const session: ListeningItem[] = [];
  for (const card of pool) {
    if (session.length >= limit) break;
    if (seenItems.has(card.bankItemId)) continue;
    const item = itemById.get(card.bankItemId);
    if (!item) continue;
    seenItems.add(card.bankItemId);
    const wantVariant: ListeningVariant = session.length % 2 === 0 ? 'pick4' : 'typed';
    session.push(await buildListeningItemForCard(repos, card, item, wantVariant));
  }
  return session;
}
