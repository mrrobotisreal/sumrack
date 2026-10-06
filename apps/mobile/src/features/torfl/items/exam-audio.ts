import type { ExamPart, ExamItem, StoryRef } from '@sumrak/schema';
import { resolveItemAudio } from '@sumrak/schema';

import type { Repositories } from '@/db/repositories';
import type { AudioTrackRow, SentenceWithTokens, WordStampRow } from '@/db/repositories/content';
import type { KaraokeStampInput } from '@/features/reader/karaoke';

import { refSentenceIds, resolveAudioSpan } from '../scoring';

/**
 * Exam item assets (T70, TORFL §12): the passage a reading item shows and
 * the audio a listening item plays, resolved from ONE story ref. Shared
 * with T71's mock engine (same resolver, `mode: 'exam'` just plays it
 * under the play-count rule).
 *
 * Audio rule (the T14 `resolveListeningAudio` precedent): a track with a
 * file on disk → the ref's span of it; anything missing (no track, Wi-Fi
 * gate deferred the download, file deleted) → the span's text through the
 * speech service, flagged `synthetic` so the UI shows the «синтез» badge.
 */

export type ExamAudioSource =
  { kind: 'segment'; uri: string; startMs: number; endMs: number } | { kind: 'tts'; text: string };

export interface ExamAudio {
  source: ExamAudioSource;
  /** True when the source is TTS — the «синтез» badge. */
  synthetic: boolean;
  /** The covered sentences with tokens (transcript + karaoke), story order. */
  transcript: SentenceWithTokens[];
  /** Word stamps restricted to the covered sentences (empty for TTS / unstamped tracks). */
  stamps: KaraokeStampInput[];
  /** Length of the played span (segment) or 0. */
  spanMs: number;
}

export interface ExamPassage {
  packId: string;
  storyId: string;
  sentences: SentenceWithTokens[];
}

export interface ItemAssets {
  passage: ExamPassage | null;
  audio: ExamAudio | null;
  /** The story the audio belongs to (transcript word lookup needs it). */
  audioStoryId: string | null;
}

/** The track a ref plays: the named one, else the story's first. */
export function pickTrack(
  tracks: readonly AudioTrackRow[],
  ref: Pick<StoryRef, 'trackId'>,
): AudioTrackRow | null {
  if (ref.trackId) return tracks.find((t) => t.id === ref.trackId) ?? null;
  return tracks[0] ?? null;
}

export interface BuildAudioInput {
  ref: Pick<StoryRef, 'sentenceIds' | 'trackId'>;
  sentences: readonly SentenceWithTokens[];
  tracks: readonly AudioTrackRow[];
  /** Stamps of the picked track (all sentences of the story). */
  stamps: readonly WordStampRow[];
  /** Does the local file exist? Injected so this stays pure/testable. */
  fileExists: (uri: string) => boolean;
}

/** Pure core of the audio resolver. Never fails: the worst case is TTS of the span's text. */
export function buildExamAudio(input: BuildAudioInput): ExamAudio {
  const ids = refSentenceIds(
    input.ref,
    input.sentences.map((s) => s.id),
  );
  const idSet = new Set(ids);
  const transcript = input.sentences.filter((s) => idSet.has(s.id));
  const ttsText = transcript.map((s) => s.ru).join(' ');
  const tts: ExamAudio = {
    source: { kind: 'tts', text: ttsText },
    synthetic: true,
    transcript,
    stamps: [],
    spanMs: 0,
  };
  const track = pickTrack(input.tracks, input.ref);
  if (!track || !track.localUri || !input.fileExists(track.localUri)) return tts;
  const covered = input.stamps
    .filter((s) => idSet.has(s.sentenceId))
    .map((s) => ({
      sentenceId: s.sentenceId,
      tokenIndex: s.tokenIndex,
      startMs: s.startMs,
      endMs: s.endMs,
    }));
  const span = resolveAudioSpan(input.ref, covered, track.durationMs) ?? {
    startMs: 0,
    endMs: track.durationMs,
  };
  return {
    source: { kind: 'segment', uri: track.localUri, startMs: span.startMs, endMs: span.endMs },
    synthetic: false,
    transcript,
    stamps: covered,
    spanMs: Math.max(0, span.endMs - span.startMs),
  };
}

type ContentRepo = Pick<Repositories['content'], 'getStoryDetail' | 'getWordStamps'>;

/**
 * Load a drill/mock item's passage + audio. `part`/`itemIdx` let
 * `resolveItemAudio` apply the «one dialogue → several questions» inheritance.
 * Missing stories resolve to `null` (a pack update removed them) — callers
 * render the stem alone.
 */
export async function loadItemAssets(
  content: ContentRepo,
  packId: string,
  part: Pick<ExamPart, 'items'>,
  itemIdx: number,
  item: ExamItem,
  fileExists: (uri: string) => boolean,
): Promise<ItemAssets> {
  let passage: ExamPassage | null = null;
  if ((item.kind === 'choice' || item.kind === 'typed') && item.passage) {
    const detail = await content.getStoryDetail(packId, item.passage.storyId);
    if (detail) {
      const ids = new Set(
        refSentenceIds(
          item.passage,
          detail.sentences.map((s) => s.id),
        ),
      );
      const sentences = detail.sentences.filter((s) => ids.has(s.id));
      if (sentences.length > 0) passage = { packId, storyId: item.passage.storyId, sentences };
    }
  }
  let audio: ExamAudio | null = null;
  let audioStoryId: string | null = null;
  const ref = resolveItemAudio(part, itemIdx);
  if (ref) {
    const detail = await content.getStoryDetail(packId, ref.storyId);
    if (detail) {
      const track = pickTrack(detail.audio, ref);
      const stamps = track ? await content.getWordStamps(packId, ref.storyId, track.id) : [];
      audio = buildExamAudio({
        ref,
        sentences: detail.sentences,
        tracks: detail.audio,
        stamps,
        fileExists,
      });
      audioStoryId = ref.storyId;
    }
  }
  return { passage, audio, audioStoryId };
}
