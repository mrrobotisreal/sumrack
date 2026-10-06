import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';

import type { ReadinessView } from './hub-model';
import { SUBTEST_LABELS } from './topics';

/** The pass lines every bar carries (§6.3): 60 % (one subtest may sit here) and 66 %. */
const TICKS = [60, 66] as const;

/**
 * Readiness bars (T69 renders the «—» placeholders; T70 passes real
 * `ReadinessView`s). Neutral tokens only for now — the band colours become
 * tokens in T70 (ticket risk note). `compact` = the Library hub card's
 * mini-bars (no source line).
 */
export function ReadinessBars({
  rows,
  compact = false,
}: {
  rows: readonly ReadinessView[];
  compact?: boolean;
}) {
  return (
    <View className={compact ? 'gap-1.5' : 'gap-3'}>
      {rows.map((row) => (
        <View key={row.kind} className="gap-1">
          <View className="flex-row items-center gap-2">
            <Text
              variant={compact ? 'caption' : undefined}
              className={cn(compact ? 'w-24 text-xs' : 'flex-1 font-ui-medium')}
              numberOfLines={1}
            >
              {SUBTEST_LABELS[row.kind].short}
            </Text>
            {compact && <Bar pct={row.pct} compact />}
            <Text
              variant="caption"
              className={cn('text-right', compact ? 'w-9 text-xs' : 'w-12')}
              accessibilityLabel={
                row.pct === null ? `${SUBTEST_LABELS[row.kind].ru}: нет данных` : undefined
              }
            >
              {row.pct === null ? '—' : `${Math.round(row.pct)} %`}
            </Text>
          </View>
          {!compact && (
            <>
              <Bar pct={row.pct} />
              <Text variant="caption" className="text-xs">
                {row.label}
              </Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

function Bar({ pct, compact = false }: { pct: number | null; compact?: boolean }) {
  return (
    <View
      className={cn('overflow-hidden rounded-full bg-surface-2', compact ? 'h-1.5 flex-1' : 'h-2')}
    >
      {pct !== null && (
        <View
          className="absolute bottom-0 left-0 top-0 rounded-full bg-text-muted"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      )}
      {TICKS.map((t) => (
        <View
          key={t}
          className="absolute bottom-0 top-0 w-px bg-border"
          style={{ left: `${t}%` }}
        />
      ))}
    </View>
  );
}
