import type { MonotonicRule, TableSpec } from './registry';

/**
 * Field-wise merges for the `monotonic` class (T104 G): the result never moves
 * backwards relative to either input. Pure — tested on their own and used by
 * the apply path.
 */
type Row = Record<string, unknown>;

function pickNum(rule: MonotonicRule, a: unknown, b: unknown): unknown {
  const an = typeof a === 'number' ? a : null;
  const bn = typeof b === 'number' ? b : null;
  switch (rule) {
    case 'max':
    case 'maxNonNull':
      if (an == null) return bn;
      if (bn == null) return an;
      return Math.max(an, bn);
    case 'min':
    case 'minNonNull':
      if (an == null) return bn;
      if (bn == null) return an;
      return Math.min(an, bn);
    case 'local':
      return a ?? b;
  }
}

export function mergeMonotonic(spec: TableSpec, local: Row, remote: Row): Row {
  const out: Row = { ...local };
  for (const [col, rule] of Object.entries(spec.fields ?? {})) {
    out[col] = pickNum(rule, local[col], remote[col]);
  }
  if (spec.name === 'course_progress') {
    // `passed_via` follows whichever side owns the earliest passed_at.
    const lp = local.passed_at;
    const rp = remote.passed_at;
    const remoteOwns = typeof rp === 'number' && (typeof lp !== 'number' || rp < lp);
    out.passed_via = remoteOwns ? remote.passed_via : (local.passed_via ?? remote.passed_via);
  }
  return out;
}

/** True when `a` and `b` agree on every column in `cols` (null-safe, loose number/string). */
export function rowsEqualOn(cols: string[], a: Row, b: Row): boolean {
  return cols.every((c) => (a[c] ?? null) === (b[c] ?? null));
}
