import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { create } from 'zustand';

/**
 * T115 (AMBIENT_SOUNDTRACKS §11): the narration surfaces (reader per-part
 * narration, the listen full-story player) publish the CURRENT part's score
 * here while they are focused; the ambient host plays it on the one ambient
 * player in place of the bed. The most recently registered source wins.
 */
export interface ScoreSource {
  /** `<packId>/<storyId>/<trackId>`: a new key = a new score file (next part). */
  key: string;
  /** Staged score file; null = the part has a score that is not downloaded yet. */
  uri: string | null;
  durationMs: number;
  /** The owning narration plays right now. */
  playing: boolean;
  /** The narration's playback rate. */
  rate: number;
  /** Bumped on every narration seek. */
  seekRevision: number;
  /** Live narration position in the score's time (ms). */
  positionMs(): number;
  props: { packId: string; storyId: string; mode: 'reader' | 'listen' };
}

export const useAmbientScores = create<{ sources: ReadonlyMap<symbol, ScoreSource> }>(() => ({
  sources: new Map(),
}));

/** The source the host follows: the last registered one, else null. */
export function currentScoreSource(sources: ReadonlyMap<symbol, ScoreSource>): ScoreSource | null {
  let last: ScoreSource | null = null;
  for (const s of sources.values()) last = s;
  return last;
}

/**
 * Publish `source` while the calling screen is focused (null = this part has
 * no score). Losing focus — leaving the reader or listen screen — withdraws
 * it, which restores today's bed behaviour.
 */
export function useScoreSource(source: ScoreSource | null) {
  const idRef = React.useRef<symbol>(Symbol('score'));
  const [focused, setFocused] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  React.useEffect(() => {
    const id = idRef.current;
    if (!focused || !source) {
      if (useAmbientScores.getState().sources.has(id)) {
        useAmbientScores.setState((s) => {
          const sources = new Map(s.sources);
          sources.delete(id);
          return { sources };
        });
      }
      return;
    }
    // Update in place (Map.set keeps the insertion order) — a position/rate
    // change must not reorder sources.
    useAmbientScores.setState((s) => ({ sources: new Map(s.sources).set(id, source) }));
  }, [focused, source]);
  React.useEffect(() => {
    const id = idRef.current;
    return () => {
      useAmbientScores.setState((s) => {
        const sources = new Map(s.sources);
        sources.delete(id);
        return { sources };
      });
    };
  }, []);
}

/** The score row shape both narration surfaces hand in (content repo `StoryScoreRow`). */
export interface ScoreRowLike {
  trackId: string;
  localUri: string | null;
  durationMs: number;
}

/**
 * Reader (T115): the part's score source while its OWN track is the current
 * narration (a voice switch to another track = no score, the bed plays).
 */
export function readerScoreSource(args: {
  packId: string;
  storyId: string;
  score: ScoreRowLike | null | undefined;
  currentTrackId: string | null;
  playing: boolean;
  rate: number;
  seekRevision: number;
  positionMs: () => number;
}): ScoreSource | null {
  const { score } = args;
  if (!score || args.currentTrackId !== score.trackId) return null;
  return {
    key: `${args.packId}/${args.storyId}/${score.trackId}`,
    uri: score.localUri,
    durationMs: score.durationMs,
    playing: args.playing,
    rate: args.rate,
    seekRevision: args.seekRevision,
    positionMs: args.positionMs,
    props: { packId: args.packId, storyId: args.storyId, mode: 'reader' },
  };
}

/**
 * Listen (T115): the score of the part the full-story clock is in, positioned
 * at `position − segment.startMs`; the segment's narration track must be the
 * one the score was cut against. Past the segment end (the 1.2 s gap) the
 * position runs past the score's duration → the controller parks it (silence).
 */
export function listenScoreSource(args: {
  packId: string;
  segment: { storyId: string; trackId: string; startMs: number } | undefined;
  score: ScoreRowLike | undefined;
  playing: boolean;
  rate: number;
  seekRevision: number;
  positionMs: () => number;
}): ScoreSource | null {
  const { segment, score } = args;
  if (!segment || !score || score.trackId !== segment.trackId) return null;
  return {
    key: `${args.packId}/${segment.storyId}/${score.trackId}`,
    uri: score.localUri,
    durationMs: score.durationMs,
    playing: args.playing,
    rate: args.rate,
    seekRevision: args.seekRevision,
    positionMs: () => args.positionMs() - segment.startMs,
    props: { packId: args.packId, storyId: segment.storyId, mode: 'listen' },
  };
}
