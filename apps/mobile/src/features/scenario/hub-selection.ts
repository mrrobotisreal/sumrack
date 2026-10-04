import type { ScenarioFamily, ScenarioRung, ScenarioRunStats } from '@/db/repositories/scenarios';

/**
 * Pure hub / Today-card selection (T62, SPEAKING_SCENARIOS §9.1): which rung
 * the Today card offers, what a rung chip shows, and where «Следующий
 * уровень» points. No React, no DB — tested directly.
 */

export const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

export function levelRank(level: string): number {
  const i = (LEVEL_ORDER as readonly string[]).indexOf(level);
  return i < 0 ? LEVEL_ORDER.length : i;
}

/** A rung finished at least once (its bestStats exist only for finished runs). */
export function isFinished(rung: Pick<ScenarioRung, 'bestStats'>): boolean {
  return rung.bestStats !== null;
}

/** A clean run exists: every answered turn clean (no miss/lifeline/skip/rescue). */
export function isClean(stats: ScenarioRunStats | null): boolean {
  return stats !== null && stats.turns > 0 && stats.cleanTurns === stats.turns;
}

/** `cleanTurns / turns` of the best run, 0 for none (the Today card's tiebreak). */
export function cleanRatio(stats: ScenarioRunStats | null): number {
  if (!stats || stats.turns === 0) return 0;
  return stats.cleanTurns / stats.turns;
}

/** Whether the rung has an unfinished run that can be continued in place. */
export function isResumable(rung: Pick<ScenarioRung, 'lastRun'>): boolean {
  return rung.lastRun !== null && rung.lastRun.finishedAt === null;
}

/**
 * §9.1: the Today card = the next unplayed rung (families in hub order,
 * rungs A1 → C1), else the rung with the lowest best clean ratio (ties →
 * the earlier one); null when no scenario pack is installed.
 */
export function pickTodayScenario(families: readonly ScenarioFamily[]): ScenarioRung | null {
  const rungs = families.flatMap((f) => f.rungs);
  if (rungs.length === 0) return null;
  const unplayed = rungs.find((r) => !isFinished(r));
  if (unplayed) return unplayed;
  let best: ScenarioRung = rungs[0]!;
  for (const r of rungs.slice(1)) {
    if (cleanRatio(r.bestStats) < cleanRatio(best.bestStats)) best = r;
  }
  return best;
}

/** «Следующий уровень»: the installed rung of the same family one level up (or the next higher), null when none. */
export function nextRung(
  families: readonly ScenarioFamily[],
  current: Pick<ScenarioRung, 'familyId' | 'level'>,
): ScenarioRung | null {
  const family = families.find((f) => f.familyId === current.familyId);
  if (!family) return null;
  const rank = levelRank(current.level);
  return (
    family.rungs
      .filter((r) => levelRank(r.level) > rank)
      .sort((a, b) => levelRank(a.level) - levelRank(b.level))[0] ?? null
  );
}

export type RungChipState = 'new' | 'finished' | 'clean';

export function rungChipState(rung: Pick<ScenarioRung, 'bestStats'>): RungChipState {
  if (isClean(rung.bestStats)) return 'clean';
  return isFinished(rung) ? 'finished' : 'new';
}

/** The family's first rung (its card's title/brief/host come from here). */
export function familyLead(family: ScenarioFamily): ScenarioRung | null {
  return family.rungs[0] ?? null;
}

/**
 * The rung a family card pre-selects before the user touches a level chip
 * (Mitch 2026-10-04): a resumable run wins, else the first unfinished rung,
 * else the lowest rung. Every rung stays selectable — finishing A1 never
 * hides it behind A2; the chips are a level picker, not a progress readout.
 */
export function defaultRung(family: Pick<ScenarioFamily, 'rungs'>): ScenarioRung | null {
  return (
    family.rungs.find(isResumable) ??
    family.rungs.find((r) => !isFinished(r)) ??
    family.rungs[0] ??
    null
  );
}
