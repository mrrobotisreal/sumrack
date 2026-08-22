import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useJournalEntries, useNotes } from '@/db/hooks';
import type { JournalEntryRow, NoteRow } from '@/db/repositories/journal';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { useDailyPrompt } from './daily-prompt';
import { FeedbackBadge } from './feedback-badge';

type Section = 'entries' | 'notes';

/**
 * Журнал tab (design §7.4): journal entries + markdown study notes behind
 * one segmented header, FTS search entry point in the tab header, daily
 * prompt card up top, FAB to write. Lists are reverse-chronological
 * (entries by created, notes by last edit — §7.4 "organization by updated").
 */
export function JournalScreen() {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const [section, setSection] = React.useState<Section>('entries');

  const entries = useJournalEntries();
  const notes = useNotes();
  const { prompt } = useDailyPrompt();

  useFocusEffect(
    React.useCallback(() => {
      track('tab_viewed', { tab: 'Журнал' });
    }, []),
  );

  const switchSection = (next: Section) => {
    if (next === section) return;
    setSection(next);
    track('journal_section_changed', { section: next });
  };

  const openNew = () => {
    if (section === 'entries') {
      router.push({ pathname: '/journal/[id]', params: { id: 'new' } });
    } else {
      router.push({ pathname: '/notes/[id]', params: { id: 'new' } });
    }
  };

  return (
    <View className="flex-1 bg-bg">
      {/* segmented header */}
      <View className="flex-row gap-2 px-4 pb-3 pt-3">
        <SegmentButton
          label="Записи"
          active={section === 'entries'}
          onPress={() => switchSection('entries')}
        />
        <SegmentButton
          label="Заметки"
          active={section === 'notes'}
          onPress={() => switchSection('notes')}
        />
      </View>

      {section === 'entries' ? (
        <FlatList
          data={entries.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-28 gap-2"
          ListHeaderComponent={
            prompt ? (
              <Pressable
                onPress={() => {
                  track('journal_prompt_used', { promptId: prompt.id, from: 'tab-card' });
                  router.push({
                    pathname: '/journal/[id]',
                    params: { id: 'new', promptId: prompt.id },
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Write about today's prompt"
                className="mb-2 rounded-2xl border border-accent/30 bg-surface p-4 active:opacity-80"
              >
                <View className="flex-row items-center gap-2">
                  <Ionicons name="flame-outline" size={14} color={theme.accent} />
                  <Text variant="caption" className="uppercase tracking-wider">
                    Prompt of the day
                  </Text>
                </View>
                <Text className="mt-2 font-reading text-lg leading-7">{prompt.promptRu}</Text>
                <Text variant="caption" className="mt-1">
                  {prompt.promptEn}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            entries.isLoading ? null : (
              <EmptyState
                icon="book-outline"
                ru="Журнал ждёт твоих слов."
                en="No entries yet — write your first one, even three sentences count."
              />
            )
          }
          renderItem={({ item }) => (
            <EntryRow
              entry={item}
              onPress={() => {
                track('journal_entry_opened', { id: item.id });
                router.push({ pathname: '/journal/[id]', params: { id: item.id } });
              }}
            />
          )}
        />
      ) : (
        <FlatList
          data={notes.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-28 gap-2"
          ListEmptyComponent={
            notes.isLoading ? null : (
              <EmptyState
                icon="document-text-outline"
                ru="Пока ни одной заметки."
                en="Markdown study notes live here — grammar tables, mnemonics, anything."
              />
            )
          }
          renderItem={({ item }) => (
            <NoteRowView
              note={item}
              onPress={() => {
                track('note_opened', { id: item.id });
                router.push({ pathname: '/notes/[id]', params: { id: item.id } });
              }}
            />
          )}
        />
      )}

      {/* write FAB */}
      <Pressable
        onPress={openNew}
        accessibilityRole="button"
        accessibilityLabel={section === 'entries' ? 'New journal entry' : 'New note'}
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent active:opacity-80"
        style={{ elevation: 4 }}
      >
        <Ionicons
          name={section === 'entries' ? 'create-outline' : 'add'}
          size={26}
          color={theme.bg}
        />
      </Pressable>
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`rounded-full border px-4 py-1.5 ${
        active ? 'border-accent bg-accent-soft' : 'border-border bg-surface'
      }`}
    >
      <Text className={`font-ui-medium text-sm ${active ? 'text-accent' : 'text-text-muted'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function snippet(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function EntryRow({ entry, onPress }: { entry: JournalEntryRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-2xl border border-border bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="font-ui-medium">
          {formatDate(entry.createdAt)}
        </Text>
        <FeedbackBadge status={entry.feedbackStatus} />
      </View>
      <Text className="mt-1.5 font-reading text-base leading-6" numberOfLines={2}>
        {snippet(entry.ru) || '—'}
      </Text>
    </Pressable>
  );
}

function NoteRowView({ note, onPress }: { note: NoteRow; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="rounded-2xl border border-border bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-ui-medium text-base" numberOfLines={1}>
          {note.title}
        </Text>
        <Text variant="caption">{formatDate(note.updatedAt)}</Text>
      </View>
      {note.body.trim() ? (
        <Text variant="caption" className="mt-1" numberOfLines={2}>
          {snippet(note.body)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function EmptyState({
  icon,
  ru,
  en,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  ru: string;
  en: string;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="items-center px-8 pt-24">
      <Ionicons name={icon} size={40} color={theme.textMuted} />
      <Text className="mt-4 text-center font-reading-italic text-lg text-text-muted">{ru}</Text>
      <Text variant="caption" className="mt-2 text-center">
        {en}
      </Text>
    </View>
  );
}
