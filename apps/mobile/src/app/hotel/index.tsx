import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `sumrak://hotel?floor=N` (T92 decision 11): the hotel is the Путь tab, so the
 * deep link forwards to it with the floor. Without `floor` it opens the tab on
 * the saved floor (`hotel.lastFloor`).
 */
export default function HotelIndexRoute() {
  const { floor } = useLocalSearchParams<{ floor?: string }>();
  const params = floor !== undefined ? { floor } : undefined;
  return <Redirect href={{ pathname: '/(tabs)/path', params } as never} />;
}
