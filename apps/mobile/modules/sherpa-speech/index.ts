import { NativeModule, requireNativeModule } from 'expo';

/**
 * JS binding for the local sherpa-onnx Expo module (T11, design §6).
 * Import this ONLY from device code paths — requiring it in Node (vitest)
 * throws, so feature logic that needs testing must not import it directly.
 */

export interface SpeakResult {
  /** False when the utterance was cancelled before audio, or text produced none. */
  started: boolean;
  /** Time from the speak() call to the first audible chunk (the §6 latency number). */
  firstAudioMs?: number;
  cancelled?: boolean;
}

export interface LoadVoiceResult {
  loadMs: number;
  alreadyLoaded: boolean;
}

export interface SynthesizeResult {
  path: string;
  sampleRate: number;
  durationMs: number;
  /** Pure synthesis time (no playback) — useful for latency records. */
  synthMs: number;
}

export interface ExtractResult {
  /** The archive's single top-level directory name (Piper convention). */
  rootDir: string | null;
  bytes: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo's EventsMap constraint requires an any[] index signature
export type SherpaSpeechEvents = Record<string, (...args: any[]) => void> & {
  onSpeakingStateChanged: (payload: { speaking: boolean }) => void;
};

declare class SherpaSpeechNativeModule extends NativeModule<SherpaSpeechEvents> {
  loadVoice(
    voiceId: string,
    modelPath: string,
    tokensPath: string,
    dataDir: string,
  ): Promise<LoadVoiceResult>;
  unloadVoice(): Promise<void>;
  getLoadedVoiceId(): string | null;
  speak(text: string, rate: number): Promise<SpeakResult>;
  stop(): void;
  synthesizeToFile(text: string, rate: number, outPath: string): Promise<SynthesizeResult>;
  sha256File(path: string): Promise<string>;
  extractTarBz2(archivePath: string, destDir: string): Promise<ExtractResult>;
  dirSize(path: string): Promise<number>;
}

export default requireNativeModule<SherpaSpeechNativeModule>('SherpaSpeech');
