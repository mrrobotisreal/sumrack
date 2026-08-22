import SherpaSpeech from '../../../modules/sherpa-speech';
import { track } from '@/services/analytics';

import { ASR_MODEL, transcriptResultSchema, type TranscriptResult } from './asr-catalog';
import { asrModelPaths, isAsrInstalled } from './asr-manager';

/**
 * Loading + transcription over the native module (T12). Mirrors the T11 TTS
 * service's ensure-loaded pattern; results are Zod-parsed at the boundary.
 * Unlike TTS there is no graceful engine fallback — no model, no game — so
 * callers check `isAsrInstalled()` and render the "model needed" state
 * instead of calling in blind.
 */

export class AsrNotInstalledError extends Error {
  constructor() {
    super('ASR model is not installed');
    this.name = 'AsrNotInstalledError';
  }
}

/** Load the recognizer if needed (~1–2s cold). No-op when already loaded. */
export async function ensureAsrLoaded(): Promise<void> {
  if (!isAsrInstalled()) throw new AsrNotInstalledError();
  const paths = asrModelPaths();
  const result = await SherpaSpeech.loadAsr(
    ASR_MODEL.id,
    paths.encoderPath,
    paths.decoderPath,
    paths.joinerPath,
    paths.tokensPath,
  );
  if (!result.alreadyLoaded) {
    track('asr_loaded', { modelId: ASR_MODEL.id, loadMs: result.loadMs });
  }
}

/** Transcribe a recorded attempt WAV. Offline, on-device. */
export async function transcribeWav(wavPath: string): Promise<TranscriptResult> {
  await ensureAsrLoaded();
  const raw = await SherpaSpeech.transcribeFile(wavPath);
  const parsed = transcriptResultSchema.parse(raw);
  track('asr_transcribed', {
    decodeMs: parsed.decodeMs,
    audioMs: parsed.audioMs,
    words: parsed.words.length,
  });
  return parsed;
}

/** Warm-load off the critical path (session start) so attempt #1 is fast. */
export function preloadAsr(): void {
  if (!isAsrInstalled()) return;
  void ensureAsrLoaded().catch((err) => console.warn('[asr] preload failed', err));
}
