import { useLocalSearchParams } from 'expo-router';

import { EntryEditorScreen } from '@/features/journal/entry-editor-screen';

export default function JournalEntryRoute() {
  const { id, promptId } = useLocalSearchParams<{ id: string; promptId?: string }>();
  return <EntryEditorScreen id={id} promptId={promptId} />;
}
