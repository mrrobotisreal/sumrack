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

export interface LoadAsrResult {
  loadMs: number;
  alreadyLoaded: boolean;
}

/**
 * Raw native transcription result (T12). The pronunciation feature validates
 * this with Zod at the boundary (asr-catalog.ts) before using it — treat
 * this interface as a claim, not a guarantee.
 */
export interface NativeTranscribeResult {
  text: string;
  words: { word: string; startMs: number; endMs: number }[];
  /** Pure decode time — the design §6 "< ~2s for a short phrase" number. */
  decodeMs: number;
  audioMs: number;
}

export interface StopRecordingResult {
  path: string;
  durationMs: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo's EventsMap constraint requires an any[] index signature
export type SherpaSpeechEvents = Record<string, (...args: any[]) => void> & {
  onSpeakingStateChanged: (payload: { speaking: boolean }) => void;
  /** ~8/s while recording: RMS input level 0..1 + elapsed time. */
  onRecordingLevel: (payload: { level: number; elapsedMs: number }) => void;
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
  loadAsr(
    asrId: string,
    encoderPath: string,
    decoderPath: string,
    joinerPath: string,
    tokensPath: string,
  ): Promise<LoadAsrResult>;
  unloadAsr(): Promise<void>;
  getLoadedAsrId(): string | null;
  transcribeFile(wavPath: string): Promise<NativeTranscribeResult>;
  startRecording(outPath: string): Promise<void>;
  stopRecording(): Promise<StopRecordingResult>;
  cancelRecording(): Promise<void>;
  sha256File(path: string): Promise<string>;
  extractTarBz2(archivePath: string, destDir: string): Promise<ExtractResult>;
  dirSize(path: string): Promise<number>;
}

export default requireNativeModule<SherpaSpeechNativeModule>('SherpaSpeech');
