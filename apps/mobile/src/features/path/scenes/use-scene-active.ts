import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { AppState } from 'react-native';

/**
 * Scene lifecycle inputs (T31): ambient animation may only run while the
 * app is foregrounded AND the hosting screen is focused. Both are mandatory
 * battery paths, not polish (ticket §6).
 */

export function useAppStateActive(): boolean {
  const [active, setActive] = React.useState(AppState.currentState === 'active');
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export function useScreenFocused(): boolean {
  const [focused, setFocused] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}
