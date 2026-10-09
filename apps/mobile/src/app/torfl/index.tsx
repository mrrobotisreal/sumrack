import { useLocalSearchParams } from 'expo-router';

import { TorflHubScreen, type HubOpenedFrom } from '@/features/torfl/hub-screen';
import { levelFromParam } from '@/features/torfl/level-profile';

const FROM: readonly HubOpenedFrom[] = ['library', 'today', 'deeplink'];

/**
 * `sumrak://torfl` lands here with no `from` → 'deeplink'. `?level=A2` opens the
 * A2 hub; no param (or an unknown one) → A1 (back-compat).
 */
export default function TorflHubRoute() {
  const { from, level } = useLocalSearchParams<{ from?: string; level?: string | string[] }>();
  const source = FROM.find((f) => f === from) ?? 'deeplink';
  return <TorflHubScreen from={source} level={levelFromParam(level)} />;
}
