import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { ruPlural, type TextEntry } from './hub-model';

const SENTENCES = ['предложение', 'предложения', 'предложений'] as const;

const ROLE_LABELS: Record<TextEntry['roles'][number], string> = {
  passage: 'текст',
  audio: 'аудио',
  prompt: 'реплика',
  model: 'образец',
};

/**
 * One «Тексты» row (T69, TORFL §5.3): title, sentence count, the roles the
 * story plays in its exams, an audio icon; tap → the ordinary reader (lookup,
 * karaoke, bank) and `torfl_text_opened {packId, storyId, from}`.
 */
export function TextRow({ text, from }: { text: TextEntry; from: 'texts' | 'review' }) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const open = React.useCallback(() => {
    track('torfl_text_opened', { packId: text.packId, storyId: text.storyId, from });
    router.push({
      pathname: '/reader/[packId]/[storyId]',
      params: { packId: text.packId, storyId: text.storyId, from: 'torfl' },
    });
  }, [router, text.packId, text.storyId, from]);
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Открыть текст: ${text.titleRu}`}
      testID={`torfl-text-${text.storyId}`}
      className="mb-2 flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 active:bg-surface-2"
    >
      <View className="flex-1 gap-0.5">
        <Text className="font-reading text-base" numberOfLines={1}>
          {text.titleRu}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {text.sentenceCount} {ruPlural(text.sentenceCount, SENTENCES)}
          {text.roles.length > 0 ? ` · ${text.roles.map((r) => ROLE_LABELS[r]).join(', ')}` : ''}
        </Text>
      </View>
      {text.hasAudio && (
        <Ionicons
          name="volume-medium-outline"
          size={16}
          color={tokens.textMuted}
          accessibilityLabel="С аудио"
        />
      )}
      <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
    </Pressable>
  );
}
