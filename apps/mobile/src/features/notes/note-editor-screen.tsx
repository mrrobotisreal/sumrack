import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { MarkdownView } from '@/components/markdown-view';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { recordNoteCreated } from '@/features/motivation/service';
import { queryKeys, useNote } from '@/db/hooks';
import type { NoteRow } from '@/db/repositories/journal';
import { BankSaveSheet, type BankSaveTarget } from '@/features/journal/bank-save-sheet';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import type { FreeSelection } from '@/components/selectable-text';

const AUTOSAVE_MS = 800;

/** Persisted note payload — Zod at the I/O boundary (roadmap §3). */
const NotePayloadSchema = z.object({
  title: z.string().max(200),
  body: z.string().max(100_000),
});

/** `title` is NOT NULL in the schema; untitled notes get this fallback. */
const UNTITLED = 'Заметка';

/** Route-level wrapper — same remount-per-target pattern as the entry editor. */
export function NoteEditorScreen({ id }: { id: string }) {
  const router = useRouter();
  const isNew = id === 'new';
  const existing = useNote(isNew ? undefined : id);

  if (isNew) return <NoteEditor key="new" note={null} />;

  if (existing.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }

  if (existing.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void existing.refetch()} />
      </View>
    );
  }

  if (!existing.data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Text className="font-ui-medium text-lg">Note not found</Text>
        <Text variant="muted" className="text-center">
          This note no longer exists.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          className="mt-2 min-h-12 items-center justify-center rounded-full border border-border bg-surface px-5 active:bg-surface-2"
        >
          <Text className="text-accent">Back</Text>
        </Pressable>
      </View>
    );
  }

  return <NoteEditor key={id} note={existing.data} />;
}

/**
 * Markdown note editor with preview toggle (design §7.4). The preview is a
 * reading surface: it hosts the same highlight-to-bank gesture as the
 * journal's read mode, through MarkdownView's selectable text blocks.
 */
function NoteEditor({ note }: { note: NoteRow | null }) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const isNew = note === null;
  const [title, setTitle] = React.useState(note && note.title !== UNTITLED ? note.title : '');
  const [body, setBody] = React.useState(note?.body ?? '');
  const [noteId, setNoteId] = React.useState<string | null>(note?.id ?? null);
  const [preview, setPreview] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [bankTarget, setBankTarget] = React.useState<BankSaveTarget | null>(null);

  // Mutable bookkeeping for handlers/timers only — never read during render.
  const stateRef = React.useRef({
    noteId: note?.id ?? null,
    saved: note ? JSON.stringify({ title: note.title, body: note.body }) : '',
    title: note && note.title !== UNTITLED ? note.title : '',
    body: note?.body ?? '',
    deleted: false,
  });
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = React.useCallback(async () => {
    const s = stateRef.current;
    if (s.deleted) return;
    const payload = NotePayloadSchema.parse({
      title: s.title.normalize('NFC').trim() || UNTITLED,
      body: s.body.normalize('NFC'),
    });
    if (payload.title === UNTITLED && payload.body.trim().length === 0) return;
    const serialized = JSON.stringify(payload);
    if (serialized === s.saved) return;
    if (!s.noteId) {
      const row = await repos.journal.createNote(payload);
      s.noteId = row.id;
      setNoteId(row.id);
      track('note_created', {});
      void recordNoteCreated(); // T19 XP
    } else {
      await repos.journal.updateNote(s.noteId, payload);
      track('note_autosaved', { chars: payload.body.length });
    }
    s.saved = serialized;
    void queryClient.invalidateQueries({ queryKey: queryKeys.notes });
    void queryClient.invalidateQueries({ queryKey: queryKeys.note(s.noteId) });
  }, [queryClient]);

  const schedule = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }, [persist]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void persist();
    },
    [persist],
  );

  const togglePreview = React.useCallback(() => {
    setPreview((p) => {
      track('note_preview_toggled', { preview: !p });
      return !p;
    });
  }, []);

  const confirmDelete = React.useCallback(() => {
    Alert.alert('Delete this note?', 'Word-bank items saved from it stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const s = stateRef.current;
          const target = s.noteId;
          s.deleted = true; // suppress the unmount flush
          if (timerRef.current) clearTimeout(timerRef.current);
          track('note_deleted', {});
          void (target ? repos.journal.deleteNote(target) : Promise.resolve()).then(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.notes });
            router.back();
          });
        },
      },
    ]);
  }, [queryClient, router]);

  const onSelection = React.useCallback((selection: FreeSelection) => {
    setBankTarget({ selection, source: 'note' });
  }, []);

  const hasBody = body.trim().length > 0;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* top bar */}
      <View className="flex-row items-center gap-3 px-4 py-2">
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text className="flex-1 font-ui-medium text-lg">{isNew ? 'New note' : 'Note'}</Text>
        <Pressable
          onPress={togglePreview}
          hitSlop={8}
          disabled={!hasBody}
          accessibilityLabel={preview ? 'Edit markdown' : 'Preview markdown'}
        >
          <Ionicons
            name={preview ? 'pencil-outline' : 'eye-outline'}
            size={23}
            color={hasBody ? theme.accent : theme.textMuted}
          />
        </Pressable>
        {(noteId != null || !isNew) && (
          <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete note">
            <Ionicons name="trash-outline" size={22} color={theme.textMuted} />
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={undefined} className="flex-1">
        <ScrollView
          className="flex-1 px-5"
          contentContainerClassName="pb-16"
          scrollEnabled={!selecting}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={title}
            onChangeText={(v) => {
              setTitle(v);
              stateRef.current.title = v;
              schedule();
            }}
            autoFocus={isNew}
            placeholder="Заголовок"
            placeholderTextColor={theme.textMuted}
            className="border-b border-border pb-2 font-ui-bold text-xl text-text"
            accessibilityLabel="Note title"
          />

          {preview ? (
            <View className="pt-4">
              <Text variant="caption" className="mb-3 font-ui">
                Tap a word or long-press and drag to save it to your word bank.
              </Text>
              <MarkdownView
                source={body}
                onSelection={onSelection}
                onSelectingChange={setSelecting}
              />
            </View>
          ) : (
            <TextInput
              value={body}
              onChangeText={(v) => {
                setBody(v);
                stateRef.current.body = v;
                schedule();
              }}
              multiline
              textAlignVertical="top"
              placeholder={'Markdown…  # заголовок, **жирный**, *курсив*, - список'}
              placeholderTextColor={theme.textMuted}
              className="min-h-[240px] pt-3 font-reading text-text"
              style={{ fontSize: 16, lineHeight: 26 }}
              accessibilityLabel="Note body (markdown)"
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BankSaveSheet target={bankTarget} onClose={() => setBankTarget(null)} />
    </View>
  );
}
