import { LinearGradient } from 'expo-linear-gradient';
import * as React from 'react';
import { Image, View } from 'react-native';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

const grainTexture = require('../../../assets/textures/grain.png');

interface StoryHeaderProps {
  titleRu: string;
  titleEn: string;
  level: CefrLevel;
  packTitleRu: string;
  sentenceCount: number;
  finished: boolean;
}

/**
 * Atmospheric story header (design §10 / UI_DESIGN §7 `StoryHeader`):
 * a surface-toned block with static grain tile + gradient vignette. All
 * layers are static images/gradients — nothing computed per frame, so
 * scroll cost is a one-time raster (T22 perf note in the ticket).
 */
export function StoryHeader({
  titleRu,
  titleEn,
  level,
  packTitleRu,
  sentenceCount,
  finished,
}: StoryHeaderProps) {
  const { tokens, scheme } = useAppTheme();
  return (
    <View className="mb-4 overflow-hidden bg-surface-2">
      {/* base wash: a barely-there ember glow rising from the bottom edge */}
      <LinearGradient
        colors={[`${tokens.bg}00`, `${tokens.accent}14`]}
        style={{ position: 'absolute', inset: 0 }}
      />
      {/* film grain — tiled static texture, dimmer on light paper */}
      <Image
        source={grainTexture}
        resizeMode="repeat"
        style={{ position: 'absolute', inset: 0, opacity: scheme === 'dark' ? 0.5 : 0.28 }}
        accessibilityElementsHidden
      />
      {/* vignette: dark falloff from the top, fade into the page below */}
      <LinearGradient
        colors={[`${tokens.bg}CC`, `${tokens.bg}00`, `${tokens.bg}00`, tokens.bg]}
        locations={[0, 0.35, 0.72, 1]}
        style={{ position: 'absolute', inset: 0 }}
      />

      <View className="px-5 pb-8 pt-20">
        <View className="mb-3 flex-row items-center gap-2">
          <LevelChip level={level} />
          <Text variant="caption">{packTitleRu}</Text>
        </View>
        <Text className="font-reading-bold text-2xl leading-10 text-text">{titleRu}</Text>
        <Text variant="muted" className="mt-1 font-reading-italic">
          {titleEn}
        </Text>
        <Text variant="caption" className="mt-4">
          {sentenceCount} {sentencesLabel(sentenceCount)}
          {finished ? ' · прочитано ✓' : ''}
        </Text>
      </View>
    </View>
  );
}

/** Russian plural agreement for «предложение» (nice touch on a study app). */
function sentencesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'предложение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'предложения';
  return 'предложений';
}
