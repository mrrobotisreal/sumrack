import type { CourseItem, TypedItem } from '@sumrak/schema';

import { scoreTyped } from '@/features/torfl/scoring';

/**
 * The hotel's pure rules (HOTEL_PATH D5, D12–D14; design §3). No DB, no React:
 * the lock rule, the panel, the exercise and exam draws, scoring, cooldowns
 * and passes. The repo writes whatever this module decides; the UI reads it.
 */

export const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** D5: the A1 panel reads 0 (Вестибюль), 1–12, 14, 15 — there is no 13. */
export const PANEL_A1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15] as const;

/** A course floor as the model sees it: what is installed, nothing about progress. */
export interface FloorInput {
  packId: string;
  floor: number;
  unitIds: string[];
  /** False only on floor 0 (Вестибюль has no exam). */
  hasExam: boolean;
}

/** One `course_progress` row, as the model reads it (a structural subset). */
export interface ProgressRow {
  key: string;
  packId: string;
  unitId: string | null;
  bestPercent: number;
  passedAt: number | null;
  passedVia: 'course' | 'extern' | null;
  attempts: number;
  lastAttemptAt: number | null;
  cooldownUntil: number | null;
}

export type CourseKind = 'unit' | 'floor' | 'extern' | 'gate';
export type PassKind = 'unit' | 'floor' | 'extern';

export interface UnitState {
  unitId: string;
  unlocked: boolean;
  passed: boolean;
  best: number;
}

export interface FloorState {
  packId: string;
  floor: number;
  hasExam: boolean;
  unlocked: boolean;
  passed: boolean;
  /** How the floor was passed: its own exam ('course'), or an экстерн / the D12 cascade ('extern'). */
  passedVia: 'course' | 'extern' | null;
  bestPercent: number;
  /** The floor row's cooldown while it is still running; null when clear. */
  cooldownUntil: number | null;
  units: UnitState[];
  examUnlocked: boolean;
}

/** The installed floors that sit on the panel, in panel order. Floor 13 is never on the panel. */
export function panelFor(installed: readonly FloorInput[]): FloorInput[] {
  const byFloor = new Map(installed.map((f) => [f.floor, f]));
  const out: FloorInput[] = [];
  for (const n of PANEL_A1) {
    const f = byFloor.get(n);
    if (f) out.push(f);
  }
  return out;
}

const unitKey = (packId: string, unitId: string) => `${packId}:${unitId}`;
const floorKey = (packId: string) => `${packId}:floor`;

/**
 * THE LOCK RULE (design §3, D12) — pure.
 *
 * - Floor n is unlocked iff n is floor 0, or the previous panel floor is
 *   passed, or any floor ≥ n is passed via экстерн (the cascade).
 * - A floor passed via экстерн passes every lower panel floor that is not yet
 *   passed (`passedVia: 'extern'`); its units stay unpassed but are unlocked.
 * - Units inside an unlocked floor unlock in order; the floor exam unlocks
 *   when every unit has passed. Floor 0 has no exam: it is passed when its
 *   last unit passes.
 */
export function floorState(
  installed: readonly FloorInput[],
  progress: readonly ProgressRow[],
  now: number,
): FloorState[] {
  const rows = new Map(progress.map((p) => [p.key, p]));
  const panel = panelFor(installed);

  // Each floor's OWN pass (its row, or — with no exam — its units).
  const own = panel.map((f) => {
    const row = rows.get(floorKey(f.packId));
    const unitsPassed = f.unitIds.every((u) => rows.get(unitKey(f.packId, u))?.passedAt != null);
    const passedOwn = row?.passedAt != null || (!f.hasExam && unitsPassed);
    const via: 'course' | 'extern' | null = passedOwn ? (row?.passedVia ?? 'course') : null;
    return { passedOwn, via };
  });

  // The highest panel index passed via экстерн; everything at or below it is passed.
  let externReach = -1;
  own.forEach((o, i) => {
    if (o.passedOwn && o.via === 'extern') externReach = Math.max(externReach, i);
  });

  const passed = own.map((o, i) => o.passedOwn || i <= externReach);
  const passedVia = own.map((o, i) => {
    if (o.passedOwn) return o.via;
    return i <= externReach ? 'extern' : null;
  });

  return panel.map((f, i) => {
    const floorUnlocked = f.floor === 0 || i === 0 || passed[i - 1] === true || i <= externReach;
    const row = rows.get(floorKey(f.packId));
    const extern = passedVia[i] === 'extern';

    let prevPassed = true;
    const units: UnitState[] = f.unitIds.map((unitId, k) => {
      const r = rows.get(unitKey(f.packId, unitId));
      const passedUnit = r?.passedAt != null;
      const unlocked = floorUnlocked && (extern || k === 0 || prevPassed);
      prevPassed = passedUnit;
      return { unitId, unlocked, passed: passedUnit, best: r?.bestPercent ?? 0 };
    });

    const cooldown = row?.cooldownUntil ?? null;
    return {
      packId: f.packId,
      floor: f.floor,
      hasExam: f.hasExam,
      unlocked: floorUnlocked,
      passed: passed[i] === true,
      passedVia: passedVia[i] ?? null,
      bestPercent: row?.bestPercent ?? 0,
      cooldownUntil: cooldown !== null && cooldown > now ? cooldown : null,
      units,
      examUnlocked:
        f.hasExam && floorUnlocked && units.length > 0 && units.every((u) => u.passed),
    };
  });
}

/** The highest unlocked floor number on the panel; null when nothing is unlocked. */
export function highestUnlocked(states: readonly FloorState[]): number | null {
  let best: number | null = null;
  for (const s of states) {
    if (s.unlocked && (best === null || s.floor > best)) best = s.floor;
  }
  return best;
}

/**
 * Номер 13 appears iff floor 15 is passed AND the gate mock `a1-torfl-mock-004`
 * is installed (D5/D6, design §3).
 */
export function reveal13(
  installed: readonly FloorInput[],
  progress: readonly ProgressRow[],
  opts: { mockInstalled: boolean },
): boolean {
  const f15 = floorState(installed, progress, 0).find((s) => s.floor === 15);
  return f15 !== undefined && f15.passed && opts.mockInstalled;
}

/** A passing score for a unit or floor (≥ 80) or экстерн (≥ 90) — D13. */
export function passes(kind: PassKind, percent: number): boolean {
  return percent >= (kind === 'extern' ? 90 : 80);
}

/**
 * Cooldown after an attempt, in ms (D13): unit 0, floor 20 min, экстерн 60 min,
 * the Номер 13 gate 6 h. A pass never cools down.
 */
export function cooldownFor(kind: CourseKind, passed: boolean): number {
  if (passed) return 0;
  switch (kind) {
    case 'unit':
      return 0;
    case 'floor':
      return 20 * MINUTE_MS;
    case 'extern':
      return HOUR_MS;
    case 'gate':
      return 6 * HOUR_MS;
  }
}

export type AttemptGate = { ok: true } | { ok: false; minutesLeft: number };

/**
 * Cooldown is data (decision 6): a floor/экстерн row with a live `cooldownUntil`
 * blocks the attempt and reports whole minutes left (rounded up). Units never block.
 */
export function canAttempt(
  row: Pick<ProgressRow, 'cooldownUntil'> | undefined,
  kind: CourseKind,
  now: number,
): AttemptGate {
  if (kind === 'unit') return { ok: true };
  const until = row?.cooldownUntil ?? null;
  if (until === null || until <= now) return { ok: true };
  return { ok: false, minutesLeft: Math.ceil((until - now) / MINUTE_MS) };
}

/** Deterministic PRNG (mulberry32) so a seeded draw is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Draw `size` items from `pool` (D13, decision 5). Retries put the previously
 * missed items first, up to half of `size`. The rest comes from the pool
 * items NOT in the previous attempt when there are enough, and only then from
 * the previous attempt. Deterministic for a seed; `size` is capped at the pool.
 */
export function drawItems(
  pool: readonly string[],
  size: number,
  opts: { missedLastTime: readonly string[]; previous: readonly string[]; seed: number },
): string[] {
  const rand = mulberry32(opts.seed);
  const target = Math.min(size, pool.length);
  const inPool = new Set(pool);
  const missed = new Set(opts.missedLastTime.filter((id) => inPool.has(id)));
  const previous = new Set(opts.previous);

  const retried = shuffle([...missed], rand).slice(0, Math.floor(target / 2));
  const chosen = new Set(retried);
  const fresh = shuffle(
    pool.filter((id) => !chosen.has(id) && !previous.has(id)),
    rand,
  );
  const stale = shuffle(
    pool.filter((id) => !chosen.has(id) && previous.has(id)),
    rand,
  );

  const rest: string[] = [];
  for (const id of [...fresh, ...stale]) {
    if (retried.length + rest.length >= target) break;
    rest.push(id);
  }
  return [...retried, ...shuffle(rest, rand)];
}

/** The unit whose items were missed most; ties → the earlier unit; null when nothing was missed. */
export function weakestUnit(
  units: readonly { id: string; items: readonly string[] }[],
  missedIds: readonly string[],
): string | null {
  const missed = new Set(missedIds);
  let best: { id: string; count: number } | null = null;
  for (const unit of units) {
    const count = unit.items.filter((id) => missed.has(id)).length;
    if (count > 0 && (best === null || count > best.count)) best = { id: unit.id, count };
  }
  return best?.id ?? null;
}

/** A recorded answer as the scorer reads it. `answer` is the raw payload (choice index / typed text). */
export interface ResponseLike {
  answer: unknown;
}

export interface ScoredItem {
  itemId: string;
  /** 1 full, 0.5 half (typed/transform), 0 wrong or blank. Pending items score 0 and are not counted. */
  points: number;
  correct: boolean;
  pending: boolean;
}

export interface AttemptScore {
  /** Sum of points over the scored (non-pending) items. */
  correct: number;
  /** Count of scored (non-pending) items. */
  total: number;
  /** Whole-number percent of `total`; 0 when nothing is scored. */
  percent: number;
  /** Ids of writing/speaking items, graded later (T92), not counted. */
  pending: string[];
  items: ScoredItem[];
}

/**
 * Score an attempt (decision 5). `choice` and `trigger` are exact on the index;
 * `typed` and `transform` go through the T70 `scoreTyped` (ё/е fold, globs,
 * half credit). `writing` and `speaking` are pending. Unanswered = wrong.
 */
export function scoreAttempt(
  items: readonly CourseItem[],
  responses: Readonly<Record<string, ResponseLike | undefined>>,
): AttemptScore {
  const scored: ScoredItem[] = [];
  for (const item of items) {
    const answer = responses[item.id]?.answer;
    if (item.kind === 'choice' || item.kind === 'trigger') {
      const ok = typeof answer === 'number' && answer === item.answer;
      scored.push({ itemId: item.id, points: ok ? 1 : 0, correct: ok, pending: false });
    } else if (item.kind === 'typed' || item.kind === 'transform') {
      const text = typeof answer === 'string' ? answer : '';
      const typed = { accept: item.accept, half: item.half } as unknown as TypedItem;
      const outcome = scoreTyped(typed, text, 1).outcome;
      const points = outcome === 'full' ? 1 : outcome === 'half' ? 0.5 : 0;
      scored.push({ itemId: item.id, points, correct: outcome === 'full', pending: false });
    } else {
      scored.push({ itemId: item.id, points: 0, correct: false, pending: true });
    }
  }
  const counted = scored.filter((s) => !s.pending);
  const correct = counted.reduce((n, s) => n + s.points, 0);
  const total = counted.length;
  return {
    correct,
    total,
    percent: total === 0 ? 0 : Math.round((correct / total) * 100),
    pending: scored.filter((s) => s.pending).map((s) => s.itemId),
    items: scored,
  };
}
