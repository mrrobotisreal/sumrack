import { Rating, type Grade } from 'ts-fsrs';

import { repos } from '@/db';
import { normalizeRu } from '@/db/normalize';
import type { ScenarioTurnRuntime } from '@/db/repositories/scenarios';
import { recordReviewOutcome } from '@/features/motivation/service';
import { pronunciationScoreToRating } from '@/features/pronunciation/scoring';

import type { JudgeResult } from './judge/judge';

/**
 * FSRS write for a matched/rescued scenario turn (T60, SPEAKING_SCENARIOS
 * §5.4 — the T27 `grade-spoken-choice` pattern): for each slot option that
 * HIT, its `lemma` → an existing bank item → its `production` card →
 * `gradeCard(rating, { source: 'scenario' })` + the motivation bump.
 *
 * Rating = T12's `pronunciationScoreToRating(score)` CAPPED AT GOOD (the
 * mapping never emits Easy anyway; the cap is the recorded guarantee). A
 * miss writes nothing — the debrief's «Practice these» adds missed lemmas
 * to the bank instead, never automatically. Free-slot and numeral hits
 * carry no lemma and grade nothing.
 */

export const SCENARIO_MAX_RATING: Grade = Rating.Good;

/** Pure: the grade for a matched turn — T12's mapping, never above Good. */
export function scenarioRating(score: number): Grade {
  const rating = pronunciationScoreToRating(score);
  return rating > SCENARIO_MAX_RATING ? SCENARIO_MAX_RATING : rating;
}

/** Pure: the lemmas actually produced — every forms-slot option whose key hit, deduped ё/е-tolerantly. */
export function producedLemmas(
  turn: Pick<ScenarioTurnRuntime, 'expect'>,
  judge: Pick<JudgeResult, 'slots'>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slot of turn.expect?.slots ?? []) {
    if (slot.kind !== 'forms') continue;
    const key = judge.slots[slot.id];
    if (!key) continue;
    const option = slot.options.find((o) => o.key === key);
    if (!option) continue;
    const norm = normalizeRu(option.lemma);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(option.lemma);
  }
  return out;
}

/** Grade the production cards of the lemmas a matched turn produced. Returns how many cards were graded. */
export async function gradeSpokenTurn(
  turn: Pick<ScenarioTurnRuntime, 'expect'>,
  judge: Pick<JudgeResult, 'slots' | 'score' | 'verdict'>,
): Promise<number> {
  if (judge.verdict !== 'matched') return 0;
  const rating = scenarioRating(judge.score);
  let graded = 0;
  for (const lemma of producedLemmas(turn, judge)) {
    const item = await repos.bank.findWordByLemma(lemma);
    if (!item) continue;
    const card = await repos.reviews.getGradableCard(item.id, 'production');
    if (!card) continue;
    await repos.reviews.gradeCard(card.id, rating, { source: 'scenario' });
    await recordReviewOutcome(rating);
    graded += 1;
  }
  return graded;
}
