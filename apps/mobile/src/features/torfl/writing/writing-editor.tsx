import { Ionicons } from '@expo/vector-icons';
import type { WritingItem } from '@sumrak/schema';
import * as React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { formatClock, timerTone } from '../engine/rules';
import type { TorflLevel } from '../level-profile';
import { WritingLookupSheet } from './lookup-sheet';
import {
  countersLine,
  isNoteTopic,
  wordAtSelection,
  writingChecklist,
  writingCounters,
} from './writing-model';

const TIMER_TONE_CLASS = {
  normal: 'text-text',
  amber: 'text-track-warm',
  red: 'text-danger',
} as const;

/** Keystroke → persisted draft debounce (a kill loses at most this much typing). */
export const DRAFT_DEBOUNCE_MS = 600;

/**
 * The letter editor (T72, TORFL §8.3) — shared by the mock runner (timed,
 * counters only, lookup per the dictionary rule) and the practice mode
 * (untimed, the bullets as a live checklist). The task and its bullet
 * points sit above exactly as printed; the editor is Literata ≥ 18 px with
 * the Russian keyboard hint; «Словарь» opens the lookup sheet pre-filled
 * with the selected word; «Сдать» confirms through the host.
 *
 * Every edit calls `onDraft` after a short debounce (and on blur /
 * unmount), so a kill mid-letter never loses the text (the host persists it
 * as the `writing` answer).
 */
export function WritingEditor({
  item,
  initialText,
  mode,
  remainingMs,
  lookup,
  subtestKind = 'writing',
  level,
  onDraft,
  onSubmit,
  onQuit,
  footer,
  header,
  heading,
}: {
  item: WritingItem;
  initialText: string;
  mode: 'mock' | 'practice';
  /** Mock: the wall-clock remaining (the host ticks); practice: undefined. */
  remainingMs?: number;
  lookup: boolean;
  subtestKind?: string;
  /** T75 (THE LEVEL RULE): the exam's level for the dictionary's analytics. */
  level?: TorflLevel;
  onDraft: (text: string) => void;
  onSubmit: (text: string) => void;
  onQuit: () => void;
  /** Practice: rendered under the editor (model letter / feedback). */
  footer?: React.ReactNode;
  /** T76: rendered between the top bar and the task — the mock's «Задание 1 · Задание 2» stepper. */
  header?: React.ReactNode;
  /** T76: overrides the top-bar title (default «Письмо»). */
  heading?: string;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = React.useState(initialText);
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const [lookupQuery, setLookupQuery] = React.useState('');
  const selectionRef = React.useRef({ start: 0, end: 0 });
  const textRef = React.useRef(text);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDraftRef = React.useRef(onDraft);
  React.useEffect(() => {
    onDraftRef.current = onDraft;
  });

  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onDraftRef.current(textRef.current);
  }, []);
  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        onDraftRef.current(textRef.current);
      }
    },
    [],
  );
  const change = (next: string) => {
    setText(next);
    textRef.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
  };

  const counters = writingCounters(item, text);
  const checklist = mode === 'practice' ? writingChecklist(item, text) : null;
  const tone = remainingMs !== undefined ? timerTone(remainingMs) : 'normal';
  const empty = text.trim().length === 0;

  const openLookup = () => {
    const { start, end } = selectionRef.current;
    setLookupQuery(wordAtSelection(text, start, end));
    setLookupOpen(true);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ paddingTop: insets.top + 4 }}
      testID="exam-writing"
    >
      {/* top bar */}
      <View className="flex-row items-center gap-2 px-3 pb-2">
        <Pressable
          onPress={onQuit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={mode === 'mock' ? 'Выйти из экзамена' : 'Назад'}
          testID="writing-quit"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons
            name={mode === 'mock' ? 'close' : 'arrow-back'}
            size={22}
            color={tokens.textMuted}
          />
        </Pressable>
        <View className="flex-1">
          <Text className="font-ui-medium" numberOfLines={1}>
            {heading ?? 'Письмо'}
            {mode === 'practice' ? ' · тренировка' : ''}
          </Text>
          <Text variant="caption" className="text-xs" testID="writing-counters">
            {countersLine(counters, item.topic)}
          </Text>
        </View>
        {remainingMs !== undefined ? (
          <Text
            className={cn('font-ui-bold text-lg tabular-nums', TIMER_TONE_CLASS[tone])}
            testID="exam-timer"
          >
            {formatClock(remainingMs)}
          </Text>
        ) : (
          <Ionicons name="infinite-outline" size={20} color={tokens.textMuted} />
        )}
        {lookup && (
          <Pressable
            onPress={openLookup}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Словарь"
            testID="writing-lookup-button"
            className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
          >
            <Ionicons name="book-outline" size={20} color={tokens.accent} />
          </Pressable>
        )}
      </View>

      {header}

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        {/* the task as printed */}
        <View className="gap-2 rounded-2xl border border-border bg-surface px-4 py-4">
          <RNText className="font-reading text-lg leading-7 text-text">{item.task.ru}</RNText>
          <View className="mt-1 gap-1.5">
            {(
              checklist ??
              item.bullets.map((b) => ({ id: b.id, ru: b.text.ru, en: b.text.en, done: false }))
            ).map((row) => (
              <View key={row.id} className="flex-row items-start gap-2" testID={`bullet-${row.id}`}>
                {checklist ? (
                  <Ionicons
                    name={row.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={row.done ? tokens.success : tokens.textMuted}
                    style={{ marginTop: 3 }}
                    testID={row.done ? `bullet-${row.id}-done` : undefined}
                  />
                ) : (
                  <Text className="text-text-muted">•</Text>
                )}
                <RNText
                  className={cn(
                    'flex-1 font-reading text-base leading-6',
                    row.done ? 'text-success' : 'text-text',
                  )}
                >
                  {row.ru}
                </RNText>
              </View>
            ))}
          </View>
          <Text variant="caption" className="mt-1">
            Не менее {item.minSentences} предложений
            {item.minQuestions > 0
              ? `, ${item.minQuestions}${item.maxQuestions ? `–${item.maxQuestions}` : ''} ${
                  item.minQuestions === 1 && !item.maxQuestions ? 'вопрос' : 'вопроса(ов)'
                }`
              : ''}
            .{lookup ? ' Можно пользоваться словарём.' : ''}
          </Text>
        </View>

        {/* the editor — a note (A2 task 2) sits in a messenger-bubble frame: visual only (T76) */}
        {isNoteTopic(item.topic) && (
          <View className="flex-row items-center gap-2 px-1" testID="note-frame-header">
            <View className="h-7 w-7 items-center justify-center rounded-full bg-accent-soft">
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={tokens.accent} />
            </View>
            <Text variant="caption" className="font-ui-medium">
              Сообщение другу
            </Text>
          </View>
        )}
        <TextInput
          value={text}
          onChangeText={change}
          onBlur={flush}
          onSelectionChange={(e) => {
            selectionRef.current = e.nativeEvent.selection;
          }}
          multiline
          textAlignVertical="top"
          autoCapitalize="sentences"
          autoCorrect={false}
          spellCheck={false}
          placeholder="Привет, …"
          placeholderTextColor={tokens.textMuted}
          testID="writing-input"
          accessibilityLabel={isNoteTopic(item.topic) ? 'The message' : 'The letter'}
          className={cn(
            'rounded-2xl border border-border bg-surface px-4 py-4 text-text',
            isNoteTopic(item.topic) ? 'min-h-[180px] rounded-bl-md border-accent' : 'min-h-[260px]',
          )}
          style={{ fontFamily: 'Literata_400Regular', fontSize: 18, lineHeight: 29 }}
        />
        <Text variant="caption">
          Включи русскую клавиатуру. Счётчики считают предложения по точкам и вопросительным знакам.
        </Text>

        {footer}
      </ScrollView>

      {/* bottom bar */}
      <View
        className="flex-row items-center gap-3 border-t border-border bg-bg px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Pressable
          onPress={() => {
            flush();
            onSubmit(textRef.current);
          }}
          disabled={empty && mode === 'practice'}
          accessibilityRole="button"
          testID="writing-submit"
          className={cn(
            'flex-1 items-center rounded-full px-5 py-3.5',
            empty && mode === 'practice' ? 'bg-surface-2' : 'bg-accent active:opacity-80',
          )}
        >
          <Text
            className={cn(
              'font-ui-bold',
              empty && mode === 'practice' ? 'text-text-muted' : 'text-bg',
            )}
          >
            Сдать
          </Text>
        </Pressable>
      </View>

      <WritingLookupSheet
        open={lookupOpen}
        initialQuery={lookupQuery}
        subtestKind={subtestKind}
        level={level}
        onClose={() => setLookupOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}
