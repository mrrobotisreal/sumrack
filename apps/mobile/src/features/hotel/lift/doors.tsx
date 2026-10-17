import { Image } from 'expo-image';
import * as React from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

/**
 * T91 doors: Mitch's Art Deco brass doors, cut from elevator_doors.png by
 * scripts/hotel-cut-doors.sh. Layers, back to front: the dark car interior,
 * the two door leaves (split at the centre seam), and the marble frame on top.
 *
 * `open` is a shared value in [0, 1] (0 = shut, 1 = open). Each leaf slides
 * outward by its own width. The motion runs on the UI thread, so the JS
 * thread can drive `open` with withTiming without it stuttering.
 *
 * The opening is 600 × 1180 in source pixels (aspect 0.508). Doors use the
 * 390 dp frame, so the opening is 198 dp wide and 600 dp tall.
 */

export const OPENING_ASPECT = 600 / 1180;
/** The leaf art is 142 px wide per half at 1x; each leaf slides out by its full width. */
const LEAF_FRACTION = 0.5;

const CAR = require('../../../../assets/images/hotel/car.webp') as number;
const LEFT = require('../../../../assets/images/hotel/door-left.webp') as number;
const RIGHT = require('../../../../assets/images/hotel/door-right.webp') as number;
const FRAME = require('../../../../assets/images/hotel/frame.webp') as number;

export interface DoorsProps {
  /** 0 = shut, 1 = open. Driven by the Lift on the UI thread. */
  open: SharedValue<number>;
  /** Width of the whole component in dp. The height follows the frame aspect. */
  width: number;
  children?: React.ReactNode;
}

export function Doors({ open, width, children }: DoorsProps) {
  const height = width * (1342 / 824);
  const openingW = width * (600 / 824);
  const openingH = height * (1180 / 1342);
  const openingX = width * (112 / 824);
  const openingY = height * (120 / 1342);
  const halfW = openingW * LEAF_FRACTION;

  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -halfW * open.value }],
  }));
  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: halfW * open.value }],
  }));
  const interiorStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + 0.65 * open.value,
  }));

  return (
    <View style={{ width, height }}>
      {/* Car interior: shown behind the content when the doors are open. */}
      <View
        style={{
          position: 'absolute',
          left: openingX,
          top: openingY,
          width: openingW,
          height: openingH,
          overflow: 'hidden',
        }}
      >
        <Image source={CAR} style={{ width: openingW, height: openingH }} contentFit="fill" />
        <Animated.View style={[interiorStyle, { position: 'absolute', inset: 0 }]}>
          {children}
        </Animated.View>
      </View>

      {/* Door leaves, each clipped to its own half of the opening. */}
      <View
        style={{
          position: 'absolute',
          left: openingX,
          top: openingY,
          width: openingW,
          height: openingH,
          overflow: 'hidden',
        }}
        pointerEvents="none"
      >
        <Animated.View style={[leftStyle, { position: 'absolute', left: 0, top: 0 }]}>
          <Image
            source={LEFT}
            style={{ width: halfW, height: openingH }}
            contentFit="fill"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
        <Animated.View style={[rightStyle, { position: 'absolute', left: halfW, top: 0 }]}>
          <Image
            source={RIGHT}
            style={{ width: halfW, height: openingH }}
            contentFit="fill"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
      </View>

      {/* Marble frame and triangle, on top, with the opening transparent. */}
      <Image
        source={FRAME}
        style={{ position: 'absolute', left: 0, top: 0, width, height }}
        contentFit="fill"
        pointerEvents="none"
      />
    </View>
  );
}
