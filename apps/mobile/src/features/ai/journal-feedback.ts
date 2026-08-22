import { create } from 'zustand';

import { repos } from '@/db';
import { queryKeys } from '@/db/hooks';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import { isOnline } from './connectivity';
import { processFeedbackQueue, type EntryFeedbackState } from './queue-core';
import { runChat } from './runner';

/**
 * Journal feedback (ticket feature 1): production wiring of the pure
 * queue in queue-core.ts. The DURABLE queue is `journal_entries.
 * feedbackStatus` itself — a 'queued' row IS a pending request (T15's
 * states used exactly: none → queued → done). Per-entry ephemeral phase
 * (sending/error) lives in the zustand store below, mirroring how T07
 * splits durable sync_state from its progress store.
 *
 * The pump runs on app start, on foreground, on connectivity regained
 * (use-ai-queue.ts), and on demand from retry buttons.
 */

interface AiQueueState {
  byEntry: Record<string, EntryFeedbackState>;
  setEntry: (entryId: string, state: EntryFeedbackState) => void;
  clearEntry: (entryId: string) => void;
}

export const useAiQueue = create<AiQueueState>((set) => ({
  byEntry: {},
  setEntry: (entryId, state) => set((s) => ({ byEntry: { ...s.byEntry, [entryId]: state } })),
  clearEntry: (entryId) =>
    set((s) => {
      const { [entryId]: _, ...rest } = s.byEntry;
      return { byEntry: rest };
    }),
}));

let pumpInFlight: Promise<number> | null = null;

/** Drain the queue; concurrent triggers join the in-flight pass (T07 pattern). */
export function pumpFeedbackQueue(): Promise<number> {
  if (pumpInFlight) return pumpInFlight;
  pumpInFlight = processFeedbackQueue({
    listQueued: async () => {
      const rows = await repos.journal.listEntriesByStatus('queued');
      return rows.map((r) => ({ id: r.id, ru: r.ru }));
    },
    saveDone: async (entryId, storedJson) => {
      await repos.journal.setFeedback(entryId, 'done', storedJson);
      invalidateEntry(entryId);
    },
    chat: (req) => runChat('journal-feedback', req),
    isOnline,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onPhase: (entryId, state) => {
      const store = useAiQueue.getState();
      if (state) store.setEntry(entryId, state);
      else store.clearEntry(entryId);
    },
    now: () => Date.now(),
  }).finally(() => {
    pumpInFlight = null;
  });
  return pumpInFlight;
}

/** User action: request (or re-request) feedback for an entry. */
export async function requestFeedback(entryId: string): Promise<void> {
  // Re-requests replace: old feedback clears when the row goes 'queued'.
  await repos.journal.setFeedback(entryId, 'queued');
  useAiQueue.getState().setEntry(entryId, { phase: 'queued' });
  track('ai_request_queued', { feature: 'journal-feedback' });
  track('journal_feedback_requested', { entryId });
  invalidateEntry(entryId);
  void pumpFeedbackQueue();
}

/** User action: cancel a pending request (row back to 'none'). */
export async function cancelFeedback(entryId: string): Promise<void> {
  await repos.journal.setFeedback(entryId, 'none');
  useAiQueue.getState().clearEntry(entryId);
  track('journal_feedback_cancelled', { entryId });
  invalidateEntry(entryId);
}

function invalidateEntry(entryId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.journalEntries });
  void queryClient.invalidateQueries({ queryKey: queryKeys.journalEntry(entryId) });
}
