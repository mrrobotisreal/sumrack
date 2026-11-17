import { isHotelLevel, type HotelLevel } from '@/features/torfl/hotel-profile';
import { levelFromParam } from '@/features/torfl/level-profile';

import { trackHotel } from './hotel-analytics';
import { parseLastFloor } from './hotel-model';

/**
 * ISS-006: `sumrak://hotel?level=A2&floor=N` is an EVENT, applied once per
 * navigation (cold or warm); after it the screen's own state rules.
 *
 * Before: `app/hotel/index.tsx` was a `<Redirect>` = `router.replace`, which
 * swapped `hotel/index` for a NEW `(tabs)` route in the root stack — every
 * `/hotel` navigation (each deep link, every lesson «×») stacked one more tab
 * navigator with its own mounted hotel, and each of them re-read its stale
 * route params on every remount. One building change then remounted the lift
 * in all of them (the ≈ 48-row `hotel_floor_entered` bursts on the S25).
 */

/** The root-stack route of the tab navigator. */
export const TABS_ROUTE = '(tabs)';
/** The route param that makes one `/hotel` navigation one event. */
export const DEEP_TOKEN_PARAM = 'nav';

let tokenCounter = 0;
/** A token unique to one navigation in this process. */
export function nextDeepToken(now: number = Date.now()): string {
  tokenCounter += 1;
  return `${now.toString(36)}-${tokenCounter}`;
}

type Param = string | readonly string[] | undefined;
const first = (p: Param): string | undefined =>
  Array.isArray(p) ? p[0] : (p as string | undefined);

/** `/hotel`'s own params → the Путь tab's params, stamped with this navigation's token. */
export function hotelTabParams(
  params: { floor?: Param; level?: Param },
  token: string,
): Record<string, string> | undefined {
  const floor = first(params.floor);
  const level = first(params.level);
  if (floor === undefined && level === undefined) return undefined;
  return {
    ...(floor !== undefined ? { floor } : {}),
    ...(level !== undefined ? { level } : {}),
    [DEEP_TOKEN_PARAM]: token,
  };
}

/**
 * How `/hotel` hands over to the tab navigator. Directly on top of `(tabs)`
 * (every in-app path, and the deep link on the tabs): pop back to THAT
 * navigator with the new params — one hotel, one lift. On top of another
 * screen (a deep link while a reader plays — ISS-006 F2, by design): replace,
 * as before, so the covered screen stays mounted and Back returns to it.
 */
export function hotelRedirectMode(state: {
  index: number;
  routes: readonly { name: string }[];
}): 'dismissTo' | 'replace' {
  return state.routes[state.index - 1]?.name === TABS_ROUTE ? 'dismissTo' : 'replace';
}

export interface DeepLinkEvent {
  token: string;
  /** The building the link asks for (null = not a hotel building → the current one). */
  level: HotelLevel | null;
  /** The floor the link asks for (null = the building's saved floor). */
  floor: number | null;
}

/** The Путь tab's params → the deep-link event they carry, or null (no token = no event). */
export function deepLinkEventOf(params: {
  nav?: Param;
  level?: Param;
  floor?: Param;
}): DeepLinkEvent | null {
  const token = first(params.nav);
  if (!token) return null;
  const level = params.level !== undefined ? levelFromParam(params.level as string) : null;
  const rawFloor = first(params.floor);
  return {
    token,
    level: level !== null && isHotelLevel(level) ? level : null,
    floor: rawFloor !== undefined ? parseLastFloor(Number(rawFloor)) : null,
  };
}

/** Hands out each navigation's event once, however often (or in however many mounts) it is read. */
export function createDeepLinkLedger() {
  const taken = new Set<string>();
  return {
    take(event: DeepLinkEvent | null): DeepLinkEvent | null {
      if (!event || taken.has(event.token)) return null;
      taken.add(event.token);
      return event;
    },
  };
}

/** The app's ledger (module scope: a remounted hotel never re-applies an old link). */
export const hotelDeepLinks = createDeepLinkLedger();

export interface DeepLinkPlan {
  /** Switch to this building (null = already there). */
  switchTo: HotelLevel | null;
  /** Open this floor in that building (null = its saved floor). */
  floor: { level: HotelLevel; floor: number } | null;
}

export function planDeepLink(event: DeepLinkEvent, current: HotelLevel): DeepLinkPlan {
  const target = event.level ?? current;
  return {
    switchTo: target !== current ? target : null,
    floor: event.floor !== null ? { level: target, floor: event.floor } : null,
  };
}

export interface DeepLinkDeps {
  /** The saved floor of a building (`hotel.lastFloor`). */
  savedFloor: (level: HotelLevel) => number | null;
  saveFloor: (floor: number, level: HotelLevel) => void;
  saveBuilding: (level: HotelLevel) => void;
}

/**
 * Applies one navigation's deep link — once per token, however often it is
 * called: logs `hotel_building_switched {via:'deeplink'}` and writes
 * `hotel.building` / `hotel.lastFloor` only when they actually change.
 * Returns the plan it applied, or null (no event, or already applied).
 */
export function applyDeepLink(
  ledger: ReturnType<typeof createDeepLinkLedger>,
  event: DeepLinkEvent | null,
  current: HotelLevel,
  deps: DeepLinkDeps,
): DeepLinkPlan | null {
  const taken = ledger.take(event);
  if (!taken) return null;
  const plan = planDeepLink(taken, current);
  // The floor first: the building's view then mounts on it.
  if (plan.floor && deps.savedFloor(plan.floor.level) !== plan.floor.floor) {
    deps.saveFloor(plan.floor.floor, plan.floor.level);
  }
  if (plan.switchTo) {
    trackHotel('hotel_building_switched', {
      from: current,
      to: plan.switchTo,
      via: 'deeplink',
      level: plan.switchTo,
    });
    deps.saveBuilding(plan.switchTo);
  }
  return plan;
}

/**
 * The floor the lift shows: null until both the building's floors and its
 * saved floor have loaded (a pending floors query is the empty panel `[0]`,
 * which showed «floor 0» and logged it as an arrival); then the start floor
 * (`hotel.lastFloor`, which a ride and a deep link both write).
 */
export function liftFloorOf(input: { settled: boolean; start: number }): number | null {
  return input.settled ? input.start : null;
}

/**
 * `hotel_floor_entered` fires once per arrival on a floor of THIS lift, and only
 * from the focused hotel: returns the floor to log, or null.
 */
export function arrivalOf(
  lastLogged: number | null,
  floor: number | null,
  focused: boolean,
): number | null {
  if (!focused || floor === null || floor === lastLogged) return null;
  return floor;
}
