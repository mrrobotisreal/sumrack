import { create } from 'zustand';

import type { VoiceDownload } from '@/features/tts/store';

/**
 * Assist-model UI state (T59) — the same single-model shape as the T12 ASR
 * store: what the Settings row renders; the durable fact ("installed")
 * lives in the filesystem (mirrored into `scenario.assistModel`).
 */
interface AssistState {
  /** Measured bytes on disk, null = not installed. */
  installedBytes: number | null;
  download: VoiceDownload | null;
  downloadError: string | null;

  setInstalledBytes: (bytes: number | null) => void;
  setDownload: (download: VoiceDownload | null) => void;
  setDownloadError: (message: string | null) => void;
}

export const useAssistStore = create<AssistState>((set) => ({
  installedBytes: null,
  download: null,
  downloadError: null,

  setInstalledBytes: (installedBytes) => set({ installedBytes }),
  setDownload: (download) => set({ download }),
  setDownloadError: (downloadError) => set({ downloadError }),
}));
