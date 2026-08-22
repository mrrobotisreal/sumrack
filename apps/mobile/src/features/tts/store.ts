import { create } from 'zustand';

import { SYSTEM_VOICE_ID } from './catalog';

/**
 * TTS UI state (T11). Mirrors the T07 sync-store pattern: zustand holds
 * what screens render (installed voices, download progress, selection);
 * the durable facts live in the filesystem (extracted voice dirs) and the
 * settings table (`tts.voice`), written through by the manager/service.
 */

export type VoiceDownloadPhase = 'downloading' | 'verifying' | 'extracting';

export interface VoiceDownload {
  phase: VoiceDownloadPhase;
  /** 0..1 over the archive bytes; verify/extract phases hold at 1. */
  progress: number;
}

export interface InstalledVoice {
  /** Measured bytes on disk (storage accounting, Settings). */
  bytes: number;
}

interface TtsState {
  /** SYSTEM_VOICE_ID or an installed Piper voice id. */
  selectedVoiceId: string;
  /** Installed voices by id, with on-disk size. */
  installed: Record<string, InstalledVoice>;
  /** In-flight downloads by voice id. */
  downloads: Record<string, VoiceDownload>;
  /** Per-voice error message from the last failed download (cleared on retry). */
  downloadErrors: Record<string, string>;
  /** Native module reports playback state (dev screen indicator). */
  speaking: boolean;

  setSelectedVoiceId: (id: string) => void;
  setInstalled: (installed: Record<string, InstalledVoice>) => void;
  setDownload: (voiceId: string, download: VoiceDownload | null) => void;
  setDownloadError: (voiceId: string, message: string | null) => void;
  setSpeaking: (speaking: boolean) => void;
}

export const useTtsStore = create<TtsState>((set) => ({
  selectedVoiceId: SYSTEM_VOICE_ID,
  installed: {},
  downloads: {},
  downloadErrors: {},
  speaking: false,

  setSelectedVoiceId: (id) => set({ selectedVoiceId: id }),
  setInstalled: (installed) => set({ installed }),
  setDownload: (voiceId, download) =>
    set((s) => {
      const downloads = { ...s.downloads };
      if (download) downloads[voiceId] = download;
      else delete downloads[voiceId];
      return { downloads };
    }),
  setDownloadError: (voiceId, message) =>
    set((s) => {
      const downloadErrors = { ...s.downloadErrors };
      if (message) downloadErrors[voiceId] = message;
      else delete downloadErrors[voiceId];
      return { downloadErrors };
    }),
  setSpeaking: (speaking) => set({ speaking }),
}));
