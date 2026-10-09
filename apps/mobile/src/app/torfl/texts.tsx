import { useLocalSearchParams } from 'expo-router';

import { levelFromParam } from '@/features/torfl/level-profile';
import { TorflTextsScreen } from '@/features/torfl/texts-screen';

export default function TorflTextsRoute() {
  const { level } = useLocalSearchParams<{ level?: string | string[] }>();
  return <TorflTextsScreen level={levelFromParam(level)} />;
}
