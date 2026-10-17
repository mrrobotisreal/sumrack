import { cooldownFor, MINUTE_MS } from './hotel-model';

/**
 * T92 pure gate rules: the Номер 13 mock (`a1-torfl-mock-004`) hub hiding, the
 * topic → floor debrief map, the gate cooldown countdown, and the copy the
 * countdown reads. No React, no DB: the screens and the repo read these.
 */

/** The tag that marks Номер 13 (the unseen gate mock) in pack.json. */
export const GATE_TAG = 'torfl:gate';

/** The gate mock's pack id (D10, D16). */
export const GATE_PACK_ID = 'a1-torfl-mock-004';

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
 * Topic → floor, for the Номер 13 debrief (D6). An item's `topic` picks the
 * floor(s) to revisit. Lexgram topics map to their floor; writing, reading,
 * listening and speaking map to 12, 14 and 15.
 */
export const TOPIC_FLOOR: Readonly<Record<string, number>> = {
  'case-prep': 3,
  'case-acc': 4,
  'verb-aspect': 5,
  'case-gen': 6,
  'case-dat': 7,
  'case-instr': 8,
  'verb-motion': 9,
  conj: 10,
  'lex-verbs': 11,
  'lex-family': 11,
  'lex-negation': 11,
  agr: 1,
  pron: 1,
  'verb-forms': 2,
  writing: 12,
  reading: 14,
  listening: 14,
  speaking: 15,
};

/** The floor a topic belongs to, or null when the topic is unknown. `lex-*` falls back to floor 11. */
export function floorForTopic(topic: string): number | null {
  if (topic in TOPIC_FLOOR) return TOPIC_FLOOR[topic] ?? null;
  if (topic.startsWith('lex-')) return 11;
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
export function debriefFloors(missed: readonly MissedItem[]): number[] {
  const counts = new Map<number, number>();
  for (const m of missed) {
    const floor = floorForTopic(m.topic);
    if (floor !== null) counts.set(floor, (counts.get(floor) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([floor]) => floor);
}

/** A subtest result for the room: the percent and the pass threshold it is measured against. */
export interface SubtestResult {
  kind: string;
  percent: number;
}

/** SPbU rule (D6/D13): every subtest ≥ 66 %, one may be ≥ 60 %. Pure. */
export function gatePasses(results: readonly SubtestResult[]): boolean {
  if (results.length === 0) return false;
  const below60 = results.filter((r) => r.percent < 60).length;
  const below66 = results.filter((r) => r.percent < 66).length;
  // Exactly one subtest may fall in [60, 66); none may fall under 60.
  return below60 === 0 && below66 <= 1;
}

/** The floors to revisit for every subtest under 66 % (D6): lexgram → topic map, the rest → fixed floors. */
export function debriefForSubtests(
  results: readonly SubtestResult[],
  missedByKind: Readonly<Record<string, MissedItem[]>>,
): { kind: string; percent: number; floors: number[] }[] {
  return results
    .filter((r) => r.percent < 66)
    .map((r) => ({
      kind: r.kind,
      percent: r.percent,
      floors: debriefFloors(missedByKind[r.kind] ?? []),
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
 * The learner's ladder level for the journal's daily prompt (D18): A1 until
 * Номер 13 is passed, then A2. Pure: the caller reads the gate's passed state.
 */
export function ladderLevel(gatePassed: boolean): 'A1' | 'A2' {
  return gatePassed ? 'A2' : 'A1';
}

/** What Today shows on the hotel card (decision 10), as plain data. */
export type HotelNextAction =
  | { kind: 'done-all'; label: 'A1 пройден ✓' | 'Номер 13 ждёт'; route: string }
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
}

/**
 * The Today card's next step (decision 10): the first unlocked floor's first
 * unpassed unit — its lesson if never opened, else its exercises — else the
 * floor exam (cooldown → the minutes left), else the next floor. All done →
 * «Номер 13 ждёт» until the gate passes, then «A1 пройден ✓». Pure.
 */
export function nextHotelAction(
  floors: readonly NextFloorView[],
  opts: { gatePassed: boolean; reveal13: boolean },
): HotelNextAction | null {
  for (const f of floors) {
    if (!f.unlocked || f.passed) continue;
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
  if (opts.gatePassed) return { kind: 'done-all', label: 'A1 пройден ✓', route: '/(tabs)/path' };
  if (opts.reveal13) return { kind: 'done-all', label: 'Номер 13 ждёт', route: '/(tabs)/path' };
  return null;
}

/** The card line «Этаж N · <unit> · урок k из m» (decision 10). */
export function hotelCardLine(action: HotelNextAction): string {
  if (action.kind === 'done-all') return action.label;
  if (action.kind === 'exam') {
    return action.cooldownMinutes !== null
      ? `Экзамен этажа ${action.floor} · через ${formatCooldownRu(action.cooldownMinutes)}`
      : `Экзамен этажа ${action.floor}`;
  }
  const verb = action.kind === 'lesson' ? 'урок' : 'упражнения';
  return `Этаж ${action.floor} · ${action.unitTitle} · ${verb} ${action.index} из ${action.total}`;
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
