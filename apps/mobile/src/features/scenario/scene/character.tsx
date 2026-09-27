import { Image } from 'expo-image';
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { PngEyelids } from './eyelids';
import type { Rect } from './scene-geometry';

/**
 * Layer 3, PNG variant (§8.1): `body.png` contain-fit into the character
 * rect (bottom-centre — the host stands on the floor), the eyelids overlay
 * on the same canvas above it. `onFailed` fires when the body cannot be
 * decoded so the scene swaps to the placeholder (§12) — never an error.
 * `thumbnail` skips the lids (T62's hub cards).
 */
export const PngCharacter = React.memo(function PngCharacter({
  bodyUri,
  eyelidsUri,
  rect,
  blink,
  thumbnail = false,
  onLoaded,
  onFailed,
}: {
  bodyUri: string;
  eyelidsUri: string | null | undefined;
  rect: Rect;
  blink: SharedValue<number>;
  thumbnail?: boolean;
  /** The decoded image size — the scene needs it for the contain-fit body rect. */
  onLoaded?: (size: { w: number; h: number }) => void;
  onFailed?: () => void;
}) {
  return (
    <View
      style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      pointerEvents="none"
    >
      <Image
        source={{ uri: bodyUri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        contentPosition="bottom center"
        cachePolicy="disk"
        transition={160}
        onLoad={(e) => onLoaded?.({ w: e.source.width, h: e.source.height })}
        onError={() => onFailed?.()}
        accessibilityIgnoresInvertColors
      />
      {!thumbnail && eyelidsUri ? <PngEyelids uri={eyelidsUri} blink={blink} /> : null}
    </View>
  );
});
