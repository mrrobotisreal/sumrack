import type { CompletedLearningSession } from '@/db/repositories/learning-sessions';
import type { CaseAttempt, CaseDraft, CaseFile } from './model';
import { CASE_FILE_MODE, CaseDraftSchema, finishCaseAttempt, parseAttempts } from './model';

/** Only completed game-session writes; no card/review or reading-progress dependencies. */
export interface CaseSessionStore {
  recordCompleted(input: CompletedLearningSession): Promise<unknown>;
  list(mode: string, limit?: number): Promise<{ detail: unknown }[]>;
}

const saves = new WeakMap<CaseSessionStore, Map<string, Promise<CaseAttempt>>>();

export function saveCaseAttempt(
  store: CaseSessionStore,
  file: CaseFile,
  draft: CaseDraft,
  now = Date.now(),
): Promise<CaseAttempt> {
  const active = saves.get(store) ?? new Map<string, Promise<CaseAttempt>>();
  saves.set(store, active);
  const prior = active.get(draft.id);
  if (prior) return prior;
  const pending = saveOnce(store, file, draft, now).finally(() => active.delete(draft.id));
  active.set(draft.id, pending);
  return pending;
}

async function saveOnce(
  store: CaseSessionStore,
  file: CaseFile,
  draft: CaseDraft,
  now: number,
): Promise<CaseAttempt> {
  const previous = parseAttempts(await store.list(CASE_FILE_MODE, 10000));
  const existing = previous.find((p) => p.id === draft.id);
  if (existing) return existing;
  const attempt = finishCaseAttempt(file, draft, previous, now);
  await store.recordCompleted({
    id: attempt.id,
    mode: CASE_FILE_MODE,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    itemCount: attempt.itemCount,
    correctCount: attempt.correctCount,
    detail: attempt,
  });
  // A concurrent duplicate submit may have won; always show the immutable winner.
  return (
    parseAttempts(await store.list(CASE_FILE_MODE, 10000)).find((p) => p.id === draft.id) ?? attempt
  );
}

interface DraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Device-local autosave; serialized writes prevent a late keystroke restoring a submitted draft. */
export function createCaseDraftStore(storage: DraftStorage, file: CaseFile) {
  const key = `sumrak:case-file-draft:v1:${file.id}`;
  let pending = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    const result = pending.catch(() => undefined).then(write);
    pending = result;
    return result;
  };
  return {
    async read(): Promise<CaseDraft | null> {
      const raw = await storage.getItem(key);
      if (!raw) return null;
      try {
        const result = CaseDraftSchema.safeParse(JSON.parse(raw));
        return result.success &&
          result.data.caseId === file.id &&
          result.data.revision === file.revision
          ? result.data
          : null;
      } catch {
        return null;
      }
    },
    write(draft: CaseDraft) {
      const serialized = JSON.stringify(CaseDraftSchema.parse(draft));
      return enqueue(() => storage.setItem(key, serialized));
    },
    clear() {
      return enqueue(() => storage.removeItem(key));
    },
  };
}
