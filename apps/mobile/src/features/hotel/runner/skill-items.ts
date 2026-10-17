import type { CourseItem } from '@sumrak/schema';

/**
 * Skill-floor items in a course run (T92c, decision 8). Pure rules only; the
 * screens render through the T72 writing component and the T73 speaking
 * recorder (verified on the S25 in T93).
 *
 * - `writing` is scored by its offline provisional % (T72 `gradeWritingOffline`).
 *   ≥ 66 % counts as correct for the unit score. The AI final later updates the
 *   stored response and best % but never revokes a pass.
 * - `speaking-reply` / `speaking-situation` are correct when the judge's verdict
 *   is a pass.
 * - Floor 14 `choice` / `typed` items with `passage` / `audio` refs use the
 *   drill item's passage and audio. Floor exams allow 2 plays per audio;
 *   practice has no play limit.
 */

/** A writing answer counts as correct at or above this offline percent (decision 8). */
export const WRITING_CORRECT_PCT = 66;

/** Which skill kinds a course run renders through a skill component (not the choice/typed/trigger views). */
export function isSkillItem(item: Pick<CourseItem, 'kind'>): boolean {
  return (
    item.kind === 'writing' || item.kind === 'speaking-reply' || item.kind === 'speaking-situation'
  );
}

/** A writing item is correct when its offline provisional percent reaches the threshold. */
export function writingCorrect(offlinePct: number): boolean {
  return offlinePct >= WRITING_CORRECT_PCT;
}

/** The judge's verdict for a speaking item: correct only on a pass. */
export function speakingCorrect(verdict: 'pass' | 'fail' | 'borderline' | null): boolean {
  return verdict === 'pass';
}

/** Audio plays allowed for an item: 2 in a floor exam (official rule), unlimited in practice. */
export function maxPlaysFor(mode: 'unit' | 'floor' | 'extern'): number | undefined {
  return mode === 'unit' ? undefined : 2;
}

/**
 * The AI final may raise the stored best % and replace the response, but it
 * never revokes a pass (decision 8). Returns the pass the attempt keeps.
 */
export function keepPass(
  previouslyPassed: boolean,
  offlinePassed: boolean,
  aiPct: number,
): boolean {
  if (previouslyPassed || offlinePassed) return true;
  return writingCorrect(aiPct);
}

/**
 * The stored response for a writing item (T92d). The letter text is the answer;
 * `correct` is the offline provisional verdict (≥ 66 %). The verdict is final
 * for the run: the AI grade later raises the stored best % but never revokes it.
 */
export function writingResponse(
  text: string,
  offlinePct: number,
): { answer: { kind: 'writing'; text: string }; correct: boolean } {
  return { answer: { kind: 'writing', text }, correct: writingCorrect(offlinePct) };
}
