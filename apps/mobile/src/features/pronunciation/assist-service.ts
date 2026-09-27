import SherpaSpeech from '../../../modules/sherpa-speech';
import { track } from '@/services/analytics';

import { transcriptResultSchema, type TranscriptResult } from './asr-catalog';
import { ASSIST_MODEL, assistLanguageSchema, type AssistLanguage } from './assist-catalog';
import { assistModelPaths, isAssistInstalled } from './assist-manager';

/**
 * Loading + English re-decode over the Whisper assist recognizer (T59) —
 * the T12 ASR service's ensure-loaded pattern, results Zod-parsed at the
 * boundary. The assist model is OPTIONAL (design §12 "assist model
 * missing"): callers gate on `isAssistInstalled()` and fall through to the
 * glossary / online / dont-know chain; `transcribeEnglish` throws
 * AssistNotInstalledError rather than calling native blind.
 *
 * Residency policy (ticket risk note): Whisper stays loaded beside the
 * Zipformer once warmed — the S25 measurement with both resident is in the
 * T59 row; if a device ever needs it, `unloadAssist()` after a decode is
 * the one-line policy switch.
 */

export { isAssistInstalled };

export class AssistNotInstalledError extends Error {
  constructor() {
    super('Assist model is not installed');
    this.name = 'AssistNotInstalledError';
  }
}

/** Load the Whisper recognizer if needed. No-op when already loaded. */
export async function ensureAssistLoaded(): Promise<void> {
  if (!isAssistInstalled()) throw new AssistNotInstalledError();
  const paths = assistModelPaths();
  const result = await SherpaSpeech.loadWhisper(
    ASSIST_MODEL.id,
    paths.encoderPath,
    paths.decoderPath,
    paths.tokensPath,
  );
  if (!result.alreadyLoaded) {
    track('whisper_loaded', { modelId: ASSIST_MODEL.id, loadMs: result.loadMs });
  }
}

/** Re-decode a recorded attempt WAV with Whisper in the given language. */
export async function transcribeWithAssist(
  wavPath: string,
  language: AssistLanguage = 'en',
): Promise<TranscriptResult> {
  await ensureAssistLoaded();
  const raw = await SherpaSpeech.transcribeWhisper(wavPath, assistLanguageSchema.parse(language));
  const parsed = transcriptResultSchema.parse(raw);
  track('whisper_transcribed', {
    decodeMs: parsed.decodeMs,
    audioMs: parsed.audioMs,
    words: parsed.words.length,
    language,
  });
  return parsed;
}

/** The «как сказать <english word>» path: the same recording, decoded as English. */
export function transcribeEnglish(wavPath: string): Promise<TranscriptResult> {
  return transcribeWithAssist(wavPath, 'en');
}

/** Warm-load off the critical path (scenario start) so the first «как сказать» is fast. */
export function preloadAssist(): void {
  if (!isAssistInstalled()) return;
  void ensureAssistLoaded().catch((err) => console.warn('[assist] preload failed', err));
}

/** Release the recognizer's memory (never throws). */
export async function unloadAssist(): Promise<void> {
  await SherpaSpeech.unloadWhisper().catch(() => undefined);
}
