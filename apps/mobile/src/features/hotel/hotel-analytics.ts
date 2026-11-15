import type { HotelLevel } from '@/features/torfl/hotel-profile';
import { track, type AnalyticsProps } from '@/services/analytics';

/**
 * THE BUILDING RULE for hotel analytics (T116, HOTEL_PATH_A2 H8): every hotel
 * event that does not already carry a `packId` carries `level` — the building
 * ('A1' | 'A2'). Call sites use `trackHotel`, never a bare `track(…)` of these
 * events; `__tests__/hotel-analytics-level.test.ts` scans the source.
 */
export const HOTEL_LEVEL_EVENTS = [
  'hotel_floor_entered',
  'hotel_lift_ride',
  'hotel_up_blocked',
  'hotel_drop_played',
  'hotel_gate_attempt',
  'hotel_cooldown_blocked',
  'hotel_building_switched',
] as const;
export type HotelLevelEvent = (typeof HOTEL_LEVEL_EVENTS)[number];

export function trackHotel(
  event: HotelLevelEvent,
  props: AnalyticsProps & { level: HotelLevel },
): void {
  track(event, props);
}
