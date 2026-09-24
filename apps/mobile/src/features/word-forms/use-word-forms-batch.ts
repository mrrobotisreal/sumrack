import { create } from 'zustand';

import type { BatchProgress } from './batch-core';

/**
 * Ephemeral batch progress (WORD_FORMS §7.5): what the Словарь row shows
 * while a batch runs. The DURABLE state is the `grammar.batch` settings
 * row (batch-service.ts) — this store only mirrors it for the UI, the way
 * `useAiQueue` mirrors journal feedback phases.
 */
interface WordFormsBatchState extends BatchProgress {
  /** True once the service has read the row at least once this launch. */
  hydrated: boolean;
  setProgress: (progress: BatchProgress) => void;
}

export const IDLE_PROGRESS: BatchProgress = {
  phase: 'idle',
  done: 0,
  failed: 0,
  remaining: 0,
  count: 0,
  currentHeadword: null,
  pauseReason: null,
};

export const useWordFormsBatch = create<WordFormsBatchState>((set) => ({
  ...IDLE_PROGRESS,
  hydrated: false,
  setProgress: (progress) => set({ ...progress, hydrated: true }),
}));
