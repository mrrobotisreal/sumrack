import { Image } from 'expo-image';
import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/**
 * Layer 4 (§8.1): the PNG eyelids overlay — the same canvas as the body,
 * shown by the blink shared value. The placeholder's lids are SVG nodes in
 * `placeholder-character.tsx` driven by the same value.
 */
export function PngEyelids({ uri, blink }: { uri: string; blink: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: blink.value }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        contentPosition="bottom center"
        cachePolicy="disk"
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
}
