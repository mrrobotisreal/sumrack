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

import { SelectableText, type FreeSelection } from '@/components/selectable-text';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { queryKeys, useJournalEntry } from '@/db/hooks';
import type { JournalEntryRow } from '@/db/repositories/journal';
import { chunkText } from '@/lib/free-text';
import { track } from '@/services/analytics';
import { getSpeechService, speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import { BankSaveSheet, type BankSaveTarget } from './bank-save-sheet';
import { useDailyPrompt, usePromptById } from './daily-prompt';
import { FeedbackBadge } from './feedback-badge';

const AUTOSAVE_MS = 800;

/** Entry text is validated before every persist (roadmap §3: Zod at I/O boundaries). */
const EntryTextSchema = z.string().min(1).max(20_000);

interface EntryEditorScreenProps {
  /** 'new' or an existing entry id. */
  id: string;
  /** Optional prompt preselected from the tab's prompt-of-the-day card. */
  promptId?: string;
}

/**
 * Route-level wrapper: loads the existing entry (or nothing for 'new') and
 * mounts the editor with its initial values — the remount-per-target
 * pattern (T05 sheets), which keeps the editor free of load-sync effects.
 */
export function EntryEditorScreen({ id, promptId }: EntryEditorScreenProps) {
  const isNew = id === 'new';
  const existing = useJournalEntry(isNew ? undefined : id);

  if (isNew) {
    return <EntryEditor key="new" entry={null} pinnedPromptId={promptId} />;
  }
  if (existing.isLoading || !existing.data) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }
  return <EntryEditor key={id} entry={existing.data} pinnedPromptId={undefined} />;
}

/**
 * Journal entry editor (design §7.4): Russian free writing with debounced
 * autosave, daily prompt (skippable → freeform), Piper readback, and a read
 * mode hosting the highlight-to-bank gesture. The "Get feedback" affordance
 * is deliberately inert — T16 owns the AI call; this ticket ships zero
 * network.
 */
function EntryEditor({
  entry,
  pinnedPromptId,
}: {
  entry: JournalEntryRow | null;
  pinnedPromptId: string | undefined;
}) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const isNew = entry === null;
  const [text, setText] = React.useState(entry?.ru ?? '');
  /** The persisted row id — state so the UI reacts to first-save. */
  const [entryId, setEntryId] = React.useState<string | null>(entry?.id ?? null);
  const [readMode, setReadMode] = React.useState(false);
  const [speaking, setSpeaking] = React.useState(false);
  const [selecting, setSelecting] = React.useState(false);
  const [bankTarget, setBankTarget] = React.useState<BankSaveTarget | null>(null);
  const [speechAvailable] = React.useState(() => getSpeechService().available);

  // Prompt: an existing entry shows its saved prompt; a new one runs the
  // daily rotation (param from the tab card pins the start) until dismissed.
  const [promptDismissed, setPromptDismissed] = React.useState(false);
  // Skipping releases the pin (tab-card param) back into the daily rotation.
  const [pinReleased, setPinReleased] = React.useState(false);
  const daily = useDailyPrompt();
  const pinned = usePromptById(isNew ? pinnedPromptId : entry.promptId);
  const activePrompt = isNew
    ? pinReleased
      ? daily.prompt
      : (pinned.data ?? daily.prompt)
    : (pinned.data ?? null);
  const showPromptCard = isNew ? !promptDismissed && !!activePrompt : !!activePrompt;

  const skipPrompt = () => {
    setPinReleased(true);
    daily.skipPrompt();
  };

  // Mutable bookkeeping for handlers/timers only — never read during render.
  const stateRef = React.useRef({
    entryId: entry?.id ?? null,
    savedText: entry?.ru ?? '',
    text: entry?.ru ?? '',
    attachPromptId: null as string | null,
    deleted: false,
  });
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest-value sync for the autosave closure (T05 handlersRef pattern).
  React.useEffect(() => {
    stateRef.current.attachPromptId =
      isNew && !promptDismissed && activePrompt ? activePrompt.id : null;
  });

  const persist = React.useCallback(async () => {
    const s = stateRef.current;
    if (s.deleted) return;
    const normalized = s.text.normalize('NFC');
    const parsed = EntryTextSchema.safeParse(normalized);
    if (!parsed.success || parsed.data.trim().length === 0) return;
    if (parsed.data === s.savedText) return;
    if (!s.entryId) {
      const row = await repos.journal.createEntry({
        ru: parsed.data,
        promptId: s.attachPromptId ?? undefined,
      });
      s.entryId = row.id;
      setEntryId(row.id);
      track('journal_entry_created', { withPrompt: !!s.attachPromptId });
      if (s.attachPromptId) {
        track('journal_prompt_used', { promptId: s.attachPromptId, from: 'editor' });
      }
    } else {
      await repos.journal.updateEntry(s.entryId, { ru: parsed.data });
      track('journal_entry_autosaved', { chars: parsed.data.length });
    }
    s.savedText = parsed.data;
    void queryClient.invalidateQueries({ queryKey: queryKeys.journalEntries });
    void queryClient.invalidateQueries({ queryKey: queryKeys.journalEntry(s.entryId) });
  }, [queryClient]);

  const onChangeText = React.useCallback(
    (value: string) => {
      setText(value);
      stateRef.current.text = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void persist(), AUTOSAVE_MS);
    },
    [persist],
  );

  // Flush pending autosave on unmount (back navigation, app background).
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void persist();
      void getSpeechService().stop();
    },
    [persist],
  );

  const toggleReadback = React.useCallback(() => {
    if (speaking) {
      void getSpeechService().stop();
      setSpeaking(false);
      return;
    }
    const value = stateRef.current.text.trim();
    if (!value) return;
    track('journal_readback_used', { chars: value.length });
    setSpeaking(true);
    void speak(value).catch(() => setSpeaking(false));
  }, [speaking]);

  const confirmDelete = React.useCallback(() => {
    Alert.alert(
      'Delete this entry?',
      'The entry and its text are removed. Word-bank items saved from it stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const s = stateRef.current;
            const target = s.entryId;
            s.deleted = true; // suppress the unmount flush
            if (timerRef.current) clearTimeout(timerRef.current);
            track('journal_entry_deleted', {});
            void (target ? repos.journal.deleteEntry(target) : Promise.resolve()).then(() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.journalEntries });
              router.back();
            });
          },
        },
      ],
    );
  }, [queryClient, router]);

  const onSelection = React.useCallback((selection: FreeSelection) => {
    setBankTarget({
      selection,
      source: 'journal',
      journalEntryId: stateRef.current.entryId ?? undefined,
    });
  }, []);

  const paragraphs = React.useMemo(
    () =>
      readMode
        ? text
            .split(/\n+/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        : [],
    [readMode, text],
  );

  const status = entry?.feedbackStatus ?? 'none';
  const hasText = text.trim().length > 0;

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top }}>
      {/* top bar */}
      <View className="flex-row items-center gap-3 px-4 py-2">
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </Pressable>
        <Text className="flex-1 font-ui-medium text-lg">
          {entry ? formatDateTitle(entry.createdAt) : 'New entry'}
        </Text>
        <Pressable
          onPress={toggleReadback}
          hitSlop={8}
          disabled={!speechAvailable || !hasText}
          accessibilityLabel={speaking ? 'Stop readback' : 'Read entry aloud'}
        >
          <Ionicons
            name={speaking ? 'stop-circle-outline' : 'volume-high-outline'}
            size={24}
            color={speechAvailable && hasText ? theme.accent : theme.textMuted}
          />
        </Pressable>
        <Pressable
          onPress={() => {
            setReadMode((m) => {
              track('journal_read_mode_toggled', { readMode: !m });
              return !m;
            });
          }}
          hitSlop={8}
          disabled={!hasText}
          accessibilityLabel={readMode ? 'Edit entry' : 'Read & highlight mode'}
        >
          <Ionicons
            name={readMode ? 'pencil-outline' : 'color-wand-outline'}
            size={23}
            color={hasText ? theme.text : theme.textMuted}
          />
        </Pressable>
        {(entryId != null || !isNew) && (
          <Pressable onPress={confirmDelete} hitSlop={8} accessibilityLabel="Delete entry">
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
          {/* prompt card */}
          {showPromptCard && activePrompt && (
            <View className="mb-4 rounded-2xl border border-accent/30 bg-surface p-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="flame-outline" size={13} color={theme.accent} />
                <Text variant="caption" className="flex-1 uppercase tracking-wider">
                  Prompt · {activePrompt.level}
                </Text>
                {isNew && (
                  <>
                    <Pressable onPress={skipPrompt} hitSlop={8} accessibilityLabel="Next prompt">
                      <Ionicons name="shuffle-outline" size={18} color={theme.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        track('journal_prompt_dismissed', { promptId: activePrompt.id });
                        setPromptDismissed(true);
                      }}
                      hitSlop={8}
                      accessibilityLabel="Write freeform instead"
                    >
                      <Ionicons name="close" size={18} color={theme.textMuted} />
                    </Pressable>
                  </>
                )}
              </View>
              <Text className="mt-2 font-reading text-lg leading-7">{activePrompt.promptRu}</Text>
              <Text variant="caption" className="mt-1">
                {activePrompt.promptEn}
              </Text>
            </View>
          )}

          {readMode ? (
            <View className="gap-4">
              <Text variant="caption" className="font-ui">
                Tap a word or long-press and drag to save it to your word bank.
              </Text>
              {paragraphs.map((para, i) => (
                <SelectableText
                  key={i}
                  chunks={chunkText(para)}
                  textStyle={{ fontFamily: 'Literata_400Regular', fontSize: 19, lineHeight: 31 }}
                  onSelection={onSelection}
                  onSelectingChange={setSelecting}
                />
              ))}
            </View>
          ) : (
            <TextInput
              value={text}
              onChangeText={onChangeText}
              multiline
              autoFocus={isNew}
              textAlignVertical="top"
              placeholder="Пиши по-русски…"
              placeholderTextColor={theme.textMuted}
              className="min-h-[240px] font-reading text-text"
              style={{ fontSize: 19, lineHeight: 31 }}
              accessibilityLabel="Journal entry text"
            />
          )}

          {/* feedback affordance — inert until T16 */}
          {entryId != null && (
            <View className="mt-8 flex-row items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 opacity-70">
              <Ionicons name="sparkles-outline" size={18} color={theme.textMuted} />
              <View className="flex-1">
                <Text className="font-ui-medium text-sm text-text-muted">Get AI feedback</Text>
                <Text className="text-xs text-text-muted">Coming soon — works online only.</Text>
              </View>
              <FeedbackBadge status={status} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BankSaveSheet target={bankTarget} onClose={() => setBankTarget(null)} />
    </View>
  );
}

function formatDateTitle(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
