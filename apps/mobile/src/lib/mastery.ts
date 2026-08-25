/**
 * Stability-band ("mastery") definitions — T18's decision, extracted here in
 * T24 so the dashboard and the word-bank filter can never disagree:
 *
 * - Per reviewed card (reps > 0), FSRS `stability` (days) < 7 → learning
 *   ("shaky"), 7–30 → young, ≥ 30 → mature.
 * - An item's band is the band of the MINIMUM stability across its reviewed
 *   ru-en/en-ru core cards (weakest link); listening/production cards train
 *   other skills and do not vouch for "knowing" a word.
 * - No reviewed core card → collected, no band (`bandForStability(null)`).
 */

export const STABILITY_YOUNG_MIN = 7;
export const STABILITY_MATURE_MIN = 30;

/** The directions whose cards vouch for "knowing" an item (T18 decision). */
export const CORE_BAND_DIRECTIONS = ['ru-en', 'en-ru'] as const;

export type MasteryBand = 'learning' | 'young' | 'mature';

/** Band of a weakest-link core stability; null = collected, never reviewed. */
export function bandForStability(minCoreStability: number | null | undefined): MasteryBand | null {
  if (minCoreStability == null) return null;
  if (minCoreStability < STABILITY_YOUNG_MIN) return 'learning';
  if (minCoreStability < STABILITY_MATURE_MIN) return 'young';
  return 'mature';
}
