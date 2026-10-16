import * as React from 'react';
import { View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { Text } from '@/components/ui/text';

import type { ReviewRow } from './review-model';
import type { Verdict } from './runner-model';

/**
 * The review under exam conditions (decision 5): every item with the
 * learner's answer, the key, and the full explanation. Shown only after submit.
 */
export function ReviewList({ rows }: { rows: readonly ReviewRow[] }) {
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
        </View>
      ))}
    </View>
  );
}

function verdictLabel(v: Verdict): string {
  return v === 'full' ? 'Верно' : v === 'half' ? 'Почти' : 'Неверно';
}
