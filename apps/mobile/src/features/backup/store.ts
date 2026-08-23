import { create } from 'zustand';

/**
 * Ephemeral backup UI state (T20), mirroring the T07 sync store: written
 * only by service.ts; the durable facts (last successful backup per target,
 * prefs, KDF params) live in the settings table.
 */
export type BackupPhase = 'idle' | 'exporting' | 'encrypting' | 'uploading' | 'pruning';

export type BackupTrigger = 'manual' | 'daily-auto' | 'session-auto';

export type BackupTargetId = 'github' | 'syncd';

/** Per-target result of one run (T21: targets succeed/fail independently). */
export interface TargetOutcome {
  ok: boolean;
  /** Target already had a snapshot today — auto runs leave it alone. */
  skippedFresh?: boolean;
  /** Plain-language failure, token/passphrase-free. */
  error?: string;
  /** How many old snapshots retention pruned on this target (0 = none). */
  pruned?: number;
}

export interface BackupRunSummary {
  at: number;
  trigger: BackupTrigger;
  /** 'ok' = every target that attempted an upload succeeded. */
  outcome: 'ok' | 'error' | 'skipped';
  skipReason?: 'not-configured' | 'target-disabled' | 'offline' | 'already-fresh' | 'in-flight';
  /** Uploaded file name on success. */
  name?: string;
  /** Per-target outcomes for the targets this run considered. */
  targets?: Partial<Record<BackupTargetId, TargetOutcome>>;
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
