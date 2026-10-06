import { useLocalSearchParams } from 'expo-router';

import { TorflHubScreen, type HubOpenedFrom } from '@/features/torfl/hub-screen';

const FROM: readonly HubOpenedFrom[] = ['library', 'today', 'deeplink'];

/** `sumrak://torfl` lands here with no `from` → 'deeplink'. */
export default function TorflHubRoute() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const source = FROM.find((f) => f === from) ?? 'deeplink';
  return <TorflHubScreen from={source} />;
}
