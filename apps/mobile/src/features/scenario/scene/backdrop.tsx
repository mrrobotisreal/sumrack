import { Image } from 'expo-image';
import * as React from 'react';
import { StyleSheet } from 'react-native';

import { SceneWash, shadowWash } from '@/features/path/scenes/layers';
import { withAlpha, type ScenePalette } from '@/features/path/scenes/scene-palette';

/**
 * Layer 1 (§8.1): the staged `scene/backdrop.png` through expo-image
 * (cover, disk cache) over the gradient wash — the wash is what shows while
 * the PNG loads, and what stays when there is no PNG or it fails to decode
 * (§12: never an error). Colours: the accent glow bleeds into the shadow
 * tokens top and bottom.
 */
export function Backdrop({
  uri,
  palette,
  onFailed,
}: {
  uri: string | null | undefined;
  palette: ScenePalette;
  /** Fired once when the image cannot load (the dev gallery counts these). */
  onFailed?: () => void;
}) {
  const [failed, setFailed] = React.useState<string | null>(null);
  const showImage = uri != null && failed !== uri;
  return (
    <>
      <SceneWash
        colors={[
          withAlpha(palette.glow, 0.22),
          withAlpha(palette.shadow, 0.35),
          ...shadowWash(palette.shadow, 0.55, 0.9),
        ]}
      />
      {showImage && (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="disk"
          transition={240}
          onError={() => {
            setFailed(uri);
            onFailed?.();
          }}
          accessibilityIgnoresInvertColors
        />
      )}
    </>
  );
}
