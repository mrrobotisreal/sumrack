import type { WordStampRow } from '@/db/repositories/content';
import type { ListeningSegment } from './catalog';

export interface SegmentSourceDetail {
  pack: { id: string; version: number };
  story: { id: string };
  sentences: readonly { id: string; ru: string }[];
  audio: readonly { id: string; file: string; durationMs: number; localUri: string | null }[];
}

export type SegmentAudio = { uri: string; startMs: number; endMs: number };
export type LoadedSegment =
  { available: true; audio: SegmentAudio } | { available: false; reason: string };

/** Fail closed. No fallback that could silently replace the exact narration with TTS. */
export function resolveSegment(
  segment: ListeningSegment,
  detail: SegmentSourceDetail | null,
  stamps: readonly Pick<WordStampRow, 'sentenceId' | 'tokenIndex' | 'startMs' | 'endMs'>[],
  exists: (uri: string) => boolean,
): LoadedSegment {
  const ref = segment.source;
  if (!detail)
    return {
      available: false,
      reason: `Install ${ref.packId} in the Library to use this segment.`,
    };
  if (
    detail.pack.id !== ref.packId ||
    detail.pack.version !== ref.packVersion ||
    detail.story.id !== ref.storyId
  )
    return {
      available: false,
      reason: 'The installed pack version differs from this reviewed segment.',
    };
  const sentence = detail.sentences.find((s) => s.id === ref.sentenceId);
  if (sentence?.ru !== segment.transcript)
    return { available: false, reason: 'The source sentence changed. A catalog update is needed.' };
  const track = detail.audio.find((a) => a.id === ref.trackId);
  if (!track || track.file !== ref.file || track.durationMs !== ref.durationMs)
    return { available: false, reason: 'The reviewed narration track changed or is missing.' };
  const current = stamps.filter((s) => s.sentenceId === ref.sentenceId);
  if (
    current.length !== ref.stamps.length ||
    ref.stamps.some(
      (s) =>
        !current.some(
          (c) => c.tokenIndex === s.tokenIndex && c.startMs === s.startMs && c.endMs === s.endMs,
        ),
    )
  )
    return { available: false, reason: 'Sentence timing changed. This segment needs review.' };
  if (
    stamps.some(
      (s) => s.sentenceId !== ref.sentenceId && s.startMs < ref.endMs && s.endMs > ref.startMs,
    )
  )
    return { available: false, reason: 'The segment boundary overlaps another sentence.' };
  if (!track.localUri || !exists(track.localUri))
    return {
      available: false,
      reason: 'Download this pack’s narration in the Library, then retry.',
    };
  return {
    available: true,
    audio: { uri: track.localUri, startMs: ref.startMs, endMs: ref.endMs },
  };
}
