import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View, type TextStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import type { SentenceWithTokens, TokenRow } from '@/db/repositories/content';
import { TokenText } from '@/features/reader/token-text';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import type { TorflLevel } from '../level-profile';
import { trackTorfl } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/** Exam passage reading style (Literata, a touch under the reader's default so a text fits a screen). */
export const EXAM_READING_STYLE: TextStyle = {
  fontFamily: 'Literata_400Regular',
  fontSize: 18,
  lineHeight: 29,
};

/**
 * Collapsible reader-style passage (T70): the sentences a reading item
 * refers to, each a `TokenText` with tap-to-lookup through the reader's
 * `WordPopup` (bank / encounter behaviour is exactly the reader's).
 *
 * `lookup` is T71's dictionary rule: false renders plain words (no popup).
 * T70 decision recorded: when lookup is on inside a MOCK, banking from the
 * popup stays allowed — the official paper has a dictionary for Чтение, and
 * a looked-up word is learning data, not an exam answer.
 */
export function PassagePanel({
  packId,
  storyId,
  sentences,
  lookup,
  defaultOpen = true,
  subtestKind,
  level = 'A1',
  onLookup,
}: {
  packId: string;
  storyId: string;
  sentences: readonly SentenceWithTokens[];
  lookup: boolean;
  defaultOpen?: boolean;
  /** Analytics: the subtest kind for `exam_lookup_used` (mocks, T71). */
  subtestKind?: string;
  /** T75 (THE LEVEL RULE): the exam's level for `exam_lookup_used`. */
  level?: TorflLevel;
  onLookup?: () => void;
}) {
  const { tokens: theme } = useAppTheme();
  const [open, setOpen] = React.useState(defaultOpen);
  const [target, setTarget] = React.useState<WordPopupTarget | null>(null);

  const onWord = React.useCallback(
    (token: TokenRow, sentenceId: string) => {
      if (!lookup) return;
      setTarget({ token, sentenceId, storyId });
      onLookup?.();
      if (subtestKind) trackTorfl('exam_lookup_used', { subtestKind, level });
    },
    [lookup, storyId, subtestKind, level, onLookup],
  );

  return (
    <View
      className="overflow-hidden rounded-2xl border border-border bg-surface"
      testID="passage-panel"
    >
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-2 px-4 py-3 active:bg-surface-2"
      >
        <Ionicons name="reader-outline" size={16} color={theme.textMuted} />
        <Text className="flex-1 font-ui-medium text-sm">Текст</Text>
        {lookup && open && <Text variant="caption">нажми на слово</Text>}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textMuted} />
      </Pressable>
      {open && (
        <View className="gap-2 border-t border-border px-4 py-3">
          {sentences.map((s) => (
            <TokenText
              key={s.id}
              tokens={s.tokens}
              readingStyle={EXAM_READING_STYLE}
              onWordPress={(token) => onWord(token, s.id)}
              selectionEnabled={false}
            />
          ))}
        </View>
      )}
      <WordPopup target={target} onClose={() => setTarget(null)} />
    </View>
  );
}
