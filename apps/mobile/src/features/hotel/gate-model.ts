import {
  HOTEL_LADDER,
  HOTEL_LEVELS,
  hotelProfileFor,
  type HotelLevel,
  type LadderRung,
} from '@/features/torfl/hotel-profile';

import { profileFor } from '@/features/torfl/level-profile';

import { cooldownFor, MINUTE_MS } from './hotel-model';

/**
 * T92 pure gate rules: the Номер 13 mock hub hiding (by the pack's real
 * `torfl:gate` tag), the topic → floor debrief map, the gate cooldown
 * countdown, and the copy the countdown reads. No React, no DB: the screens
 * and the repo read these. Every per-building fact (gate pack / exam id,
 * topic map, labels) comes from `features/torfl/hotel-profile.ts` (T116).
 */

/** The tag that marks Номер 13 (the unseen gate mock) in pack.json. */
export const GATE_TAG = 'torfl:gate';

/** A pack as the hub sees it: only what the hiding rule reads. */
export interface PackTagView {
  packId: string;
  tags: readonly string[];
}

/**
 * D16: a `torfl:gate` exam pack is hidden from the ТРКИ hub, the Library exam
 * rows and «Тексты» until its gate has been attempted once (any status).
 * Every other pack is always visible.
 */
export function isHiddenGatePack(pack: PackTagView, attempted: boolean): boolean {
  return pack.tags.includes(GATE_TAG) && !attempted;
}

/** Filter a list of packs through the hiding rule (one helper for every listing). */
export function visiblePacks<T extends PackTagView>(
  packs: readonly T[],
  attemptedPackIds: ReadonlySet<string>,
): T[] {
  return packs.filter((p) => !isHiddenGatePack(p, attemptedPackIds.has(p.packId)));
}

/**
 * Topic → floor, for the Номер 13 debrief (D6, H5): the building's own map
 * (`hotelProfileFor(level).topicFloor`, then its prefix fallbacks — `lex-*` →
 * 11 in both buildings). Null when the topic is unknown (never guessed).
 */
export function floorForTopic(topic: string, level?: HotelLevel): number | null {
  const profile = hotelProfileFor(level);
  if (Object.prototype.hasOwnProperty.call(profile.topicFloor, topic)) {
    return profile.topicFloor[topic] ?? null;
  }
  for (const [prefix, floor] of profile.topicPrefixFloor) {
    if (topic.startsWith(prefix)) return floor;
  }
  return null;
}

export interface MissedItem {
  itemId: string;
  topic: string;
}

/**
 * The floors a Номер 13 debrief marks (D6): every floor whose topics account
 * for a missed item, most misses first, then by floor number. Unknown topics
 * are ignored, never guessed.
 */
export function debriefFloors(missed: readonly MissedItem[], level?: HotelLevel): number[] {
  const counts = new Map<number, number>();
  for (const m of missed) {
    const floor = floorForTopic(m.topic, level);
    if (floor !== null) counts.set(floor, (counts.get(floor) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([floor]) => floor);
}

/** A subtest result for the room: the percent and the pass threshold it is measured against. */
export interface SubtestResult {
  kind: string;
  percent: number;
}

/**
 * SPbU rule (D6/D13, H4): every subtest ≥ 66 %, one may be ≥ 60 % — the
 * building's `profileFor(level)` thresholds (the same at A1 and A2). Pure.
 */
export function gatePasses(results: readonly SubtestResult[], level?: HotelLevel): boolean {
  if (results.length === 0) return false;
  const { passPct, borderlinePct } = profileFor(level);
  const belowBorder = results.filter((r) => r.percent < borderlinePct).length;
  const belowPass = results.filter((r) => r.percent < passPct).length;
  // Exactly one subtest may fall in [borderline, pass); none may fall under borderline.
  return belowBorder === 0 && belowPass <= 1;
}

/** The floors to revisit for every subtest under the pass line (66 %, D6): lexgram → topic map, the rest → fixed floors. */
export function debriefForSubtests(
  results: readonly SubtestResult[],
  missedByKind: Readonly<Record<string, MissedItem[]>>,
  level?: HotelLevel,
): { kind: string; percent: number; floors: number[] }[] {
  const { passPct } = profileFor(level);
  return results
    .filter((r) => r.percent < passPct)
    .map((r) => ({
      kind: r.kind,
      percent: r.percent,
      floors: debriefFloors(missedByKind[r.kind] ?? [], level),
    }));
}

/**
 * The gate's cooldown (D13, decision 6): computed from the last finished gate
 * attempt's `finishedAt`, never a new table. Returns the absolute `until` or
 * null when the gate is open.
 */
export function gateCooldownUntil(lastFinishedAt: number | null, passed: boolean): number | null {
  if (passed || lastFinishedAt === null) return null;
  return lastFinishedAt + cooldownFor('gate', false);
}

/** Whole minutes left (rounded up) and the spoken line («через 5 ч 42 мин»). */
export function cooldownLeft(
  until: number | null,
  now: number,
): { minutesLeft: number; text: string } | null {
  if (until === null || until <= now) return null;
  const minutesLeft = Math.ceil((until - now) / MINUTE_MS);
  return { minutesLeft, text: formatCooldownRu(minutesLeft) };
}

/** «N ч M мин» / «M мин» for a whole-minute count, Russian. */
export function formatCooldownRu(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/**
 * The learner's ladder level for the journal's daily prompt (D18, H7): the
 * rung above the highest building whose Номер 13 verdict passed (A1 → A2 →
 * B1); A1 while none has. Pure: the caller reads each gate's passed state.
 */
export function ladderLevel(passedBuildings: Iterable<HotelLevel>): LadderRung {
  let top = -1;
  for (const level of passedBuildings) top = Math.max(top, HOTEL_LADDER.indexOf(level));
  return HOTEL_LADDER[Math.min(top + 1, HOTEL_LADDER.length - 1)] ?? HOTEL_LADDER[0];
}

/** What Today shows on the hotel card (decision 10), as plain data. */
export type HotelNextAction =
  | {
      kind: 'done-all';
      /** «A1 пройден ✓» / «A2 пройден ✓» (the building's `passedLabel`), «Номер 13 ждёт», «Новые этажи скоро». */
      label: string;
      route: string;
    }
  | {
      kind: 'lesson';
      floor: number;
      unitTitle: string;
      packId: string;
      unitId: string;
      index: number;
      total: number;
      route: string;
    }
  | {
      kind: 'exercises';
      floor: number;
      unitTitle: string;
      packId: string;
      unitId: string;
      index: number;
      total: number;
      route: string;
    }
  | { kind: 'exam'; floor: number; packId: string; route: string; cooldownMinutes: number | null };

export interface NextUnitView {
  unitId: string;
  title: string;
  passed: boolean;
  lessonOpened: boolean;
}

export interface NextFloorView {
  packId: string;
  floor: number;
  unlocked: boolean;
  passed: boolean;
  units: NextUnitView[];
  examCooldownMinutes: number | null;
  examUnlocked: boolean;
  /**
   * T114: false for Вестибюль (no floor exam). An exam-less floor is
   * orientation, never the next step — the card points at the first real
   * floor instead. Absent (older callers / tests) = has an exam.
   */
  hasExam?: boolean;
}

/**
 * The Today card's next step (decision 10): the first unlocked floor's first
 * unpassed unit — its lesson if never opened, else its exercises — else the
 * floor exam (cooldown → the minutes left), else the next floor. All done →
 * «Номер 13 ждёт» until the gate passes, then «A1 пройден ✓». Pure.
 */
export function nextHotelAction(
  floors: readonly NextFloorView[],
  opts: { gatePassed: boolean; reveal13: boolean; level?: HotelLevel },
): HotelNextAction | null {
  for (const f of floors) {
    if (!f.unlocked || f.passed) continue;
    // T114: orientation (no exam) is never «what's next» while real floors remain.
    if (f.hasExam === false && floors.some((g) => g.hasExam !== false && !g.passed)) continue;
    const unit = f.units.find((u) => !u.passed);
    if (unit) {
      const base = {
        floor: f.floor,
        unitTitle: unit.title,
        packId: f.packId,
        unitId: unit.unitId,
        index: f.units.indexOf(unit) + 1,
        total: f.units.length,
      };
      if (!unit.lessonOpened) {
        return { kind: 'lesson', ...base, route: `/hotel/${f.packId}/${unit.unitId}` };
      }
      return { kind: 'exercises', ...base, route: `/hotel/${f.packId}/${unit.unitId}/practice` };
    }
    if (f.examUnlocked) {
      return {
        kind: 'exam',
        floor: f.floor,
        packId: f.packId,
        route: `/hotel/${f.packId}/exam?mode=floor`,
        cooldownMinutes: f.examCooldownMinutes,
      };
    }
  }
  if (opts.gatePassed) {
    const label = `${hotelProfileFor(opts.level).passedLabel} ✓`;
    return { kind: 'done-all', label, route: '/(tabs)/path' };
  }
  if (opts.reveal13) return { kind: 'done-all', label: 'Номер 13 ждёт', route: '/(tabs)/path' };
  // Every installed floor is passed but more are still to come (content arrives floor by floor):
  // the Today card stays visible instead of vanishing (T93c chunk D).
  if (floors.length > 0 && floors.every((f) => f.passed)) {
    return { kind: 'done-all', label: 'Новые этажи скоро', route: '/(tabs)/path' };
  }
  return null;
}

/**
 * The card line «Этаж N · <unit> · урок k из m» (decision 10). Outside the
 * default building the line names it first: «А2 · Этаж 6 · …» (H7). The
 * «пройден ✓» line already names its building.
 */
export function hotelCardLine(action: HotelNextAction, level?: HotelLevel): string {
  if (action.kind === 'done-all') return action.label;
  const profile = hotelProfileFor(level);
  const prefix = profile.level === HOTEL_LEVELS[0] ? '' : `${profile.shortLabel} · `;
  if (action.kind === 'exam') {
    return action.cooldownMinutes !== null
      ? `${prefix}Экзамен этажа ${action.floor} · через ${formatCooldownRu(action.cooldownMinutes)}`
      : `${prefix}Экзамен этажа ${action.floor}`;
  }
  const verb = action.kind === 'lesson' ? 'урок' : 'упражнения';
  return `${prefix}Этаж ${action.floor} · ${action.unitTitle} · ${verb} ${action.index} из ${action.total}`;
}

/**
 * The floors that carry a glowing debrief marker (T92c D6): every floor a
 * failed gate's debrief named, minus those whose floor exam has since been
 * passed (`passedFloors`). Sorted, unique. Pure.
 */
export function markedFloors(
  debrief: readonly { floors: readonly number[] }[],
  passedFloors: ReadonlySet<number>,
): number[] {
  const out = new Set<number>();
  for (const d of debrief) for (const f of d.floors) if (!passedFloors.has(f)) out.add(f);
  return [...out].sort((a, b) => a - b);
}

/** Where the Номер 13 room stands (T92c D6). `open` = no attempt, or the cooldown has run out. */
export type RoomStatus =
  | { kind: 'open' }
  | { kind: 'passed' }
  | { kind: 'cooling'; until: number; left: { minutesLeft: number; text: string } };

/**
 * The room's state from the last gate attempt (no new table): a pass is the
 * steady «A1 пройден» state; a fail cools for 6 h from its `finishedAt`.
 */
export function roomStatus(input: {
  verdict: 'pass' | 'pass-borderline' | 'fail' | null;
  lastFinishedAt: number | null;
  now: number;
}): RoomStatus {
  if (input.verdict === null || input.lastFinishedAt === null) return { kind: 'open' };
  if (input.verdict !== 'fail') return { kind: 'passed' };
  const until = gateCooldownUntil(input.lastFinishedAt, false);
  const left = until === null ? null : cooldownLeft(until, input.now);
  if (until === null || left === null) return { kind: 'open' };
  return { kind: 'cooling', until, left };
}

/** An `exam_attempts` row as the gate signal reads it (a structural subset). */
export interface GateAttemptLike {
  packId: string;
  examId: string;
  status: string;
  verdict: 'pass' | 'pass-borderline' | 'fail' | null;
  finishedAt: number | null;
}

/**
 * Has a building's Номер 13 been passed? (Today «A1 пройден ✓», the journal's
 * ladder level.) T116 bug 6b: the signal is the gate exam's LATEST finished
 * attempt in `exam_attempts` with a passing verdict — the same rule the room
 * itself shows (`roomStatus`). It used to read a `course_progress` row that
 * nothing ever writes, so it could never fire.
 */
export function gatePassedOf(
  attempts: readonly GateAttemptLike[],
  gate: { gatePackId: string; gateExamId: string },
): boolean {
  let last: GateAttemptLike | null = null;
  for (const a of attempts) {
    if (a.packId !== gate.gatePackId || a.examId !== gate.gateExamId) continue;
    if (a.status !== 'finished' || a.finishedAt === null) continue;
    if (last === null || a.finishedAt > (last.finishedAt ?? 0)) last = a;
  }
  return last !== null && (last.verdict === 'pass' || last.verdict === 'pass-borderline');
}

/** One scored response of a finished attempt, as the debrief reads it. */
export interface GradedResponse {
  itemId: string;
  subtestKind: string;
  topic: string;
  points: number;
  maxPoints: number;
}

/**
 * The missed items of a finished gate attempt, grouped by subtest kind (T92c
 * D6). An item is missed when it earned less than its maximum. Pure.
 */
export function missedByKind(responses: readonly GradedResponse[]): Record<string, MissedItem[]> {
  const out: Record<string, MissedItem[]> = {};
  for (const r of responses) {
    if (r.points >= r.maxPoints) continue;
    (out[r.subtestKind] ??= []).push({ itemId: r.itemId, topic: r.topic });
  }
  return out;
}

/**
 * The floors of ONE building whose own course row is passed (T92d: the one
 * passed set the room and the lift share). T116 H6c: building-qualified — the
 * floor number comes from the building's installed floor rows (`pack id →
 * floor`), never parsed from a pack id, so an A1 pass never clears an A2
 * marker and a non-floor pack never counts.
 */
export function passedFloorsOf(
  rows: readonly { packId: string; unitId: string | null; passedAt: number | null }[],
  buildingFloors: readonly { packId: string; floor: number }[],
): Set<number> {
  const floorOf = new Map(buildingFloors.map((f) => [f.packId, f.floor]));
  const out = new Set<number>();
  for (const r of rows) {
    if (r.unitId !== null || r.passedAt == null) continue;
    const floor = floorOf.get(r.packId);
    if (floor !== undefined) out.add(floor);
  }
  return out;
}
