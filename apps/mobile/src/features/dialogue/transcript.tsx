import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View, type TextStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import type { TokenRow } from '@/db/repositories/content';
import type { DialogueGraph } from '@/db/repositories/dialogues';
import { TokenText } from '@/features/reader/token-text';
import { useAppTheme } from '@/theme/use-app-theme';

import { characterById, type ChoiceEntry, type NodeEntry } from './engine';

/**
 * Chat-transcript bubbles (T27, UI_DESIGN §9 `DialogueTranscript`): NPC
 * lines left in surface bubbles, player lines (scripted or chosen) right in
 * accent-tinted ones. Every line is TokenText — tap-word lookup identical to
 * the reader; phrase selection stays off in the chat (recorded deviation:
 * long-press has other jobs here and must never fight transcript scroll).
 */

/** Fixed dialogue reading style (reader typography prefs stay reader-scoped). */
export const DIALOGUE_READING_STYLE: TextStyle = {
  fontFamily: 'Literata_400Regular',
  fontSize: 19,
  lineHeight: 30,
};

export type OnDialogueWordPress = (token: TokenRow, sentenceId: string) => void;

export function NodeBubble({
  entry,
  graph,
  isCurrent,
  karaokeTokenIndex,
  sentenceWash,
  onWordPress,
  onReplay,
}: {
  entry: NodeEntry;
  graph: DialogueGraph;
  isCurrent: boolean;
  karaokeTokenIndex: number | null;
  sentenceWash: boolean;
  onWordPress: OnDialogueWordPress;
  /** Replays this line (current node: main player; else ephemeral/TTS). */
  onReplay: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const { node } = entry;
  const isPlayer = node.speakerId === 'player';
  const speaker = characterById(graph, node.speakerId);
  const sentence = node.sentence;

  return (
    <View className={isPlayer ? 'items-end' : 'items-start'}>
      <View
        className={
          isPlayer
            ? 'max-w-[88%] rounded-2xl rounded-br-md border border-accent/30 bg-accent-soft px-4 py-3'
            : `max-w-[88%] rounded-2xl rounded-bl-md border px-4 py-3 ${
                isCurrent && sentenceWash
                  ? 'border-accent/40 bg-accent-soft'
                  : 'border-border bg-surface'
              }`
        }
      >
        <View className="mb-1 flex-row items-center gap-2">
          <Text variant="caption" className="uppercase tracking-wider">
            {isPlayer ? 'Ты' : (speaker?.name.ru ?? node.speakerId)}
          </Text>
          <Pressable
            onPress={onReplay}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Replay this line"
            className="active:opacity-60"
          >
            <Ionicons name="volume-medium-outline" size={15} color={theme.accent} />
          </Pressable>
        </View>
        {sentence ? (
          <TokenText
            tokens={sentence.tokens}
            readingStyle={DIALOGUE_READING_STYLE}
            onWordPress={(token) => onWordPress(token, sentence.id)}
            selectionEnabled={false}
            karaokeTokenIndex={isCurrent ? karaokeTokenIndex : null}
          />
        ) : (
          <RNText style={[DIALOGUE_READING_STYLE, { color: theme.textMuted }]}>…</RNText>
        )}
      </View>
    </View>
  );
}

export function ChoiceBubble({
  entry,
  onWordPress,
}: {
  entry: ChoiceEntry;
  onWordPress: OnDialogueWordPress;
}) {
  const { tokens: theme } = useAppTheme();
  const sentence = entry.choice.sentence;
  return (
    <View className="items-end">
      <View className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/30 bg-accent-soft px-4 py-3">
        <View className="mb-1 flex-row items-center gap-2">
          <Text variant="caption" className="uppercase tracking-wider">
            Ты
          </Text>
          {entry.score !== undefined && (
            <View className="flex-row items-center gap-1">
              <Ionicons name="mic-outline" size={12} color={theme.textMuted} />
              <Text variant="caption">{Math.round(entry.score)}%</Text>
            </View>
          )}
        </View>
        {sentence ? (
          <TokenText
            tokens={sentence.tokens}
            readingStyle={DIALOGUE_READING_STYLE}
            onWordPress={(token) => onWordPress(token, sentence.id)}
            selectionEnabled={false}
          />
        ) : (
          <RNText style={[DIALOGUE_READING_STYLE, { color: theme.textMuted }]}>…</RNText>
        )}
      </View>
    </View>
  );
}
