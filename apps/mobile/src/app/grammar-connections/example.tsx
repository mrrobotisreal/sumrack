import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView } from 'react-native';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useAppTheme } from '@/theme/use-app-theme';

/** A bounded excerpt, with no reader progress or encounter side effects. */
export default function GrammarExample() {
  const { packId, storyId, sentenceId } = useLocalSearchParams<{
    packId: string;
    storyId: string;
    sentenceId: string;
  }>();
  const { tokens } = useAppTheme();
  const example = useQuery({
    queryKey: ['grammar-source', packId, storyId, sentenceId],
    queryFn: () => repos.grammarConnections.example(packId, storyId, sentenceId),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="gap-5 p-5">
      <Stack.Screen options={{ title: 'Familiar passage' }} />
      {example.isPending || example.isFetching ? (
        <ActivityIndicator color={tokens.accent} />
      ) : example.isError ? (
        <Text>Could not load this passage. Go back and retry the examples.</Text>
      ) : example.data ? (
        <>
          <Text variant="title">{example.data.title}</Text>
          <Text className="font-reading text-2xl">{example.data.ru}</Text>
          <Text>{example.data.en}</Text>
          <Text variant="muted">
            Does this describe a place or a destination? Find the preposition and the noun it
            governs.
          </Text>
          <Text variant="caption">
            A passage you have already reached. Your reading position stays where you left it. Use
            Back to return to the lesson.
          </Text>
        </>
      ) : (
        <Text>
          This passage is unread, unavailable, or its edition has changed. Go back to use the
          authored examples.
        </Text>
      )}
    </ScrollView>
  );
}
