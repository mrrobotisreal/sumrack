import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { SPOKEN_COMMANDS } from '../commands';

/**
 * The «?» sheet (T62 §9.3 / §6): the five spoken commands, RU + EN, and the
 * hold-to-talk tip for noisy rooms (§12). Text about the mechanism, never
 * the answer.
 */
export function CommandsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close commands"
        className="flex-1 justify-end bg-scrim/70"
      >
        <Pressable
          onPress={() => undefined}
          className="gap-3 rounded-t-3xl border border-border bg-surface px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 20 }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="font-ui-medium text-lg">Что можно сказать</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="h-9 w-9 items-center justify-center rounded-full active:bg-surface-2"
            >
              <Ionicons name="close" size={18} color={tokens.textMuted} />
            </Pressable>
          </View>
          <Text variant="caption">
            Speak these any time instead of an answer — the host stays in character. They never
            count as a miss.
          </Text>
          <View className="gap-2.5">
            {SPOKEN_COMMANDS.map((c) => (
              <View key={c.intent} className="flex-row items-start gap-3">
                <View className="mt-1 h-7 w-7 items-center justify-center rounded-full bg-surface-2">
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={tokens.accent} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-baseline gap-2">
                    <RNText className="font-reading text-lg text-text">{c.ru}</RNText>
                    <Text variant="caption">{c.en}</Text>
                  </View>
                  <Text variant="caption">{c.hint}</Text>
                </View>
              </View>
            ))}
          </View>
          <View className="mt-1 flex-row items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
            <Ionicons name="hand-left-outline" size={15} color={tokens.textMuted} />
            <Text variant="caption" className="flex-1">
              Noisy room? Press and hold the mic to talk, release to send. Settings → Scenarios
              makes hold the primary gesture.
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
