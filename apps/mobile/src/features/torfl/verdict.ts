import type { ExamSubtestKind } from '@sumrak/schema';

import type { ExamVerdict } from './model';
import { SUBTEST_ORDER } from './topics';

/**
 * The SPbU verdict (T71, TORFL_EXAM_PREP §6.3) — PURE. One rule, three
 * callers: the results card (`verdict()`), readiness's «Сейчас: сдал бы» line
 * (`predictVerdict()`, unknown = fail) and the achievements.
 *
 *   every pct ≥ 66                                    → 'pass'
 *   exactly one pct in [60, 66), the other four ≥ 66  → 'pass-borderline'
 *   anything else                                     → 'fail'
 *
 * On a fail, `retake` names the subtests under 66 — except that ONE
 * borderline (60 ≤ pct < 66, the best of them) is «spent»: it was the one
 * allowed shortfall, so it is not asked to be retaken when the failure comes
 * from elsewhere. Order = the official subtest order.
 */

export const PASS_PCT = 66;
export const BORDERLINE_PCT = 60;

export type VerdictPcts = Partial<Record<ExamSubtestKind, number | null>>;

export interface VerdictOutcome {
  verdict: ExamVerdict;
  retake: ExamSubtestKind[];
}

/**
 * Pure §6.3 over five pcts; a missing / null pct counts as a fail (the
 * readiness estimate: «unknown» can never predict a pass).
 */
export function predictVerdict(pcts: VerdictPcts): VerdictOutcome {
  const values = SUBTEST_ORDER.map((kind) => ({ kind, pct: pcts[kind] ?? null }));
  const below66 = values.filter((v) => v.pct === null || v.pct < PASS_PCT);
  if (below66.length === 0) return { verdict: 'pass', retake: [] };
  const first = below66[0]!;
  if (below66.length === 1 && first.pct !== null && first.pct >= BORDERLINE_PCT) {
    return { verdict: 'pass-borderline', retake: [] };
  }
  const borderline = below66
    .filter((v) => v.pct !== null && v.pct >= BORDERLINE_PCT)
    .sort((a, b) => b.pct! - a.pct!);
  const spent = borderline[0]?.kind;
  const retake = below66.filter((v) => v.kind !== spent).map((v) => v.kind);
  return { verdict: 'fail', retake };
}

export interface FullVerdict {
  /** null while any of the five subtests has no score (the card says «после Письма и Говорения»). */
  verdict: ExamVerdict | null;
  retake: ExamSubtestKind[];
  /** True when a writing / speaking pct behind the verdict is still the offline guess (T72/T73 AI upgrade pending). */
  provisional: boolean;
  /** Subtests with no score yet, in official order. */
  missing: ExamSubtestKind[];
}

/**
 * The results card's verdict: `null` when any of the five is missing
 * (skipped placeholders, a single-subtest scope). `provisional` is OR-ed
 * over the subtests flagged in `provisionalKinds`.
 */
export function verdict(
  pcts: VerdictPcts,
  provisionalKinds: Partial<Record<ExamSubtestKind, boolean>> = {},
): FullVerdict {
  const missing = SUBTEST_ORDER.filter((k) => pcts[k] === null || pcts[k] === undefined);
  if (missing.length > 0) return { verdict: null, retake: [], provisional: false, missing };
  const { verdict: v, retake } = predictVerdict(pcts);
  const provisional = SUBTEST_ORDER.some((k) => provisionalKinds[k] === true);
  return { verdict: v, retake, provisional, missing: [] };
}

/** SPbU phrasing of a verdict (§6.3): «Сертификат: выдан бы» … */
export function verdictHeadline(v: ExamVerdict, retake: readonly ExamSubtestKind[]): string {
  if (v === 'pass') return 'Сертификат: выдан бы';
  if (v === 'pass-borderline') return 'Сертификат: выдан бы (один субтест на грани)';
  return retake.length > 0 ? 'Нужно пересдать' : 'Нужно пересдать экзамен';
}
