import { Stack } from 'expo-router';
import { CaseFilesScreen } from '@/features/story-case-files/screen';
export default function CaseFilesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Case files' }} />
      <CaseFilesScreen />
    </>
  );
}
