import { useLocalSearchParams } from 'expo-router';

import { NoteEditorScreen } from '@/features/notes/note-editor-screen';

export default function NoteRoute() {
  // T38: `title`/`body` prefill a NEW note (the leech inbox's «Add note»).
  const { id, title, body } = useLocalSearchParams<{ id: string; title?: string; body?: string }>();
  return <NoteEditorScreen id={id} prefill={id === 'new' ? { title, body } : undefined} />;
}
