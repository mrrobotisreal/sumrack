import { normalizeRu } from '@/db/normalize';
import type { SentenceRow, TokenRow } from '@/db/repositories/content';
import type { StoryProgressRow } from '@/db/repositories/reading';
import type { Repositories } from '@/db/repositories';

/**
 * Sentence sourcing for the T13 games (design §7.3 modes 3–4): real
 * sentences from *read* stories containing a target lemma. "Read" (T04
 * `story_progress`) means: the story is finished, or — for an in-progress
 * story — the sentence is at or above the saved reading position, so the
 * games never quote a line Mitch hasn't scrolled past. The
 * `clozeUnseenStoriesAllowed` setting (default false) widens eligibility to
 * every imported sentence.
 */

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

const progressKey = (packId: string, storyId: string) => `${packId}:${storyId}`;

/** Prefetched lookup tables so building a 10-item session hits the DB once, not 10×. */
export interface ReadIndex {
  progress: Map<string, StoryProgressRow>;
  /** Story CEFR level by the same key — sentence-builder distractor scaling. */
  storyLevel: Map<string, CefrLevel>;
}

export async function buildReadIndex(repos: Repositories): Promise<ReadIndex> {
  const [progressRows, stories] = await Promise.all([
    repos.reading.listProgress(),
    repos.content.listStories(),
  ]);
  return {
    progress: new Map(progressRows.map((p) => [progressKey(p.packId, p.storyId), p])),
    storyLevel: new Map(stories.map((s) => [progressKey(s.packId, s.id), s.level])),
  };
}

/** The read-stories-only rule. Exported standalone so tests can pin it down. */
export function sentenceEligible(
  sentence: SentenceRow,
  index: ReadIndex,
  unseenAllowed: boolean,
): boolean {
  if (unseenAllowed) return true;
  const progress = index.progress.get(progressKey(sentence.packId, sentence.storyId));
  if (!progress) return false;
  if (progress.finishedAt != null) return true;
  // currentSentenceIdx = topmost visible sentence (T04) — it has been on screen.
  return sentence.orderIdx <= progress.currentSentenceIdx;
}

export interface SourcedSentence {
  sentence: SentenceRow;
  /** Ordered tokens of the sentence. */
  tokens: TokenRow[];
  /** Index (into `tokens`) of the occurrence of the target lemma. */
  targetIndex: number;
  storyLevel: CefrLevel | null;
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
 * Pick one eligible sentence containing `lemma` (ё/е-tolerant via the
 * indexed `lemma_norm` shadow), random among candidates for variety, with
 * its tokens and the target-token position resolved. null = no eligible
 * sentence — the session builder skips the item, never loosens the rule.
 */
export async function pickSentenceForLemma(
  repos: Repositories,
  lemma: string,
  index: ReadIndex,
  opts: { unseenAllowed?: boolean; maxWords?: number } = {},
): Promise<SourcedSentence | null> {
  const { unseenAllowed = false, maxWords = Infinity } = opts;
  const candidates = await repos.content.findSentencesWithLemma(lemma);
  const norm = normalizeRu(lemma);

  for (const sentence of shuffle(candidates)) {
    if (!sentenceEligible(sentence, index, unseenAllowed)) continue;
    const tokens = await repos.content.getSentenceTokens(sentence.packId, sentence.id);
    if (tokens.filter((t) => !t.isPunct).length > maxWords) continue;
    const occurrences = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.isPunct && t.lemmaNorm === norm);
    if (occurrences.length === 0) continue; // defensive: index said yes, tokens disagree
    const target = occurrences[Math.floor(Math.random() * occurrences.length)]!;
    return {
      sentence,
      tokens,
      targetIndex: target.i,
      storyLevel: index.storyLevel.get(progressKey(sentence.packId, sentence.storyId)) ?? null,
    };
  }
  return null;
}
