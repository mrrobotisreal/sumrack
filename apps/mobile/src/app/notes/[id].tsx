import { useLocalSearchParams } from 'expo-router';

import { NoteEditorScreen } from '@/features/notes/note-editor-screen';

export default function NoteRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NoteEditorScreen id={id} />;
}
