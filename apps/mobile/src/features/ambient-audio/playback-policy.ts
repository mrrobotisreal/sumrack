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
