import * as React from 'react';
import { Text as RNText, View } from 'react-native';

import type { TokenRow } from '@/db/repositories/content';
import { useAppTheme } from '@/theme/use-app-theme';
import { EXAM_READING_STYLE } from '@/features/torfl/items/passage-panel';

import type { SentenceChunk } from './lesson-model';

/**
 * A Russian sentence as wrapping word chunks (T90). Highlighted tokens get
 * the accent, semibold; the karaoke token washes its chunk with `bg-karaoke`
 * (the reader's token), full text colour. A word chunk taps through to the
 * reader's lookup via `onWordPress`; punctuation-only chunks are not tappable.
 */
export function SentenceLine({
  chunks,
  tokens,
  highlighted,
  karaokeTokenIndex,
  onWordPress,
}: {
  chunks: readonly SentenceChunk[];
  tokens: readonly TokenRow[];
  highlighted: ReadonlySet<number>;
  karaokeTokenIndex: number | null;
  onWordPress: (token: TokenRow) => void;
}) {
  const { tokens: theme } = useAppTheme();
  const fontSize =
    typeof EXAM_READING_STYLE.fontSize === 'number' ? EXAM_READING_STYLE.fontSize : 18;
  const gap = Math.round(fontSize * 0.26);
  return (
    <View
      className="flex-row flex-wrap"
      style={{ columnGap: gap }}
      accessible
      accessibilityLabel={chunks.map((c) => c.text).join(' ')}
    >
      {chunks.map((chunk, ci) => {
        const hot = chunk.tokenIndices.some((i) => highlighted.has(i));
        const karaoke =
          karaokeTokenIndex !== null && chunk.tokenIndices.includes(karaokeTokenIndex);
        const word = chunk.wordIndex >= 0 ? tokens[chunk.wordIndex] : undefined;
        return (
          <RNText
            key={ci}
            suppressHighlighting
            onPress={word ? () => onWordPress(word) : undefined}
            className={karaoke ? 'rounded-[3px] bg-karaoke' : undefined}
            style={[
              EXAM_READING_STYLE,
              { color: hot ? theme.accent : theme.text, fontWeight: hot ? '600' : '400' },
            ]}
          >
            {chunk.text}
          </RNText>
        );
      })}
    </View>
  );
}
