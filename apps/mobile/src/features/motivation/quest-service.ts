import type { Repositories } from '@/db/repositories';
import type { DailyQuestRow } from '@/db/repositories/quests';
import { addDaysToKey, localDayWindow } from '@/lib/dates';

import {
  availableKinds,
  pickQuestKind,
  QUEST_KINDS_BY_ID,
  questProgress,
  type QuestContext,
  type QuestKind,
} from './quests';
import { XP_TABLE } from './xp';

/**
 * Daily-quest orchestration (T34): gather the facts → assign the day's quest
 * once (deterministic pick, persisted) → persist progress → complete once
 * with XP. Dependencies are injected (repos + environment probes) so the
 * whole flow runs against `createTestDb()` with an injected day key — the
 * T19 date-injection testing pattern.
 *
 * INDEPENDENCE FROM THE GOAL (recorded): completion writes ONLY
 * `daily_quests.completed_at/xp` and the XP counter
 * (`daily_activity.xp` via bumpDailyActivity). It never calls markGoalMet,
 * never reads the goal config, never touches frozen_days — quests never gate
 * or grant the streak. (T19's evaluateMotivation still runs after any
 * activity; it stamps goal_met_at only from reviews/reading counters.)
 */

export interface QuestEnv {
  repos: Pick<Repositories, 'quests' | 'stats' | 'dashboard' | 'bank'>;
  asrInstalled: () => boolean;
  /** T33 dictation shipped — false until it does. */
  dictationAvailable: () => boolean;
  /** Visible leech card ids (T38 rule + dismissals applied). */
  visibleLeechIds: () => Promise<string[]>;
  blitzPoolSize: () => Promise<number>;
  now?: () => number;
}

/** What the UI renders for today's quest. */
export interface QuestState {
  date: string;
  kind: QuestKind;
  row: DailyQuestRow;
  progress: number;
  target: number;
  complete: boolean;
}

export interface QuestEvaluation {
  /** null = no kind available today (the ring stays two-segment). */
  state: QuestState | null;
  /** True when this evaluation created today's row. */
  assigned: boolean;
  /** True when this evaluation stamped completion (fire toast + event once). */
  justCompleted: boolean;
  /** Progress moved since the persisted value. */
  progressed: boolean;
  /** Available kinds at evaluation time (analytics). */
  available: number;
}

export async function gatherQuestContext(env: QuestEnv, todayKey: string): Promise<QuestContext> {
  const w = localDayWindow(todayKey);
  const q = env.repos.quests;
  const [
    unfinishedStories,
    productionCards,
    visibleLeechIds,
    blitzPoolSize,
    storiesFinished,
    pronunciationGrades,
    journalEntries,
    dictationSessions,
    blitzSprints,
    numbersRounds,
  ] = await Promise.all([
    q.countUnfinishedStories(),
    q.countProductionCards(),
    env.visibleLeechIds(),
    env.blitzPoolSize(),
    q.countStoriesFinished(w),
    q.countPronunciationGrades(w),
    q.countJournalEntries(w),
    q.countFinishedSessions('dictation', w),
    q.countFinishedSessions('match-blitz', w, { completedOnly: true }),
    q.countFinishedSessions('numbers', w, { completedOnly: true }),
  ]);
  return {
    unfinishedStories,
    asrInstalled: env.asrInstalled(),
    productionCards,
    dictationAvailable: env.dictationAvailable(),
    blitzPoolSize,
    visibleLeechIds,
    today: {
      storiesFinished,
      pronunciationGrades,
      journalEntries,
      dictationSessions,
      blitzSprints,
      numbersRounds,
    },
  };
}

/**
 * Evaluate today's quest: assign if unassigned (and a kind is available),
 * refresh progress, complete once. Idempotent — re-running never re-assigns,
 * never double-awards.
 */
export async function evaluateQuest(env: QuestEnv, todayKey: string): Promise<QuestEvaluation> {
  const { quests, stats } = env.repos;
  const now = env.now?.() ?? Date.now();
  const ctx = await gatherQuestContext(env, todayKey);
  const avail = availableKinds(ctx);

  let row = await quests.get(todayKey);
  let assigned = false;
  if (!row) {
    const yesterday = await quests.get(addDaysToKey(todayKey, -1));
    const kindId = pickQuestKind(todayKey, avail, yesterday?.kind ?? null);
    if (!kindId)
      return {
        state: null,
        assigned: false,
        justCompleted: false,
        progressed: false,
        available: 0,
      };
    const kind = QUEST_KINDS_BY_ID.get(kindId)!;
    const res = await quests.assign({
      date: todayKey,
      kind: kindId,
      target: Math.max(1, kind.target(ctx)),
      snapshot: kind.snapshot ? kind.snapshot(ctx) : null,
      assignedAt: now,
    });
    row = res.row;
    assigned = res.created;
  }

  const kind = QUEST_KINDS_BY_ID.get(row.kind);
  // A row from a kind this build no longer knows: show nothing, never crash.
  if (!kind)
    return {
      state: null,
      assigned,
      justCompleted: false,
      progressed: false,
      available: avail.length,
    };

  const view = { target: row.target, snapshot: row.snapshot ?? null };
  let justCompleted = false;
  let progressed = false;
  if (row.completedAt == null) {
    const progress = questProgress(kind, ctx, view);
    if (progress >= row.target) {
      justCompleted = await quests.markCompleted(todayKey, progress, XP_TABLE.questCompleted, now);
      if (justCompleted) await stats.bumpDailyActivity({ xp: XP_TABLE.questCompleted }, todayKey);
    } else if (progress !== row.progress) {
      await quests.setProgress(todayKey, progress);
      progressed = true;
    }
    if (justCompleted || progressed) row = (await quests.get(todayKey)) ?? row;
  }

  const progress = row.completedAt != null ? row.target : row.progress;
  return {
    state: {
      date: todayKey,
      kind,
      row,
      progress,
      target: row.target,
      complete: row.completedAt != null,
    },
    assigned,
    justCompleted,
    progressed: progressed || justCompleted,
    available: avail.length,
  };
}
