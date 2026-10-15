import { normalizeRu } from '@/db/normalize';
import { foldForAnswer } from '@/lib/text';

import type { BankItemRow } from '@/db/repositories/bank';
import type { Repositories } from '@/db/repositories';

import { headword } from '../../session';
import { sentenceEligible } from '../sentence-source';

/**
 * Listening-quiz audio (T14 → T85). The quiz never plays story audio: T85 retired
 * the word slices cut from the narration track, because neighbour words bled into
 * them and stamp errors chopped the target. Every item now speaks its BANKED
 * surface through the SpeechService (Piper when installed, system voice otherwise).
 *
 * The source sentence is still resolved, but only to highlight the target token
 * in the post-answer context line, so the answer reveal shows where the word came
 * from. `keySource` records which rule picked that token (kept for analytics).
 */
export type ListeningAudio = {
  kind: 'tts';
  /** Which rule picked the highlighted token; `'tts'` when there is no sentence context. */
  keySource: 'encounter' | 'surface' | 'lemma' | 'tts';
  /** What the TTS engine says and the answer key: the banked surface, never the lemma. */
  text: string;
  /** Post-answer sentence highlight; null when the sentence is not eligible or no token resolves. */
  context: { tokens: { text: string; spaceBefore: boolean; isPunct: boolean; isTarget: boolean }[] } | null;
};

/** The Russian a listener is expected to hear — the quiz answer key. */
export function spokenText(audio: ListeningAudio): string {
  return audio.text;
}

/**
 * Resolve the audio for a bank item. The spoken text is always
 * `item.surface.trim() || headword(item)`. Context is resolved only for words:
 * source sentence → T13 eligibility (unless `unseenAllowed`) → sentence tokens →
 * `pickTargetToken`. Phrases and items without a sentence get `context: null`.
 */
export async function resolveListeningAudio(
  repos: Repositories,
  item: BankItemRow,
  opts: { unseenAllowed?: boolean } = {},
): Promise<ListeningAudio> {
  const { unseenAllowed = false } = opts;
  const text = item.surface.trim() || headword(item);
  const none: ListeningAudio = { kind: 'tts', keySource: 'tts', text, context: null };
  if (item.kind !== 'word' || !item.lemma || !item.sourceSentenceId) return none;

  const resolved = await repos.content.resolveSentence(item.sourceSentenceId);
  if (!resolved) return none;
  const { packId, storyId, id: sentenceId } = resolved.sentence;

  // T14 ticket: listening items sourced from stories respect the T13
  // unseen-stories toggle too (a one-entry ReadIndex feeds the shared rule).
  if (!unseenAllowed) {
    const progress = await repos.reading.getProgress(packId, storyId);
    const index = {
      progress: new Map(progress ? [[`${packId}:${storyId}`, progress]] : []),
      storyLevel: new Map(),
    };
    if (!sentenceEligible(resolved.sentence, index, false)) return none;
  }

  const tokens = await repos.content.getSentenceTokens(packId, sentenceId);
  const norm = normalizeRu(item.lemma);
  const picked = await pickTargetToken(repos, item, sentenceId, tokens, norm);
  if (!picked) return none;
  const { target, keySource } = picked;

  return {
    kind: 'tts',
    keySource,
    text,
    context: {
      tokens: tokens.map((t) => ({
        text: t.text,
        spaceBefore: t.spaceBefore,
        isPunct: t.isPunct,
        isTarget: t.tokenIndex === target.tokenIndex,
      })),
    },
  };
}

type SentenceToken = Awaited<ReturnType<Repositories['content']['getSentenceTokens']>>[number];

/**
 * T81 resolver order — the key must be the form Mitch banked:
 * 1. the source encounter's `(sentenceId, tokenIndex)` (the oldest one in the
 *    item's source sentence), if that token still reads as this word;
 * 2. a token whose surface folds equal to `item.surface` (backfill for items
 *    banked before `token_index` existed);
 * 3. the first token with the item's lemma (the pre-T81 behaviour).
 */
export async function pickTargetToken(
  repos: Repositories,
  item: BankItemRow,
  sentenceId: string,
  tokens: SentenceToken[],
  lemmaNorm: string,
): Promise<{ target: SentenceToken; keySource: 'encounter' | 'surface' | 'lemma' } | null> {
  const words = tokens.filter((t) => !t.isPunct);
  const surfaceFold = foldForAnswer(item.surface);

  const withEnc = await repos.bank.getItemWithEncounters(item.id);
  const source = (withEnc?.encounters ?? [])
    .filter((e) => e.sentenceId === sentenceId && e.tokenIndex != null)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (source) {
    const t = words.find((w) => w.tokenIndex === source.tokenIndex);
    if (
      t &&
      (t.lemmaNorm === lemmaNorm || foldForAnswer(t.text) === foldForAnswer(source.surface))
    ) {
      return { target: t, keySource: 'encounter' };
    }
  }
  const bySurface = words.find(
    (t) => foldForAnswer(t.text) === surfaceFold && (t.lemmaNorm === lemmaNorm || !t.lemmaNorm),
  );
  if (bySurface) return { target: bySurface, keySource: 'surface' };
  const byLemma = words.find((t) => t.lemmaNorm === lemmaNorm);
  return byLemma ? { target: byLemma, keySource: 'lemma' } : null;
}
