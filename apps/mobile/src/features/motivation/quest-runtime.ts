import { repos } from '@/db';
import { localDateKey } from '@/db/repositories/stats';
import { isVisibleLeech, LEECH_AGAIN_MIN } from '@/features/dashboard/science/leeches';
import { useAsrStore } from '@/features/pronunciation/asr-store';
import { loadBlitzPool } from '@/features/review/games/blitz/service';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';

import {
  evaluateQuest,
  previewQuestRotation,
  type QuestEnv,
  type QuestEvaluation,
} from './quest-service';
import { useAchievementToasts } from './toast-store';
import { XP_TABLE } from './xp';

/**
 * The app-side quest runtime (T34): the production QuestEnv + one coalesced
 * `refreshQuest()` that every motivation write path calls (end of
 * `evaluateMotivation`, journal creation) and the Today `useDailyQuest`
 * query uses as its fetcher. Side effects of an evaluation (analytics, the
 * completion toast, cache updates) live here, once.
 */

export const QUEST_QUERY_KEY = ['quest'] as const;

/** T33 dictation has not shipped — flip when it lands (and its mode is 'dictation'). */
const DICTATION_SHIPPED = false;

const ENV: QuestEnv = {
  repos,
  asrInstalled: () => useAsrStore.getState().installedBytes != null,
  dictationAvailable: () => DICTATION_SHIPPED,
  visibleLeechIds: async () =>
    (await repos.dashboard.getLeechCandidates(LEECH_AGAIN_MIN))
      .filter((c) =>
        isVisibleLeech(
          {
            againCount: c.againCount,
            windowSize: c.windowSize,
            lastReviewedAt: c.lastReviewedAt,
            lastAgainAt: c.lastAgainAt,
          },
          c.dismissedAt,
        ),
      )
      .map((c) => c.cardId),
  blitzPoolSize: async () => (await loadBlitzPool(repos)).length,
};

let inFlight: Promise<QuestEvaluation | null> | null = null;
let rerun = false;

async function runOnce(): Promise<QuestEvaluation | null> {
  const todayKey = localDateKey();
  const res = await evaluateQuest(ENV, todayKey);
  const state = res.state;
  if (state) {
    if (res.assigned) {
      track('quest_assigned', {
        kind: state.kind.id,
        date: todayKey,
        available: res.available,
        target: state.target,
      });
    }
    if (res.progressed && !res.justCompleted) {
      track('quest_progress', { kind: state.kind.id, done: state.progress, target: state.target });
    }
    if (res.justCompleted) {
      const activity = await repos.stats.getDailyActivity(todayKey);
      track('quest_completed', {
        kind: state.kind.id,
        date: todayKey,
        xp: XP_TABLE.questCompleted,
        goalMet: activity?.goalMetAt != null,
      });
      useAchievementToasts.getState().push({
        id: `quest-${todayKey}`,
        kicker: 'Quest complete',
        title: state.kind.title,
        description: `+${XP_TABLE.questCompleted} XP · today's quest is done`,
        icon: 'ribbon-outline',
      });
      void queryClient.invalidateQueries({ queryKey: ['motivation'] });
      void queryClient.invalidateQueries({ queryKey: ['daily-activity'] });
    }
  }
  queryClient.setQueryData(QUEST_QUERY_KEY, res);
  return res;
}

/**
 * Evaluate today's quest. Concurrent calls join the running evaluation; a
 * call that arrives mid-run schedules exactly one follow-up so the latest
 * activity is always reflected. Never throws (a quest must never break a
 * write path) — failures log and resolve null.
 */
export function refreshQuest(): Promise<QuestEvaluation | null> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    let last: QuestEvaluation | null = null;
    do {
      rerun = false;
      try {
        last = await runOnce();
      } catch (err) {
        console.warn('[quest] evaluation failed', err);
        last = null;
      }
    } while (rerun);
    return last;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** dev-db: the read-only rotation preview over the production env (no writes). */
export function previewRotation(days: number) {
  return previewQuestRotation(ENV, localDateKey(), days);
}
