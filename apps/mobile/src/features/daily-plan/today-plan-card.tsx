import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
export function TodayPlanCard() {
  const router = useRouter();
  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <Text variant="title">A plan for the time you have</Text>
      <Text variant="muted">15, 30 or 60 minutes, with a small task in your own Russian.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Build my daily plan"
        onPress={() => router.push('/daily-plan')}
        className="min-h-12 justify-center rounded-xl bg-accent px-4 py-3 active:opacity-70"
      >
        <Text className="text-center font-ui-medium text-bg">Choose today’s plan</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open mistake notebook"
        onPress={() => router.push('/learning-evidence')}
        className="min-h-12 justify-center py-3 active:opacity-70"
      >
        <Text className="text-center text-accent">Mistake notebook</Text>
      </Pressable>
    </View>
  );
}
