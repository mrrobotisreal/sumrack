import type { CourseItem } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { Text } from '@/components/ui/text';

import type { ReviewRow } from './review-model';
import type { Verdict } from './runner-model';

/**
 * The review under exam conditions (decision 5): every item with the
 * learner's answer, the key, and the full explanation. Shown only after submit.
 * «Объясни ещё ✦» is offered here (T92 carried #1): the review is never mid-exam.
 */
export function ReviewList({
  rows,
  onExplainMore,
}: {
  rows: readonly ReviewRow[];
  /** Present only when the mode allows it (review phase). `chosen` is the learner's pick, when named. */
  onExplainMore?: (item: CourseItem, chosen: string | undefined) => void;
}) {
  return (
    <View className="gap-4" testID="review-list">
      {rows.map((row, i) => (
        <View
          key={row.item.id}
          className="gap-2 rounded-xl border border-border bg-surface px-4 py-3"
          testID="review-row"
        >
          <Text className="font-ui-medium text-sm text-text-muted">
            {`${i + 1}. ${verdictLabel(row.verdict)}`}
          </Text>
          <Text variant="muted">{`Ваш ответ: ${row.yourAnswer}`}</Text>
          <Text className="font-ui-medium">{`Ключ: ${row.key}`}</Text>
          <MarkdownView source={row.item.explain ?? ''} />
          {onExplainMore ? (
            <Pressable
              onPress={() =>
                onExplainMore(row.item, row.yourAnswer === '—' ? undefined : row.yourAnswer)
              }
              accessibilityRole="button"
              testID="review-explain-more"
              className="self-start rounded-xl border border-border px-4 py-2.5 active:bg-surface-2"
            >
              <Text className="font-ui-medium text-sm">Объясни ещё ✦</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function verdictLabel(v: Verdict): string {
  return v === 'full' ? 'Верно' : v === 'half' ? 'Почти' : 'Неверно';
}
