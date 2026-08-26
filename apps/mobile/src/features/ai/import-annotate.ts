import { create } from 'zustand';

import { repos } from '@/db';
import { importQueryKeys } from '@/features/import/import-service';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import { isOnline } from './connectivity';
import {
  annotateSentences,
  parseEnvelope,
  processAnnotateQueue,
  type AnnotationEnvelope,
  type RequestAnnotateState,
} from './import-annotate-core';
import { runChat } from './runner';

/**
 * Wired import annotation (T29): production wiring of the pure queue in
 * import-annotate-core.ts, mirroring journal-feedback.ts exactly. The
 * DURABLE queue is `import_requests.status` itself — a 'queued' row IS a
 * pending annotation request (T28's lifecycle); durable per-sentence
 * progress lives in `annotationJson`; the ephemeral sending/error phase
 * lives in the zustand store below. Analytics carry counts and codes ONLY
 * — never text content (T16/T28 policy).
 */

interface ImportAnnotateQueueState {
  byRequest: Record<string, RequestAnnotateState>;
  setRequest: (requestId: string, state: RequestAnnotateState) => void;
  clearRequest: (requestId: string) => void;
}

export const useImportAnnotateQueue = create<ImportAnnotateQueueState>((set) => ({
  byRequest: {},
  setRequest: (requestId, state) =>
    set((s) => ({ byRequest: { ...s.byRequest, [requestId]: state } })),
  clearRequest: (requestId) =>
    set((s) => {
      const { [requestId]: _, ...rest } = s.byRequest;
      return { byRequest: rest };
    }),
}));

function invalidateRequests() {
  void queryClient.invalidateQueries({ queryKey: importQueryKeys.requests });
}

const passDeps = {
  chat: (req: Parameters<typeof runChat>[1]) => runChat('import-annotate', req),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  onRetry: (count: number) => track('import_annotate_retry', { sentences: count }),
};

let pumpInFlight: Promise<number> | null = null;

/** Drain queued import requests; concurrent triggers join the in-flight pass. */
export function pumpImportAnnotateQueue(): Promise<number> {
  if (pumpInFlight) return pumpInFlight;
  pumpInFlight = processAnnotateQueue({
    ...passDeps,
    listQueued: async () => {
      const rows = await repos.imports.listRequests(['queued']);
      return rows.map((r) => ({ id: r.id, text: r.text, annotationJson: r.annotationJson }));
    },
    saveEnvelope: async (requestId, envelopeJson) => {
      await repos.imports.updateRequest(requestId, { annotationJson: envelopeJson });
      invalidateRequests();
    },
    markAnnotated: async (requestId, envelopeJson) => {
      await repos.imports.updateRequest(requestId, {
        status: 'annotated',
        annotationJson: envelopeJson,
        error: null,
      });
      invalidateRequests();
    },
    isOnline,
    onPhase: (requestId, state) => {
      const store = useImportAnnotateQueue.getState();
      if (state) store.setRequest(requestId, state);
      else store.clearRequest(requestId);
    },
    onRequestDone: (_requestId, stats) => {
      track('import_annotate_completed', { sentences: stats.sentences, flagged: stats.flagged });
    },
    onRequestFailed: (_requestId, code) => {
      track('import_annotate_failed', { code });
    },
  }).finally(() => {
    pumpInFlight = null;
  });
  return pumpInFlight;
}

/** Read a request's parsed envelope (review screen + intake progress). */
export async function getRequestEnvelope(requestId: string): Promise<AnnotationEnvelope | null> {
  const row = await repos.imports.getRequest(requestId);
  return row ? parseEnvelope(row.annotationJson) : null;
}

/**
 * Persist a pure envelope edit (merge/split/delete from review). Nothing
 * here touches content tables — the envelope lives on the request row.
 */
export async function saveEnvelopeEdit(
  requestId: string,
  edit: (env: AnnotationEnvelope) => AnnotationEnvelope,
): Promise<AnnotationEnvelope | null> {
  const env = await getRequestEnvelope(requestId);
  if (!env) return null;
  const next = edit(env);
  await repos.imports.updateRequest(requestId, { annotationJson: JSON.stringify(next) });
  invalidateRequests();
  return next;
}

/**
 * Re-annotate specific sentences right now (review's per-sentence re-run;
 * also covers pending sentences created by boundary edits). Online-only:
 * throws AiError for the screen to render via friendlyAiMessage.
 */
export async function rerunSentences(requestId: string, uids: string[]): Promise<void> {
  const env = await getRequestEnvelope(requestId);
  if (!env) throw new Error('annotation not found for this request');
  track('import_annotate_rerun', { sentences: uids.length });
  const next = await annotateSentences(passDeps, env, uids);
  await repos.imports.updateRequest(requestId, { annotationJson: JSON.stringify(next) });
  invalidateRequests();
}
