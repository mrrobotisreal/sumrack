import * as React from 'react';
import { Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { diffWords, isUnchanged } from './diff';
import type { StoredFeedback } from './schemas';

/**
 * Rendered journal feedback (UI_DESIGN §7 `FeedbackDiff`): the corrected
 * entry as an inline word diff (deletions struck in danger, insertions in
 * success), each change's teaching note, then the tutor summary. Diffs
 * against the SOURCE text captured at request time, so later edits to the
 * entry never skew the rendering.
 */
export function FeedbackView({ feedback }: { feedback: StoredFeedback }) {
  const { tokens: theme } = useAppTheme();
  const segments = React.useMemo(
    () => diffWords(feedback.sourceRu, feedback.corrected),
    [feedback.sourceRu, feedback.corrected],
  );
  const clean = segments != null && isUnchanged(segments);

  return (
    <View className="gap-4">
      {/* corrected text as inline diff */}
      <View className="rounded-2xl border border-border bg-surface p-4">
        <Text variant="caption" className="mb-2 uppercase tracking-wider">
          {clean ? 'No corrections needed' : 'Corrections'}
        </Text>
        {segments ? (
          <RNText style={{ fontFamily: 'Literata_400Regular', fontSize: 17, lineHeight: 29 }}>
            {segments.map((seg, i) => (
              <RNText
                key={i}
                style={
                  seg.type === 'same'
                    ? { color: theme.text }
                    : seg.type === 'del'
                      ? {
                          color: theme.danger,
                          textDecorationLine: 'line-through',
                          opacity: 0.75,
                        }
                      : { color: theme.success, fontWeight: '600' }
                }
              >
                {(i > 0 ? ' ' : '') + seg.text}
              </RNText>
            ))}
          </RNText>
        ) : (
          // Entry too long for the word diff — show the corrected text plainly.
          <RNText
            style={{
              fontFamily: 'Literata_400Regular',
              fontSize: 17,
              lineHeight: 29,
              color: theme.text,
            }}
          >
            {feedback.corrected}
          </RNText>
        )}
      </View>

      {/* per-change explanations */}
      {feedback.changes.length > 0 && (
        <View className="gap-2.5">
          {feedback.changes.map((change, i) => (
            <View key={i} className="rounded-xl border border-border bg-surface px-4 py-3">
              <View className="flex-row flex-wrap items-baseline gap-x-2">
                {change.before.length > 0 && (
                  <RNText
                    className="font-reading text-base"
                    style={{ color: theme.danger, textDecorationLine: 'line-through' }}
                  >
                    {change.before}
                  </RNText>
                )}
                {change.before.length > 0 && change.after.length > 0 && (
                  <Text variant="caption">→</Text>
                )}
                {change.after.length > 0 && (
                  <RNText className="font-reading text-base" style={{ color: theme.success }}>
                    {change.after}
                  </RNText>
                )}
              </View>
              <Text variant="caption" className="mt-1.5 leading-5">
                {change.explanation}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* tutor summary */}
      <View className="rounded-2xl border border-accent/30 bg-surface p-4">
        <Text variant="caption" className="mb-1.5 uppercase tracking-wider">
          From your tutor
        </Text>
        <Text className="leading-6">{feedback.summary}</Text>
        <Text variant="caption" className="mt-2.5">
          {feedback.model.replace(/^anthropic\//, '')} ·{' '}
          {new Date(feedback.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </View>
    </View>
  );
}
