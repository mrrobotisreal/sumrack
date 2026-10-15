import { getVoice, PIPER_VOICES, SYSTEM_VOICE_ID } from './catalog';

/**
 * Pure engine routing (T11): which TTS actually speaks a request. Kept
 * free of native/store imports so the fallback rules are unit-testable —
 * the design §11 guarantee ("speech never hard-fails") lives here.
 */

export type TtsEngine = 'piper' | 'system';

export interface EngineChoice {
  engine: TtsEngine;
  voiceId: string;
}

/**
 * An explicit request wins over the app-wide selection; anything that is
 * not a known, installed Piper voice routes to the system engine.
 */
export function pickEngine(
  requestedVoiceId: string | undefined,
  selectedVoiceId: string,
  installedVoiceIds: readonly string[],
): EngineChoice {
  const candidate = requestedVoiceId ?? selectedVoiceId;
  if (
    candidate !== SYSTEM_VOICE_ID &&
    getVoice(candidate) !== undefined &&
    installedVoiceIds.includes(candidate)
  ) {
    return { engine: 'piper', voiceId: candidate };
  }
  return { engine: 'system', voiceId: SYSTEM_VOICE_ID };
}

/**
 * T85: the voice for short word/phrase clips. Clips always prefer Piper — the
 * selected voice when it is an installed Piper voice, else the first installed
 * one in catalog order; undefined = no Piper installed → the caller's normal
 * routing lands on the system voice.
 */
export function pickClipVoiceId(
  selectedVoiceId: string,
  installedVoiceIds: readonly string[],
): string | undefined {
  const isInstalledPiper = (id: string) =>
    id !== SYSTEM_VOICE_ID && getVoice(id) !== undefined && installedVoiceIds.includes(id);
  if (isInstalledPiper(selectedVoiceId)) return selectedVoiceId;
  return PIPER_VOICES.find((v) => installedVoiceIds.includes(v.id))?.id;
}

/** Clamp a user/UI rate multiplier to what both engines handle sanely. */
export function clampRate(rate: number | undefined): number {
  if (!rate || !Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}
