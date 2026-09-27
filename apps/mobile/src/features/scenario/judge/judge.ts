import type { Slot } from '@sumrak/schema';

import { scoreAttempt, scoringTokens, type WordScore } from '@/features/pronunciation/scoring';

import {
  betterHit,
  contentTokens,
  coveredTokenIndexes,
  hasNumeral,
  isContentToken,
  matchForms,
  type FormHit,
} from './slots';

/**
 * The offline judge (T60, SPEAKING_SCENARIOS §5.2, ADR-0019 decision 2):
 * one ASR transcript against one authored expectation → a verdict, the
 * branch key, per-slot hits, the paraphrase score and the per-word
 * alignment the debrief shows. Pure — no React, no DB, no I/O; fully
 * unit-tested against the fixture pack and the podcast A1 expectations.
 *
 * Meta-intents (§6) are detected BEFORE this runs (the executor's job);
 * the judge only ever sees answers.
 *
 * THE THRESHOLD (recorded, not tuned here): `SCENARIO_ACCEPT_THRESHOLD =
 * 60` — T27's spoken-choice selection number (`CHOICE_SELECTION_THRESHOLD`),
 * the same "clear majority of the target's words heard" reasoning applied to
 * a whole-utterance paraphrase. `SCENARIO_NEAR_MISS_SCORE = 40` marks an
 * attempt that clearly went for the right thing (the hint plays on miss #1
 * instead of the confused line).
 *
 * Recorded implementation decisions (deviations from the letter of §5.2):
 * - **Forms slots pick the option with the longest matched form** (token
 *   span), then the EARLIER option — §5.2's "first option whose forms hit"
 *   with one refinement: the scripts author «no = нет, не люблю» beside
 *   «yes = люблю», and first-option-wins alone would read «нет, не люблю»
 *   as yes. Catch-all options («elsewhere = из», «working = работаю») are
 *   authored last on purpose, so option order carries the priority.
 * - **A leading «не» is never an edit** («плохо» ≠ «неплохо», «давно» ≠
 *   «недавно» — `negationMismatch` in slots.ts).
 * - **The paraphrase path is exactly the design's**: a fragment of a short
 *   `accept[]` line («я люблю» against «Я люблю читать.» = 67) passes at 60
 *   with `branchKey` null ⇒ `next.default`. Authoring rule for the CT
 *   sessions (recorded in the T60 row): keep `accept[]` lines ≥ 4 words or
 *   accept that a slotless fragment takes the default branch.
 * - **Reject forms are masked out of a `free` slot's content count.** A
 *   `free minTokens=1` slot beside `REJECT: хорошо` would otherwise accept
 *   «хорошо» as a name (every reject word is a content token) and the reject
 *   group could never fire.
 */

export const SCENARIO_ACCEPT_THRESHOLD = 60;
export const SCENARIO_NEAR_MISS_SCORE = 40;
/** The hit key of a satisfied `free` slot (free slots never branch — §2.2). */
export const FREE_SLOT_KEY = 'free';
/** The hit key of a numeral hit (`number` slots and `acceptsNumber` forms slots — §2.1). */
export const NUMBER_KEY = 'number';

/** The judge's structural view of an expectation — the pack `Expectation` and T58's runtime shape both satisfy it. */
export interface JudgeExpectation {
  slots: readonly Slot[];
  accept: readonly string[];
  branchOn?: string | undefined;
  reject?: readonly { forms: readonly string[] }[] | undefined;
}

export type JudgeVerdict = 'matched' | 'miss' | 'no-speech';

export interface SlotResult {
  id: string;
  required: boolean;
  /** Option key (forms), `'number'`, `'free'`, or null when unsatisfied. */
  hit: string | null;
  /** The form that produced a forms/reject hit (authored spelling). */
  form?: string;
}

export interface JudgeResult {
  verdict: JudgeVerdict;
  /** The `branchOn` slot's hit key (or `'number'`); null ⇒ `next.default`. */
  branchKey: string | null;
  /** Slot id → hit key (the `AttemptDetail.slots` shape). */
  slots: Record<string, string | null>;
  /** Per-slot detail (the lab and the debrief's slot chips). */
  slotResults: SlotResult[];
  /** Best paraphrase score 0–100 over `accept[]`. */
  score: number;
  /** The target the per-word alignment ran against (best paraphrase or a synthesized form line). */
  target: string;
  words: WordScore[];
  nearMiss: boolean;
  /** Index into `reject[]` when the miss came from a reject group. */
  rejectIndex: number | null;
  /** What decided a match: every required slot, or the paraphrase score. */
  matchedBy: 'slots' | 'paraphrase' | null;
  /** Scoring tokens of the transcript / how many of them are content tokens (the rescue gate reads this). */
  tokenCount: number;
  contentTokenCount: number;
}

export interface JudgeContext {
  /** Override for the lab only; production uses `SCENARIO_ACCEPT_THRESHOLD`. */
  threshold?: number;
}

function judgeFormsSlot(
  slot: Extract<Slot, { kind: 'forms' }>,
  tokens: readonly string[],
): { hit: string | null; form?: string } {
  let best: { key: string; hit: FormHit } | null = null;
  for (const option of slot.options) {
    const hit = matchForms(option.forms, tokens);
    if (hit && betterHit(hit, best?.hit ?? null)) best = { key: option.key, hit };
  }
  if (best) return { hit: best.key, form: best.hit.form };
  if (slot.acceptsNumber && hasNumeral(tokens)) return { hit: NUMBER_KEY };
  return { hit: null };
}

function judgeFreeSlot(
  slot: Extract<Slot, { kind: 'free' }>,
  tokens: readonly string[],
  transcript: string,
  rejectCovered: ReadonlySet<number>,
): { hit: string | null } {
  const content = tokens.filter((t, i) => isContentToken(t) && !rejectCovered.has(i));
  if (content.length < slot.minTokens) return { hit: null };
  if (slot.cues && slot.cues.length > 0) {
    const cueHit = slot.cues.some(
      (cue) => scoreAttempt(cue, transcript).score >= SCENARIO_ACCEPT_THRESHOLD,
    );
    if (!cueHit) return { hit: null };
  }
  return { hit: FREE_SLOT_KEY };
}

/** Synthesized debrief target when no paraphrase scored: the forms that hit, else the model answer. */
function synthesizeTarget(slotResults: SlotResult[], accept: readonly string[]): string {
  const forms = slotResults.map((s) => s.form).filter((f): f is string => !!f);
  if (forms.length > 0) return forms.map((f) => f.replace(/\*$/, '')).join(' ');
  return accept[0] ?? '';
}

export function judgeAnswer(
  transcript: string,
  expectation: JudgeExpectation,
  ctx: JudgeContext = {},
): JudgeResult {
  const threshold = ctx.threshold ?? SCENARIO_ACCEPT_THRESHOLD;
  const tokens = scoringTokens(transcript);
  const contentCount = contentTokens(tokens).length;

  // 1. Nothing heard.
  if (tokens.length === 0) {
    return {
      verdict: 'no-speech',
      branchKey: null,
      slots: Object.fromEntries(expectation.slots.map((s) => [s.id, null])),
      slotResults: expectation.slots.map((s) => ({ id: s.id, required: s.required, hit: null })),
      score: 0,
      target: expectation.accept[0] ?? '',
      words: [],
      nearMiss: false,
      rejectIndex: null,
      matchedBy: null,
      tokenCount: 0,
      contentTokenCount: 0,
    };
  }

  // 3. Reject scan (the verdict is applied after the slots are known).
  const rejects = expectation.reject ?? [];
  let rejectIndex: number | null = null;
  for (let i = 0; i < rejects.length; i++) {
    if (matchForms(rejects[i]!.forms, tokens)) {
      rejectIndex = i;
      break;
    }
  }
  const rejectCovered =
    rejectIndex === null
      ? new Set<number>()
      : coveredTokenIndexes(rejects[rejectIndex]!.forms, tokens);

  // 4. Slots.
  const slotResults: SlotResult[] = expectation.slots.map((slot) => {
    if (slot.kind === 'forms') {
      const r = judgeFormsSlot(slot, tokens);
      return {
        id: slot.id,
        required: slot.required,
        hit: r.hit,
        ...(r.form ? { form: r.form } : {}),
      };
    }
    if (slot.kind === 'free') {
      return {
        id: slot.id,
        required: slot.required,
        ...judgeFreeSlot(slot, tokens, transcript, rejectCovered),
      };
    }
    return { id: slot.id, required: slot.required, hit: hasNumeral(tokens) ? NUMBER_KEY : null };
  });
  const slots = Object.fromEntries(slotResults.map((s) => [s.id, s.hit]));
  const required = slotResults.filter((s) => s.required);
  const anyRequiredHit = required.some((s) => s.hit !== null);
  const allRequiredHit = required.length > 0 && required.every((s) => s.hit !== null);

  // 5. Paraphrase score — max over accept[], best target kept for the debrief.
  let score = 0;
  let bestTarget: string | null = null;
  for (const accept of expectation.accept) {
    const s = scoreAttempt(accept, transcript).score;
    if (bestTarget === null || s > score) {
      score = s;
      bestTarget = accept;
    }
  }
  const target =
    score > 0 && bestTarget ? bestTarget : synthesizeTarget(slotResults, expectation.accept);
  const words = scoreAttempt(target, transcript).words;

  // 7. Branch key from the branchOn slot (also reported on a miss — the rescue may confirm it).
  const branchSlot = expectation.branchOn
    ? slotResults.find((s) => s.id === expectation.branchOn)
    : undefined;
  const branchKey = branchSlot?.hit ?? null;

  const nearMiss = score >= SCENARIO_NEAR_MISS_SCORE || anyRequiredHit;

  // 3 (verdict). A reject hit with no required slot satisfied is a miss, whatever the paraphrase says.
  if (rejectIndex !== null && !anyRequiredHit) {
    return {
      verdict: 'miss',
      branchKey: null,
      slots,
      slotResults,
      score,
      target,
      words,
      nearMiss,
      rejectIndex,
      matchedBy: null,
      tokenCount: tokens.length,
      contentTokenCount: contentCount,
    };
  }

  // 6. Verdict.
  const matchedBy = allRequiredHit ? 'slots' : score >= threshold ? 'paraphrase' : null;
  return {
    verdict: matchedBy ? 'matched' : 'miss',
    branchKey: matchedBy ? branchKey : branchKey,
    slots,
    slotResults,
    score,
    target,
    words,
    nearMiss: matchedBy ? false : nearMiss,
    rejectIndex: matchedBy ? null : rejectIndex,
    matchedBy,
    tokenCount: tokens.length,
    contentTokenCount: contentCount,
  };
}
