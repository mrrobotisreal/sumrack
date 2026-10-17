import * as React from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';

import type { CourseTable } from '@sumrak/schema';

import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Splits a cell on `**…**` so an authored ending can be bold accent (T90
 * decision 1). Pure. Unmatched markers render as plain text.
 */
export function splitBold(cell: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const parts = cell.split('**');
  // An odd split count means the markers paired up; the even ones are unmatched.
  if (parts.length % 2 === 0) return [{ text: cell, bold: false }];
  parts.forEach((text, i) => {
    if (text !== '') out.push({ text, bold: i % 2 === 1 });
  });
  return out;
}

/**
 * The card table as a real grid (T90 decision 1): a tinted header row, the
 * reading font (no monospace), endings in bold accent. Wide tables scroll
 * horizontally with fixed column widths (the M16 rule: never squish a cell).
 */
export function TableGrid({ table }: { table: CourseTable }) {
  const { tokens: theme } = useAppTheme();
  const cols = table.header.length;
  const colWidth = cols > 3 ? 150 : undefined;
  const rowBody = (cells: string[], header: boolean) => (
    <View className={`flex-row border-b border-border ${header ? 'bg-accent-soft' : ''}`}>
      {cells.map((cell, ci) => (
        <View key={ci} className="px-3 py-2" style={colWidth ? { width: colWidth } : { flex: 1 }}>
          <RNText
            style={{
              fontFamily: 'Literata_400Regular',
              fontSize: 15,
              lineHeight: 22,
              color: header ? theme.textMuted : theme.text,
              fontWeight: header ? '600' : '400',
            }}
          >
            {splitBold(cell).map((seg, si) => (
              <RNText
                key={si}
                style={seg.bold ? { color: theme.accent, fontWeight: '700' } : undefined}
              >
                {seg.text}
              </RNText>
            ))}
          </RNText>
        </View>
      ))}
    </View>
  );
  const grid = (
    <View className="overflow-hidden rounded-xl border border-border bg-surface">
      {rowBody(table.header, true)}
      {table.rows.map((row, ri) => (
        <React.Fragment key={ri}>{rowBody(row, false)}</React.Fragment>
      ))}
    </View>
  );
  return (
    <View className="gap-2" testID="table-grid">
      {table.caption ? (
        <RNText className="font-ui-medium text-sm text-text-muted">{table.caption}</RNText>
      ) : null}
      {cols > 3 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
          {grid}
        </ScrollView>
      ) : (
        grid
      )}
    </View>
  );
}
