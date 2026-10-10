import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import {
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';

import { Text } from '@/components/ui/text';
import type { SentenceWithTokens, TokenRow } from '@/db/repositories/content';
import { TokenText } from '@/features/reader/token-text';
import { WordPopup, type WordPopupTarget } from '@/features/reader/word-popup';
import type { TorflLevel } from '../level-profile';
import { trackTorfl } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  passageKey,
  recallPassageOffset,
  rememberPassageOffset,
  showToTop,
} from './passage-scroll';

/** The passage scrolls inside this height so a 450-word text never pushes the question off screen. */
export const PASSAGE_MAX_HEIGHT = 420;

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
  // T76: scroll memory per passage — the next item's panel of the same story reopens where this one was.
  const key = passageKey(packId, storyId);
  const scrollRef = React.useRef<ScrollView>(null);
  const [offset, setOffset] = React.useState(() => recallPassageOffset(key));
  const restored = React.useRef(false);
  const onScroll = React.useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      rememberPassageOffset(key, y);
      setOffset(y);
    },
    [key],
  );
  const onContentSize = React.useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    const y = recallPassageOffset(key);
    if (y > 0) scrollRef.current?.scrollTo({ y, animated: false });
  }, [key]);

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
        <View className="border-t border-border">
          <ScrollView
            ref={scrollRef}
            style={{ maxHeight: PASSAGE_MAX_HEIGHT }}
            nestedScrollEnabled
            scrollEventThrottle={32}
            onScroll={onScroll}
            onContentSizeChange={onContentSize}
            testID="passage-scroll"
          >
            <View className="gap-2 px-4 py-3">
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
          </ScrollView>
          {showToTop(offset) && (
            <Pressable
              onPress={() => {
                scrollRef.current?.scrollTo({ y: 0, animated: true });
                rememberPassageOffset(key, 0);
                setOffset(0);
              }}
              accessibilityRole="button"
              accessibilityLabel="К началу текста"
              testID="passage-to-top"
              className="absolute bottom-2 right-3 flex-row items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1.5 active:opacity-80"
            >
              <Ionicons name="arrow-up" size={13} color={theme.accent} />
              <Text className="font-ui-medium text-xs text-accent">к началу</Text>
            </Pressable>
          )}
        </View>
      )}
      <WordPopup target={target} onClose={() => setTarget(null)} />
    </View>
  );
}
