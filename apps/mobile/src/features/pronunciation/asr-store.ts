import { create } from 'zustand';

import type { VoiceDownload } from '@/features/tts/store';

/**
 * ASR model UI state (T12) — the single-model sibling of the T11 TTS store:
 * zustand holds what the Settings row and the game's "model needed" state
 * render; the durable fact ("installed") lives in the filesystem.
 */
interface AsrState {
  /** Measured bytes on disk, null = not installed. */
  installedBytes: number | null;
  download: VoiceDownload | null;
  downloadError: string | null;

  setInstalledBytes: (bytes: number | null) => void;
  setDownload: (download: VoiceDownload | null) => void;
  setDownloadError: (message: string | null) => void;
}

export const useAsrStore = create<AsrState>((set) => ({
  installedBytes: null,
  download: null,
  downloadError: null,

  setInstalledBytes: (installedBytes) => set({ installedBytes }),
  setDownload: (download) => set({ download }),
  setDownloadError: (downloadError) => set({ downloadError }),
}));
