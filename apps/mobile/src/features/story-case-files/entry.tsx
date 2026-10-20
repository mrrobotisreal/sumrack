import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { Text } from '@/components/ui/text';
import { caseFileForStory } from './catalog';
import { useCaseFile } from './hooks';

/** Optional reader footer. Query and route use the identical full-part/source gate. */
export function CaseFileEntry({ packId, storyId }: { packId: string; storyId: string }) {
  const router = useRouter();
  const file = caseFileForStory(packId, storyId);
  const query = useCaseFile(file);
  if (!file || query.data?.availability !== 'ready' || query.isError || query.isFetching)
    return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open this part’s case file"
      onPress={() => router.push({ pathname: '/case-files/[id]', params: { id: file.id } })}
      className="mx-4 my-4 min-h-12 justify-center rounded-xl border border-border bg-surface p-4 active:opacity-80"
    >
      <Text variant="title">Open the case file</Text>
      <Text variant="muted" className="mt-1">
        Check what happened, support your answers, and retell this part.
      </Text>
    </Pressable>
  );
}
