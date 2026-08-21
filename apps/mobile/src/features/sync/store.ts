import { create } from 'zustand';

/**
 * Ephemeral sync UI state (T07): what the progress surfaces on Library and
 * the pack management screen render. Written only by sync-service.ts; the
 * durable facts (installed versions, sizes) live in `sync_state`.
 */
export type SyncPhase = 'idle' | 'checking' | 'downloading';

export interface PackProgress {
  packId: string;
  titleEn: string;
  /** 1-based index of the pack in this run. */
  packIndex: number;
  packCount: number;
  /** Files fetched so far / total planned for this pack. */
  filesDone: number;
  fileCount: number;
}

export interface SyncRunSummary {
  at: number;
  trigger: 'auto' | 'manual';
  /** Run-level outcome. 'skipped' = throttled/offline/not-configured (quiet). */
  outcome: 'ok' | 'error' | 'skipped';
  skipReason?: 'throttled' | 'offline' | 'not-configured';
  installed: string[];
  updated: string[];
  /** Packs whose audio was deferred by the Wi-Fi-only setting. */
  audioDeferred: string[];
  /** Per-pack failures ({packId, message}); run continues past them. */
  packErrors: { packId: string; message: string }[];
  /** Run-fatal error (manifest fetch/parse) — plain-language, PAT-free. */
  error?: string;
}

interface SyncStatusState {
  phase: SyncPhase;
  progress: PackProgress | null;
  lastRun: SyncRunSummary | null;
  /** True while a banner for lastRun should show; dismissed by the user. */
  bannerVisible: boolean;
  startRun: (phase: SyncPhase) => void;
  setProgress: (progress: PackProgress | null) => void;
  finishRun: (summary: SyncRunSummary) => void;
  dismissBanner: () => void;
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  phase: 'idle',
  progress: null,
  lastRun: null,
  bannerVisible: false,
  startRun: (phase) => set({ phase, progress: null }),
  setProgress: (progress) => set({ progress, phase: 'downloading' }),
  finishRun: (summary) =>
    set({
      phase: 'idle',
      progress: null,
      lastRun: summary,
      // Quiet skips (throttle/offline/unconfigured auto-checks) never nag.
      bannerVisible: summary.outcome !== 'skipped',
    }),
  dismissBanner: () => set({ bannerVisible: false }),
}));
