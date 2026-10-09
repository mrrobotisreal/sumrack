import { create } from 'zustand';

import { repos } from '@/db';
import { configureReviewScheduler } from '@/db/repositories/reviews';
import { SETTING_KEYS } from '@/db/repositories/settings';
import {
  parseOptimizerFile,
  parseRetention,
  parseStoredParams,
  RETENTION_DEFAULT,
  type StoredFsrsParams,
} from '@/features/review/fsrs-settings';
import { track } from '@/services/analytics';

/**
 * FSRS control prefs (T39). Same pattern as daily-prefs: hydrated once by
 * DbProvider (BEFORE any session can grade — the scheduler is configured
 * here), setters write through to the settings table fire-and-forget. Every
 * change reconfigures the live scheduler, so the next grade uses it.
 */
interface FsrsPrefsState {
  desiredRetention: number;
  params: StoredFsrsParams | null;
  setDesiredRetention: (value: number) => void;
  importParams: (text: string) => { ok: true } | { ok: false; reason: string };
  revertParams: () => void;
}

function apply(desiredRetention: number, params: StoredFsrsParams | null) {
  configureReviewScheduler({ desiredRetention, w: params?.w ?? null });
}

export const useFsrsPrefs = create<FsrsPrefsState>((set, get) => ({
  desiredRetention: RETENTION_DEFAULT,
  params: null,

  setDesiredRetention: (raw) => {
    const previous = get().desiredRetention;
    const desiredRetention = parseRetention(raw);
    set({ desiredRetention });
    apply(desiredRetention, get().params);
    track('fsrs_retention_changed', { value: desiredRetention, previous });
    void repos.settings.set(SETTING_KEYS.fsrsDesiredRetention, desiredRetention);
  },

  importParams: (text) => {
    const result = parseOptimizerFile(text);
    if (!result.ok) {
      track('fsrs_params_rejected', { reason: result.reason.slice(0, 80) });
      return { ok: false, reason: result.reason };
    }
    const file = result.value;
    const params: StoredFsrsParams = {
      v: 1,
      w: file.w,
      fittedAt: file.fittedAt,
      importedAt: Date.now(),
      reviewCount: file.reviewCount,
      cardCount: file.cardCount,
      ...(file.logLoss !== undefined ? { logLoss: file.logLoss } : {}),
      ...(file.rmse !== undefined ? { rmse: file.rmse } : {}),
    };
    set({ params });
    apply(get().desiredRetention, params);
    track('fsrs_params_applied', {
      reviewCount: file.reviewCount,
      cardCount: file.cardCount,
      ...(file.logLoss !== undefined ? { logLoss: file.logLoss } : {}),
    });
    void repos.settings.set(SETTING_KEYS.fsrsParams, params);
    return { ok: true };
  },

  revertParams: () => {
    set({ params: null });
    apply(get().desiredRetention, null);
    track('fsrs_params_reverted', {});
    void repos.settings.remove(SETTING_KEYS.fsrsParams);
  },
}));

/**
 * Load persisted FSRS prefs and configure the live scheduler (called by
 * DbProvider before any session can grade). Corrupt values heal to defaults.
 */
export async function hydrateFsrsPrefsFromDb(): Promise<void> {
  const [rawRetention, rawParams] = await Promise.all([
    repos.settings.get<unknown>(SETTING_KEYS.fsrsDesiredRetention),
    repos.settings.get<unknown>(SETTING_KEYS.fsrsParams),
  ]);
  const desiredRetention = parseRetention(rawRetention ?? RETENTION_DEFAULT);
  const params = parseStoredParams(rawParams);
  useFsrsPrefs.setState({ desiredRetention, params });
  apply(desiredRetention, params);
}
