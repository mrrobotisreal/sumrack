import * as React from 'react';
import { Text as RNText, View } from 'react-native';

import { useAppTheme } from '@/theme/use-app-theme';

import { splitStemAtGap } from '../scoring';

/**
 * A choice stem with its single gap («…») highlighted; once answered the gap
 * is filled with the chosen/correct option (`fill`), coloured by `fillTone`.
 */
export function StemText({
  stem,
  fill,
  fillTone = 'accent',
}: {
  stem: string;
  fill?: string | null;
  fillTone?: 'accent' | 'success' | 'danger';
}) {
  const { tokens } = useAppTheme();
  const { before, gap, after } = splitStemAtGap(stem);
  const color =
    fillTone === 'success' ? tokens.success : fillTone === 'danger' ? tokens.danger : tokens.accent;
  return (
    <RNText className="font-reading text-2xl leading-10 text-text">
      {before}
      {gap !== null && (
        <RNText style={{ color, fontWeight: '700' }}>{fill ? fill : '______'}</RNText>
      )}
      {after}
    </RNText>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' }) {
  return (
    <View
      className={`self-start rounded-full px-2.5 py-0.5 ${tone === 'accent' ? 'bg-accent-soft' : 'bg-surface-2'}`}
    >
      <RNText
        className={`font-ui-medium text-xs ${tone === 'accent' ? 'text-accent' : 'text-text-muted'}`}
      >
        {label}
      </RNText>
    </View>
  );
}
