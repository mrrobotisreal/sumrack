import { repos } from '@/db';
import type { Grade } from '@/db/repositories/reviews';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { localDateKey } from '@/db/repositories/stats';
import { queryClient } from '@/lib/query-client';
import { computeStreak, gapNeedingFreezes } from '@/lib/streak';
import { track } from '@/services/analytics';
import { setMotivationHandler } from '@/services/motivation-bus';
import { useGoalPrefs } from '@/store/goal-prefs';

import {
  ACHIEVEMENTS_BY_ID,
  BANK_TARGET,
  LEVEL_ACHIEVEMENTS,
  MASTERED_STABILITY_DAYS,
  MASTERED_TARGET,
  STREAK_ACHIEVEMENTS,
} from './achievements';
import { earnsFreeze, parseFreezeState, type FreezeState } from './freeze';
import { goalIsMet } from './goal-prefs';
import { replanReminders } from './notifications';
import { useAchievementToasts } from './toast-store';
import { levelForXp, XP_TABLE, xpForRating, xpForReading } from './xp';

/**
 * The motivation orchestrator (T19): every existing write path calls one
 * small record* function here, which awards XP, bumps counters, and runs
 * the goal/streak/freeze/achievement evaluation. Everything is offline,
 * fire-and-forget-safe, and idempotent at the unlock/stamp level, so a
 * re-fired event can never double-award an achievement or a goal-met day.
 */

function invalidate(...keys: string[][]) {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
}

async function getFreezeState(): Promise<FreezeState> {
  return parseFreezeState(await repos.settings.get<unknown>(SETTING_KEYS.streakFreeze));
}

async function setFreezeState(state: FreezeState): Promise<void> {
  await repos.settings.set(SETTING_KEYS.streakFreeze, state);
}

async function unlock(id: string): Promise<void> {
  const newly = await repos.stats.unlockAchievement(id);
  if (!newly) return;
  track('achievement_unlocked', { id });
  await repos.stats.bumpDailyActivity({ xp: XP_TABLE.achievementUnlocked });
  const def = ACHIEVEMENTS_BY_ID.get(id);
  if (def) useAchievementToasts.getState().push(def);
  invalidate(['achievements'], ['motivation'], ['daily-activity']);
}

/**
 * Goal + streak evaluation — runs after every activity change and on app
 * open. Stamps goal_met_at the first moment today's counters satisfy the
 * configured goal, auto-consumes freezes to cover a coverable gap, earns
 * freezes on 7-day multiples, and unlocks streak achievements.
 */
export async function evaluateMotivation(now: Date = new Date()): Promise<void> {
  const todayKey = localDateKey(now);
  const goal = useGoalPrefs.getState().goal;

  let stateChanged = false;
  const activity = await repos.stats.getDailyActivity(todayKey);
  if (activity && activity.goalMetAt == null && goalIsMet(goal, activity)) {
    const newly = await repos.stats.markGoalMet(todayKey);
    if (newly) {
      stateChanged = true;
      track('goal_met', { reviews: activity.reviewsDone, readingMs: activity.readingMs });
    }
  }

  const [days, freezeLoaded] = await Promise.all([repos.stats.getStreakDays(), getFreezeState()]);
  let freeze = freezeLoaded;

  // Freeze auto-consumption: cover the missed day(s) immediately before
  // today, when the wallet can afford the whole gap (lib/streak rules).
  const gap = gapNeedingFreezes(todayKey, days, freeze.available);
  if (gap && gap.length > 0) {
    await repos.stats.insertFrozenDays(gap);
    for (const d of gap) days.frozen.add(d);
    freeze = { ...freeze, available: freeze.available - gap.length };
    await setFreezeState(freeze);
    stateChanged = true;
    track('streak_freeze_consumed', { days: gap.length, oldest: gap[gap.length - 1]! });
  }

  const streak = computeStreak(todayKey, days);

  if (earnsFreeze(freeze, streak, todayKey)) {
    freeze = { available: freeze.available + 1, lastEarnedOnDate: todayKey };
    await setFreezeState(freeze);
    track('streak_freeze_earned', { streak: streak.current, available: freeze.available });
  }

  for (const { id, days: threshold } of STREAK_ACHIEVEMENTS) {
    if (streak.current >= threshold) await unlock(id);
  }

  invalidate(['motivation'], ['daily-activity']);
  // Replan only when the goal/streak state actually moved — per-grade replans
  // would hammer the notification scheduler 20× per session for nothing.
  // Session ends and app foregrounds replan unconditionally (due counts).
  if (stateChanged) void replanReminders();
}

/** Count-based achievement sweep (bank size, mastery, XP level). */
export async function sweepAchievements(): Promise<void> {
  const [bankCount, mastered, totalXp] = await Promise.all([
    repos.bank.countItems(),
    repos.reviews.countMasteredLemmas(MASTERED_STABILITY_DAYS),
    repos.stats.getTotalXp(),
  ]);
  if (bankCount >= 1) await unlock('first-word');
  if (bankCount >= BANK_TARGET) await unlock('bank-100');
  if (mastered >= MASTERED_TARGET) await unlock('mastered-100');
  const { level } = levelForXp(totalXp);
  for (const { id, level: threshold } of LEVEL_ACHIEVEMENTS) {
    if (level >= threshold) await unlock(id);
  }
}

/**
 * One-time historic unlock pass (guarded by a settings flag): event-driven
 * achievements can't fire for things done BEFORE T19 shipped — but «Первая
 * история» sitting locked after five finished stories would be a lie. Runs
 * through repositories only; pron-perfect is recovered from the analytics
 * log (every graded pronunciation item since T12 carries bestScore).
 */
async function backfillHistoricAchievements(): Promise<void> {
  const FLAG = 'achievements.historyBackfilled';
  if ((await repos.settings.get<boolean>(FLAG)) === true) return;

  const [stories, entries, checkpoints, units] = await Promise.all([
    repos.reading.listProgress(),
    repos.journal.listEntries(1),
    repos.stats.listCheckpointResults(),
    repos.path.listUnitProgress(),
  ]);
  if (stories.some((s) => s.finishedAt != null)) await unlock('first-story');
  if (entries.length > 0) await unlock('first-journal');
  if (checkpoints.some((c) => c.passed)) await unlock('first-checkpoint');
  if (units.some((u) => u.completedAt != null)) await unlock('first-unit');

  const events = await repos.stats.listRecentEvents(5000);
  const perfect = events.some(
    (e) => e.event === 'pron_item_graded' && Number(e.props?.bestScore) >= 100,
  );
  if (perfect) await unlock('pron-perfect');

  await repos.settings.set(FLAG, true);
}

// --- record* entry points (called from the existing write paths) ----------

/** Every graded review, all modes — replaces the raw reviewsDone bump. */
export async function recordReviewOutcome(rating: Grade): Promise<void> {
  await repos.stats.bumpDailyActivity({ reviewsDone: 1, xp: xpForRating(rating) });
  await evaluateMotivation();
}

/** A reading session ended (reader focus loss) — replaces the readingMs bump. */
export async function recordReading(ms: number): Promise<void> {
  await repos.stats.bumpDailyActivity({ readingMs: ms, xp: xpForReading(ms) });
  await evaluateMotivation();
}

/** A story was finished for the first time — replaces the storiesFinished bump. */
export async function recordStoryFinished(): Promise<void> {
  await repos.stats.bumpDailyActivity({ storiesFinished: 1, xp: XP_TABLE.storyFinished });
  await unlock('first-story');
  await evaluateMotivation();
}

export async function recordJournalEntryCreated(): Promise<void> {
  await repos.stats.bumpDailyActivity({ xp: XP_TABLE.journalEntry });
  await unlock('first-journal');
  invalidate(['motivation'], ['daily-activity']);
}

export async function recordNoteCreated(): Promise<void> {
  await repos.stats.bumpDailyActivity({ xp: XP_TABLE.noteCreated });
  invalidate(['motivation'], ['daily-activity']);
}

export async function recordLessonCompleted(): Promise<void> {
  await repos.stats.bumpDailyActivity({ xp: XP_TABLE.lessonCompleted });
  invalidate(['motivation'], ['daily-activity']);
}

/** First pass of a unit quiz (caller already knows it's the first). */
export async function recordUnitQuizFirstPass(): Promise<void> {
  await repos.stats.bumpDailyActivity({ xp: XP_TABLE.unitQuizPassed });
  invalidate(['motivation'], ['daily-activity']);
}

export async function recordCheckpointPassed(firstPass: boolean): Promise<void> {
  if (firstPass) {
    await repos.stats.bumpDailyActivity({ xp: XP_TABLE.checkpointPassed });
  }
  await unlock('first-checkpoint');
  invalidate(['motivation'], ['daily-activity']);
}

export async function recordUnitCompleted(): Promise<void> {
  await unlock('first-unit');
}

/** Pronunciation attempt's best score for an item (0–100). */
export async function recordPronunciationScore(score: number): Promise<void> {
  if (score >= 100) await unlock('pron-perfect');
}

/** Session summary reached — count sweeps + a due-count-fresh replan. */
export async function onSessionEnded(): Promise<void> {
  await sweepAchievements();
  void replanReminders();
}

/**
 * Bootstrap hook (DbProvider, after store hydration): registers the db-layer
 * bus, evaluates the day (freeze consumption for days missed while the app
 * was closed happens HERE), and runs one sweep so nothing unlockable is left
 * pending from before T19 shipped.
 */
export async function initMotivation(): Promise<void> {
  setMotivationHandler((event) => {
    if (event === 'bank-item-added') {
      void sweepAchievements().catch((err) => console.warn('[motivation] sweep failed', err));
    }
    if (event === 'unit-completed') {
      void recordUnitCompleted().catch((err) =>
        console.warn('[motivation] unit unlock failed', err),
      );
    }
  });
  await evaluateMotivation();
  await backfillHistoricAchievements();
  await sweepAchievements();
  // Unconditional boot replan: evaluate only replans on state changes, but a
  // cold start may follow a timezone/day change (or a TZ-stale alarm set) —
  // the schedule must be rebuilt against the CURRENT local clock every boot.
  void replanReminders();
}
