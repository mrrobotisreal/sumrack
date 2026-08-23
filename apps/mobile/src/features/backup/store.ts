import { create } from 'zustand';

/**
 * Ephemeral backup UI state (T20), mirroring the T07 sync store: written
 * only by service.ts; the durable facts (last successful backup per target,
 * prefs, KDF params) live in the settings table.
 */
export type BackupPhase = 'idle' | 'exporting' | 'encrypting' | 'uploading' | 'pruning';

export type BackupTrigger = 'manual' | 'daily-auto' | 'session-auto';

export interface BackupRunSummary {
  at: number;
  trigger: BackupTrigger;
  outcome: 'ok' | 'error' | 'skipped';
  skipReason?: 'not-configured' | 'target-disabled' | 'offline' | 'already-fresh' | 'in-flight';
  /** Uploaded file name on success. */
  name?: string;
  /** How many old snapshots retention pruned (0 = none). */
  pruned?: number;
  /** Plain-language failure, PAT/passphrase-free. */
  error?: string;
}

interface BackupStatusState {
  phase: BackupPhase;
  lastRun: BackupRunSummary | null;
  startRun: () => void;
  setPhase: (phase: BackupPhase) => void;
  finishRun: (summary: BackupRunSummary) => void;
}

export const useBackupStatus = create<BackupStatusState>((set) => ({
  phase: 'idle',
  lastRun: null,
  startRun: () => set({ phase: 'exporting' }),
  setPhase: (phase) => set({ phase }),
  finishRun: (summary) => set({ phase: 'idle', lastRun: summary }),
}));
