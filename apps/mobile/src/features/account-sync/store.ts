import { create } from 'zustand';

/** Sync status shown in Settings → «Аккаунт» and as the Today-header cloud (T104). */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncErrorInfo {
  stage: string;
  code: string;
  message: string;
}

interface SyncState {
  status: SyncStatus;
  /** Epoch ms of the last successful run (mirrors settings `sync.lastSyncAt`). */
  lastSyncAt: number | null;
  /** Distinct rows waiting in the outbox. */
  pending: number;
  lastError: SyncErrorInfo | null;
  linked: boolean;
  serverUrl: string;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncAt: null,
  pending: 0,
  lastError: null,
  linked: false,
  serverUrl: '',
  set: (patch) => set(patch),
}));
