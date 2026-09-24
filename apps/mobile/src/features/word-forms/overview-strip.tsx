import * as React from 'react';
import { Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';

import type { WordProfile } from './profile-schema';

/**
 * The strip above the section cards (WORD_FORMS §7.2): the stressed
 * headword in Literata (the combining acute renders natively), the gloss,
 * `facts` as two-column `label: value` captions, `notes` as muted lines.
 */
export function OverviewStrip({ profile }: { profile: WordProfile }) {
  const { headword, overview } = profile;
  return (
    <View className="rounded-xl border border-border bg-surface px-4 py-3">
      <RNText className="font-reading text-2xl text-text" accessibilityLabel={headword.plain}>
        {headword.ru}
      </RNText>
      <Text className="mt-1 text-base">{overview.gloss}</Text>

      {overview.facts.length > 0 && (
        <View className="mt-3 flex-row flex-wrap">
          {overview.facts.map((fact, i) => (
            <View key={`${fact.label}-${i}`} className="w-1/2 pb-1.5 pr-3">
              <Text variant="caption" className="text-xs">
                <Text variant="caption" className="font-ui-medium text-xs text-text">
                  {fact.label}:
                </Text>{' '}
                {fact.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      {overview.notes.length > 0 && (
        <View className="mt-2 gap-1">
          {overview.notes.map((note, i) => (
            <Text key={i} variant="caption" className="text-xs">
              {note}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
