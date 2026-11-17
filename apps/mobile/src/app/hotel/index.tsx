import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as React from 'react';

import { hotelRedirectMode, hotelTabParams, nextDeepToken } from '@/features/hotel/deep-link';

/**
 * `sumrak://hotel?level=A2&floor=N` (T92 decision 11, T116 H2): the hotel is
 * the Путь tab, so the link forwards to it with the building and the floor.
 * Without `level` it opens the saved building (`hotel.building`); without
 * `floor`, that building's saved floor (`hotel.lastFloor`).
 *
 * ISS-006: no `<Redirect>` here. It is a `router.replace`, which swapped this
 * route for a NEW `(tabs)` navigator in the root stack — every `/hotel`
 * navigation (each deep link, every lesson «×») stacked one more hotel. Directly
 * on top of `(tabs)` we pop back to THAT navigator instead; the params carry a
 * one-time token so the hotel applies them once (`deep-link.ts`). Over another
 * screen (a link while a reader plays) the old replace stays: that screen stays
 * mounted underneath by design (F2).
 */
export default function HotelIndexRoute() {
  const { floor, level } = useLocalSearchParams<{ floor?: string; level?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const done = React.useRef(false);
  useFocusEffect(
    React.useCallback(() => {
      if (done.current) return;
      done.current = true;
      const params = hotelTabParams({ floor, level }, nextDeepToken());
      const href = { pathname: '/(tabs)/path', params } as never;
      const state = navigation.getState();
      if (state && hotelRedirectMode(state) === 'dismissTo') router.dismissTo(href);
      else router.replace(href);
    }, [floor, level, navigation, router]),
  );
  return null;
}
