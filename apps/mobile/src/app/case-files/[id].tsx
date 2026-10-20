import { Stack, useLocalSearchParams } from 'expo-router';
import { CaseFileScreen } from '@/features/story-case-files/screen';
export default function CaseFileRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Case file' }} />
      <CaseFileScreen id={id} />
    </>
  );
}
