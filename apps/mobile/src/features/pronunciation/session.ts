import type { BankItemRow } from '@/db/repositories/bank';
import type { CardRow } from '@/db/repositories/reviews';
import type { Repositories } from '@/db/repositories';

import { scoringTokens } from './scoring';

/** The ticket's standalone session: 10 phrases, launchable from Today. */
export const PRON_SESSION_SIZE = 10;

/**
 * Longest sentence prompt served, in words. Reading a paragraph aloud is a
 * fluency exercise; scoring one against ASR at A1 is a wall of red. Longer
 * source sentences fall back to the word itself.
 */
export const MAX_PROMPT_WORDS = 9;

export type PromptSource = 'phrase' | 'sentence' | 'word';

export interface PronunciationItem {
  card: CardRow;
  item: BankItemRow;
  /** What Mitch is asked to say (original text, ё/casing preserved). */
  promptRu: string;
  /** English gloss shown under the prompt (null when unavailable). */
  promptEn: string | null;
  source: PromptSource;
}

/**
 * Build the pronunciation session from due `production` cards, most-overdue
 * first (design §7.3 mode 6). Prompt per item:
 *
 * - phrase items → the phrase itself (that IS the exercise);
 * - word items with a story source sentence of ≤ MAX_PROMPT_WORDS → the
 *   sentence (producing words in context beats isolated words);
 * - otherwise → the word (lemma) alone.
 *
 * Unlike MC, needsEnrichment items stay in: the prompt is the Russian side,
 * which always exists — a missing gloss only blanks the subtitle.
 */
export async function buildPronunciationSession(
  repos: Repositories,
  opts: { limit?: number; now?: number } = {},
): Promise<PronunciationItem[]> {
  const { limit = PRON_SESSION_SIZE, now = Date.now() } = opts;

  const due = await repos.reviews.listDueCards({ now, limit, directions: ['production'] });
  const items = await repos.bank.getItemsByIds([...new Set(due.map((c) => c.bankItemId))]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const session: PronunciationItem[] = [];
  for (const card of due) {
    const item = itemById.get(card.bankItemId);
    if (!item) continue;
    session.push({ card, item, ...(await resolvePrompt(repos, item)) });
    if (session.length >= limit) break;
  }
  return session;
}

async function resolvePrompt(
  repos: Repositories,
  item: BankItemRow,
): Promise<{ promptRu: string; promptEn: string | null; source: PromptSource }> {
  if (item.kind === 'phrase') {
    return { promptRu: item.surface, promptEn: item.translation || null, source: 'phrase' };
  }
  if (item.sourceSentenceId) {
    const resolved = await repos.content.resolveSentence(item.sourceSentenceId);
    const ru = resolved?.sentence.ru;
    if (ru && scoringTokens(ru).length <= MAX_PROMPT_WORDS) {
      return { promptRu: ru, promptEn: resolved.sentence.en || null, source: 'sentence' };
    }
  }
  return {
    promptRu: item.lemma ?? item.surface,
    promptEn: item.translation || null,
    source: 'word',
  };
}
