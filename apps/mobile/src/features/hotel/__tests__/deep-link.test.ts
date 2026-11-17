import { QueryClient } from '@tanstack/react-query';
import { StackRouter } from 'expo-router/build/react-navigation/routers/StackRouter';
import { describe, expect, it, vi } from 'vitest';

import type { HotelLevel } from '@/features/torfl/hotel-profile';
import { track } from '@/services/analytics';

import {
  applyDeepLink,
  arrivalOf,
  createDeepLinkLedger,
  deepLinkEventOf,
  hotelRedirectMode,
  hotelTabParams,
  liftFloorOf,
  nextDeepToken,
  TABS_ROUTE,
} from '../deep-link';
import type { LastFloors } from '../hotel-model';
import { writeSettingThrough } from '../settings-write';

/**
 * ISS-006 F1 (the T117 S25 walk): a warm `sumrak://hotel?level=A2&floor=1`
 * left the other building on screen, and building switches logged bursts of
 * ≈ 48 identical `hotel_floor_entered` rows in one second.
 *
 * Root cause: `app/hotel/index.tsx` was a `<Redirect>` = `router.replace`. In
 * the root stack that REPLACEs `hotel/index` with a NEW `(tabs)` route, so each
 * `/hotel` navigation (every lesson «×», every deep link) stacked one more tab
 * navigator with its own mounted hotel; one building change then remounted the
 * lift in all of them. These tests drive expo-router's own StackRouter.
 */

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

type Route = { key: string; name: string; params?: object };
type StackState = { key: string; index: number; routes: Route[] };
// The JS StackRouter (a plain reducer); its generics are irrelevant here.
const router = StackRouter({}) as unknown as {
  getInitialState(o: object): StackState;
  getStateForAction(s: StackState, a: object, o: object): StackState | null;
};
const OPTS = {
  routeNames: [
    TABS_ROUTE,
    'hotel/index',
    'hotel/[packId]/[unitId]/index',
    'reader/[packId]/[storyId]',
  ],
  routeParamList: {},
  routeGetIdList: {},
};

function act(state: StackState, action: object): StackState {
  const next = router.getStateForAction(state, action, OPTS);
  if (!next) throw new Error(`unhandled ${JSON.stringify(action)}`);
  return next;
}
const push = (s: StackState, name: string, params?: object) =>
  act(s, { type: 'PUSH', payload: { name, params } });
const replace = (s: StackState, name: string, params?: object) =>
  act(s, { type: 'REPLACE', payload: { name, params } });

/** What `app/hotel/index.tsx` dispatches once focused (getNavigateAction's root-level form). */
function redirectFromHotel(s: StackState, params?: Record<string, string>): StackState {
  const payload = { name: TABS_ROUTE, params: { screen: 'path', params } };
  return hotelRedirectMode(s) === 'dismissTo'
    ? act(s, { type: 'POP_TO', payload })
    : act(s, { type: 'REPLACE', payload });
}
const tabsCount = (s: StackState) => s.routes.filter((r) => r.name === TABS_ROUTE).length;

describe('ISS-006 F1: one tab navigator, however often /hotel is opened', () => {
  it('the old Redirect (replace) stacked a new (tabs) navigator per /hotel — the burst size', () => {
    let s = router.getInitialState(OPTS);
    for (let i = 0; i < 48; i++) {
      s = push(s, 'hotel/[packId]/[unitId]/index'); // open a lesson from the hotel
      s = replace(s, 'hotel/index'); // lesson «×» = router.replace('/hotel')
      s = replace(s, TABS_ROUTE, { screen: 'path' }); // <Redirect> = router.replace('/(tabs)/path')
    }
    // 48 + the original: each one a mounted HotelScreen → 49 lift remounts per building change.
    expect(tabsCount(s)).toBe(49);
  });

  it('lesson «×» → /hotel pops back to THE tab navigator (same route key, no new hotel)', () => {
    const initial = router.getInitialState(OPTS);
    let s = initial;
    for (let i = 0; i < 48; i++) {
      s = push(s, 'hotel/[packId]/[unitId]/index');
      s = replace(s, 'hotel/index');
      s = redirectFromHotel(s);
    }
    expect(s.routes.map((r) => r.name)).toEqual([TABS_ROUTE]);
    expect(s.routes[0]!.key).toBe(initial.routes[0]!.key);
  });

  it('warm deep links in both directions keep one tab navigator and carry the params + a token', () => {
    let s = router.getInitialState(OPTS);
    for (const level of ['A2', 'A1', 'A2', 'A1', 'A2']) {
      s = push(s, 'hotel/index', { level, floor: '1' }); // the URL → NAVIGATE hotel/index
      s = redirectFromHotel(s, hotelTabParams({ level, floor: '1' }, nextDeepToken()));
      expect(tabsCount(s)).toBe(1);
      const nested = (s.routes[0]!.params as { params: Record<string, string> }).params;
      expect(nested).toMatchObject({ level, floor: '1' });
      expect(nested.nav).toEqual(expect.any(String));
    }
  });

  it('over another screen (a link while a reader plays, F2) it still replaces: the reader stays underneath', () => {
    let s = router.getInitialState(OPTS);
    s = push(s, 'reader/[packId]/[storyId]');
    s = push(s, 'hotel/index', { level: 'A2' });
    expect(hotelRedirectMode(s)).toBe('replace');
    s = redirectFromHotel(s, hotelTabParams({ level: 'A2' }, nextDeepToken()));
    expect(s.routes.map((r) => r.name)).toEqual([
      TABS_ROUTE,
      'reader/[packId]/[storyId]',
      TABS_ROUTE,
    ]);
  });

  it('bare /hotel carries no params (the hotel shows the saved building and floor)', () => {
    expect(hotelTabParams({}, 't')).toBeUndefined();
    expect(hotelTabParams({ level: 'A2' }, 't')).toEqual({ level: 'A2', nav: 't' });
    expect(nextDeepToken(1)).not.toBe(nextDeepToken(1));
  });
});

/** A mounted hotel's deep-link + settings state, as `HotelScreen` wires it. */
function hotelHarness(initial: { building: HotelLevel; lastFloor: LastFloors }) {
  const ledger = createDeepLinkLedger();
  const state = { building: initial.building, lastFloor: { ...initial.lastFloor } };
  vi.mocked(track).mockClear();
  const writes = { building: 0, lastFloor: 0 };
  const deps = {
    savedFloor: (level: HotelLevel) => state.lastFloor[level] ?? null,
    saveFloor: (floor: number, level: HotelLevel) => {
      writes.lastFloor += 1;
      state.lastFloor = { ...state.lastFloor, [level]: floor };
    },
    saveBuilding: (level: HotelLevel) => {
      writes.building += 1;
      state.building = level;
    },
  };
  /** One render of the screen with these tab params (the effect runs on every render here — worst case). */
  const render = (params: Record<string, string> | undefined) =>
    applyDeepLink(ledger, deepLinkEventOf(params ?? {}), state.building, deps);
  const count = (event: string) => vi.mocked(track).mock.calls.filter(([e]) => e === event).length;
  return { state, render, track: vi.mocked(track), writes, count };
}

describe('ISS-006 F1: the deep link is an event, applied once per navigation', () => {
  it('warm link onto a mounted hotel in the other building lands on that building + floor, one switch event', () => {
    const h = hotelHarness({ building: 'A1', lastFloor: { A1: 1, A2: 0 } });
    const params = hotelTabParams({ level: 'A2', floor: '1' }, 'nav-1');
    h.render(params);
    expect(h.state.building).toBe('A2');
    expect(h.state.lastFloor).toEqual({ A1: 1, A2: 1 });
    expect(h.count('hotel_building_switched')).toBe(1);
    expect(h.track).toHaveBeenCalledWith('hotel_building_switched', {
      from: 'A1',
      to: 'A2',
      via: 'deeplink',
      level: 'A2',
    });
    // Re-renders / remounts with the same params change nothing.
    for (let i = 0; i < 50; i++) h.render(params);
    expect(h.count('hotel_building_switched')).toBe(1);
    expect(h.writes).toEqual({ building: 1, lastFloor: 1 });
  });

  it('a stale link never overrides a later ladder switch (the old screen re-applied its params on remount)', () => {
    const h = hotelHarness({ building: 'A1', lastFloor: { A1: 1 } });
    const params = hotelTabParams({ level: 'A1', floor: '8' }, 'nav-old');
    h.render(params); // floor 8 → saved
    expect(h.state.lastFloor.A1).toBe(8);
    h.state.lastFloor.A1 = 1; // the learner rode back to 1
    h.state.building = 'A2'; // and switched by the ladder
    h.render(params);
    expect(h.state).toEqual({ building: 'A2', lastFloor: { A1: 1 } });
  });

  it('each new navigation is a new event, in both directions', () => {
    const h = hotelHarness({ building: 'A1', lastFloor: {} });
    h.render(hotelTabParams({ level: 'A2', floor: '1' }, 'n1'));
    h.render(hotelTabParams({ level: 'A1', floor: '1' }, 'n2'));
    h.render(hotelTabParams({ level: 'A1', floor: '1' }, 'n3')); // already there: no switch, no write
    expect(h.count('hotel_building_switched')).toBe(2);
    expect(h.state.building).toBe('A1');
    expect(h.writes).toEqual({ building: 2, lastFloor: 2 });
  });

  it('params without a token (a plain tab visit) are no event; an unknown level reads as A1 (as before)', () => {
    expect(deepLinkEventOf({ level: 'A2', floor: '1' })).toBeNull();
    expect(deepLinkEventOf({ nav: 't', level: 'B2', floor: 'x' })).toEqual({
      token: 't',
      level: 'A1',
      floor: null,
    });
    expect(deepLinkEventOf({ nav: 't', floor: '3' })).toEqual({
      token: 't',
      level: null,
      floor: 3,
    });
  });
});

describe('ISS-006 F1: hotel_floor_entered once per arrival', () => {
  /** A BuildingView's arrival log over a sequence of renders. */
  function lift() {
    let logged: number | null = null;
    const events: number[] = [];
    return {
      events,
      render(r: { settled: boolean; start: number; focused?: boolean }) {
        const floor = liftFloorOf(r);
        const arrived = arrivalOf(logged, floor, r.focused ?? true);
        if (arrived !== null) {
          logged = arrived;
          events.push(arrived);
        }
        return floor;
      },
    };
  }

  it('a ladder switch tracks one arrival: nothing while the new building loads, then its floor once', () => {
    const view = lift(); // the new building's BuildingView (remounted by key)
    expect(view.render({ settled: false, start: 0 })).toBeNull(); // floors pending: the empty panel [0]
    for (let i = 0; i < 20; i++) view.render({ settled: true, start: 1 });
    expect(view.events).toEqual([1]);
  });

  it('a ride logs the new floor once; an unfocused hotel logs nothing', () => {
    const view = lift();
    view.render({ settled: true, start: 1 });
    view.render({ settled: true, start: 2 });
    view.render({ settled: true, start: 2 });
    expect(view.events).toEqual([1, 2]);
    const hidden = lift();
    hidden.render({ settled: true, start: 0, focused: false });
    expect(hidden.events).toEqual([]);
  });
});

describe('ISS-006 F1: a stale read cannot flip the building back', () => {
  const KEY = ['hotel', 'building'];

  function slowRead(qc: QueryClient, value: HotelLevel) {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => (resolve = r));
    const fetching = qc
      .fetchQuery({ queryKey: KEY, queryFn: () => gate.then(() => value), staleTime: 0 })
      .catch(() => undefined);
    return { finish: resolve, fetching };
  }

  it('the old optimistic setQueryData lost to a read already in flight (the warm-link race)', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 'A1');
    const read = slowRead(qc, 'A1'); // a mount / focus re-read of hotel.building, started first
    qc.setQueryData(KEY, 'A2'); // the old save()
    read.finish();
    await read.fetching;
    expect(qc.getQueryData(KEY)).toBe('A1'); // flipped back
  });

  it('writeSettingThrough keeps the new value', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, 'A1');
    const read = slowRead(qc, 'A1');
    const persisted: HotelLevel[] = [];
    const write = writeSettingThrough<HotelLevel>(
      qc,
      KEY,
      () => 'A2',
      async (v) => {
        persisted.push(v);
      },
    );
    expect(qc.getQueryData(KEY)).toBe('A2'); // synchronous: the screen sees it this render
    read.finish();
    await read.fetching;
    await write;
    expect(qc.getQueryData(KEY)).toBe('A2');
    expect(persisted).toEqual(['A2']);
  });
});
