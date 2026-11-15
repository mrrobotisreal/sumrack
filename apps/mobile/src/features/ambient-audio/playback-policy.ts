import type { AmbientPrefs } from './preferences';

interface PlaybackContext {
  ready: boolean;
  foreground: boolean;
  studying: boolean;
  blocked: boolean;
  speaking: boolean;
  narrating: boolean;
}

export function shouldPlayAmbience(prefs: AmbientPrefs, context: PlaybackContext): boolean {
  return (
    prefs.enabled &&
    prefs.volume > 0 &&
    context.ready &&
    context.foreground &&
    context.studying &&
    !context.blocked &&
    !context.speaking &&
    (prefs.playDuringNarration || !context.narrating)
  );
}

/** T115: the current narration's score as the policy sees it. */
export interface ScoreCandidate {
  /** The score file is staged on the device. */
  downloaded: boolean;
  /** The narration that owns the score is playing. */
  playing: boolean;
}

export type ScoreUnavailableReason = 'not_downloaded' | 'pref_off' | 'disabled';

export interface AmbientDecision {
  /** What the one ambient player holds: the theme bed rotation or the part's score. */
  source: 'bed' | 'score';
  /** Audible now. */
  active: boolean;
  /** Set when the current part HAS a score but the bed rules apply instead. */
  unavailable?: ScoreUnavailableReason;
}

/**
 * T115 (AMBIENT_SOUNDTRACKS §11): score vs bed vs off. A scored narration
 * plays its score through the ambient player — same `enabled` / `volume`,
 * `playDuringNarration` on, `storyScores` on, file downloaded — audible only
 * while that narration plays (a paused narration pauses the score; the bed
 * does not come back mid-part). Anything else falls back to today's bed rules
 * exactly (`shouldPlayAmbience`).
 */
export function resolveAmbientDecision(
  prefs: AmbientPrefs,
  context: PlaybackContext,
  score: ScoreCandidate | null,
): AmbientDecision {
  const bed = (unavailable?: ScoreUnavailableReason): AmbientDecision => ({
    source: 'bed',
    active: shouldPlayAmbience(prefs, context),
    ...(unavailable ? { unavailable } : {}),
  });
  if (!score) return bed();
  if (!prefs.enabled) return bed('disabled');
  // «Play during narration» off: a score could never be heard, so the part
  // keeps today's behaviour (silence while narrating, the bed between).
  if (!prefs.storyScores || !prefs.playDuringNarration) return bed('pref_off');
  if (!score.downloaded) return bed('not_downloaded');
  return {
    source: 'score',
    active:
      prefs.volume > 0 &&
      context.ready &&
      context.foreground &&
      !context.blocked &&
      !context.speaking &&
      score.playing,
  };
}
