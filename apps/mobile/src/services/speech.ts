import { track } from './analytics';

/**
 * The speech port (T05 stub — design §6/§7.1). The word popup and future
 * readback surfaces call this contract; real implementations arrive later:
 * T10 (pack-audio word segments) and T11 (sherpa-onnx Piper TTS) register
 * theirs via setSpeechService. Deliberately minimal — extend only when a
 * real implementer needs it (ticket note: small beats speculative).
 */
export interface SpeakOptions {
  /** Implementation-defined voice id (T11 Piper voices). */
  voiceId?: string;
  /** Playback rate multiplier, 1 = normal. */
  rate?: number;
}

export interface SpeechService {
  /** Speak Russian text aloud. Resolves when playback has been started (or skipped). */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  stop(): Promise<void>;
  /** False for the stub — UI can show the speaker as inert-but-present. */
  readonly available: boolean;
}

const noopSpeech: SpeechService = {
  available: false,
  async speak() {},
  async stop() {},
};

let current: SpeechService = noopSpeech;

export function getSpeechService(): SpeechService {
  return current;
}

/** Called by the real audio/TTS modules (T10/T11) once they can speak. */
export function setSpeechService(service: SpeechService): void {
  current = service;
}

/** Convenience used by UI: speak + analytics in one place. */
export async function speak(text: string, opts?: SpeakOptions): Promise<void> {
  track('speech_requested', { available: current.available, chars: text.length });
  await current.speak(text, opts);
}
