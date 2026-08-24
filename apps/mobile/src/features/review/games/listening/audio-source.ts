import { normalizeRu } from '@/db/normalize';

import type { BankItemRow } from '@/db/repositories/bank';
import type { Repositories } from '@/db/repositories';

import { headword } from '../../session';
import { sentenceEligible } from '../sentence-source';

/**
 * T22: the T02 fixture pack ships a deliberately SILENT narration track
 * («Стук в стене» — fabricated word stamps over silence, built for karaoke
 * plumbing tests before real audio existed). A listening-quiz segment
 * sliced from it plays nothing, which reads as a broken question. Skip it
 * here (TTS fallback takes over); the reader's narration bar still plays
 * it, where the silence is at least attributable.
 */
const SILENT_FIXTURE_TRACKS = new Set(['a1-creepypasta-001:knock-anton-creepy']);

/**
 * Audio-source selection for the listening quiz (T14 work item 4; the same
 * "pack segment with valid timestamps → use it; else → TTS" rule the reader
 * popup speaker applies via T10's WordSegmentPlayer). This standalone
 * resolver works outside the reader: given only a bank item, it walks
 * source sentence → downloaded audio track → word stamp, and falls back to
 * on-device TTS (Piper via the SpeechService, which itself degrades to the
 * system voice) whenever any link is missing. It never fails — every bank
 * item is speakable.
 */
export type ListeningAudio =
  | {
      kind: 'segment';
      /** Local file uri of the narration track (audio_tracks.localUri). */
      uri: string;
      startMs: number;
      endMs: number;
      /** The surface form the narrator actually says in this slice. */
      spokenText: string;
    }
  | {
      kind: 'tts';
      /** What the TTS engine should say (word headword / phrase surface). */
      text: string;
    };

/** The Russian a listener is expected to hear — the quiz answer key. */
export function spokenText(audio: ListeningAudio): string {
  return audio.kind === 'segment' ? audio.spokenText : audio.text;
}

/**
 * Resolve the best audio source for a bank item. Segment path requires:
 * a word item with a source sentence the T13 sentence-sourcing rules allow
 * (read story / scrolled-past sentence, unless `unseenAllowed`), a
 * downloaded track for that story, and a word stamp covering the lemma's
 * token in that sentence. Phrases go straight to TTS (bank phrases don't
 * record a token span, so a reliable multi-word slice can't be
 * reconstructed — recorded T14 deviation). Ineligible/unstamped sources
 * fall back to TTS — the item always stays playable.
 */
export async function resolveListeningAudio(
  repos: Repositories,
  item: BankItemRow,
  opts: { unseenAllowed?: boolean } = {},
): Promise<ListeningAudio> {
  const { unseenAllowed = false } = opts;
  const fallback: ListeningAudio = { kind: 'tts', text: headword(item) };
  if (item.kind !== 'word' || !item.lemma || !item.sourceSentenceId) return fallback;

  const resolved = await repos.content.resolveSentence(item.sourceSentenceId);
  if (!resolved) return fallback;
  const { packId, storyId, id: sentenceId } = resolved.sentence;

  // T14 ticket: listening items sourced from stories respect the T13
  // unseen-stories toggle too (a one-entry ReadIndex feeds the shared rule).
  if (!unseenAllowed) {
    const progress = await repos.reading.getProgress(packId, storyId);
    const index = {
      progress: new Map(progress ? [[`${packId}:${storyId}`, progress]] : []),
      storyLevel: new Map(),
    };
    if (!sentenceEligible(resolved.sentence, index, false)) return fallback;
  }

  const tracks = (await repos.content.listAudioTracksForPack(packId)).filter(
    (t) =>
      t.storyId === storyId &&
      t.localUri != null &&
      !SILENT_FIXTURE_TRACKS.has(`${packId}:${t.id}`),
  );
  if (tracks.length === 0) return fallback;

  const tokens = await repos.content.getSentenceTokens(packId, sentenceId);
  const norm = normalizeRu(item.lemma);
  const target = tokens.find((t) => !t.isPunct && t.lemmaNorm === norm);
  if (!target) return fallback;

  for (const track of tracks) {
    const stamps = await repos.content.getWordStamps(packId, storyId, track.id);
    const stamp = stamps.find(
      (s) => s.sentenceId === sentenceId && s.tokenIndex === target.tokenIndex,
    );
    if (stamp && stamp.endMs > stamp.startMs) {
      return {
        kind: 'segment',
        uri: track.localUri!,
        startMs: stamp.startMs,
        endMs: stamp.endMs,
        spokenText: target.text,
      };
    }
  }
  return fallback;
}
