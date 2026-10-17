import { Image } from 'expo-image';
import * as React from 'react';
import { View } from 'react-native';

import { coverChoice } from './cover-source';

const APP_ICON = require('../../../assets/images/icon.png');

interface CoverArtProps {
  coverUri: string | null;
  /** Edge length in px. */
  size: number;
  rounded?: number;
}

/** Pack cover, or the bundled app icon when the pack has none. */
export function CoverArt({ coverUri, size, rounded = 16 }: CoverArtProps) {
  const choice = coverChoice(coverUri);
  return (
    <View
      className="overflow-hidden border border-border bg-surface"
      style={{ width: size, height: size, borderRadius: rounded }}
    >
      <Image
        source={choice.kind === 'file' ? { uri: choice.uri } : APP_ICON}
        style={{ width: size, height: size }}
        contentFit="cover"
        accessibilityIgnoresInvertColors
        accessibilityLabel="Обложка"
      />
    </View>
  );
}
