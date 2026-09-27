import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useScenarioRuns } from '@/db/hooks';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Runs list — a T62 stub (§9.1 «Runs · N» → the T63 runs list). Counts the
 * runs so the link is honest; T63 replaces this file with the real list of
 * per-run debriefs.
 */
export default function ScenarioRunsStubRoute() {
  const { scenarioId } = useLocalSearchParams<{ scenarioId?: string }>();
  const { tokens } = useAppTheme();
  const runs = useScenarioRuns(scenarioId || undefined);
  const n = runs.data?.length ?? 0;
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-bg px-10">
      <Ionicons name="time-outline" size={40} color={tokens.textMuted} />
      <Text className="font-reading-bold text-xl">Runs · {n}</Text>
      <Text variant="muted" className="text-center">
        Every attempt is recorded. The per-run debrief — what you said, word by word, with your
        recordings — arrives with the next update (T63).
      </Text>
    </View>
  );
}
