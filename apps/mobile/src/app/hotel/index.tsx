import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `sumrak://hotel?level=A2&floor=N` (T92 decision 11, T116 H2): the hotel is
 * the Путь tab, so the deep link forwards to it with the building and the
 * floor. Without `level` it opens the saved building (`hotel.building`);
 * without `floor`, that building's saved floor (`hotel.lastFloor`).
 */
export default function HotelIndexRoute() {
  const { floor, level } = useLocalSearchParams<{ floor?: string; level?: string }>();
  const params = {
    ...(floor !== undefined ? { floor } : {}),
    ...(level !== undefined ? { level } : {}),
  };
  return (
    <Redirect
      href={
        {
          pathname: '/(tabs)/path',
          params: Object.keys(params).length > 0 ? params : undefined,
        } as never
      }
    />
  );
}
