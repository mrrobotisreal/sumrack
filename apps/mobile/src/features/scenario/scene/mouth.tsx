import * as React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { mixHex } from './placeholder-busts';
import type { Rect } from './scene-geometry';
import { MOUTH_SHAPES, type MouthShape } from './visemes';

/**
 * Layer 5 (§8.1): the five-viseme SVG mouth. Six pre-mounted paths (0–4 +
 * the round 4) inside one `Svg` sized to the anchor rect; the shared value
 * `shape` selects which is visible through `useAnimatedProps` on each
 * path's opacity — so the 25 Hz tick never touches React (recorded T61
 * measurement: opacity toggling beat animated `d` strings, which
 * re-parse the path on the UI thread every frame). Colours: lip line from
 * the accent darkened toward the scrim, interior near-black, a tooth/tongue
 * highlight only at 3/4/round.
 */

export type MouthStyle = 'default' | 'wide' | 'small' | 'beard';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The mouth lives in a 100×60 unit box, centred at (50, 30). */
const VB_W = 100;
const VB_H = 60;

interface ShapeGeometry {
  outer: string;
  inner?: string;
  teeth?: string;
  tongue?: string;
}

/** Shapes drawn in the unit box. */
const SHAPES: Record<MouthShape, ShapeGeometry> = {
  // 0 closed: a soft lip line with a hint of the lower lip.
  0: { outer: 'M14 30 Q50 40 86 30 Q50 34 14 30 Z' },
  // 1 narrow: a thin slit.
  1: { outer: 'M18 29 Q50 22 82 29 Q50 40 18 29 Z', inner: 'M24 30 Q50 26 76 30 Q50 35 24 30 Z' },
  // 2 mid oval.
  2: {
    outer: 'M20 28 Q50 12 80 28 Q50 50 20 28 Z',
    inner: 'M26 29 Q50 18 74 29 Q50 44 26 29 Z',
    teeth: 'M30 26 Q50 22 70 26 L70 30 Q50 33 30 30 Z',
  },
  // 3 open oval.
  3: {
    outer: 'M24 24 Q50 4 76 24 Q50 58 24 24 Z',
    inner: 'M30 25 Q50 12 70 25 Q50 50 30 25 Z',
    teeth: 'M33 22 Q50 18 67 22 L67 27 Q50 30 33 27 Z',
    tongue: 'M36 40 Q50 32 64 40 Q50 50 36 40 Z',
  },
  // 4 wide: a broad grin-shaped opening.
  4: {
    outer: 'M8 26 Q50 6 92 26 Q50 52 8 26 Z',
    inner: 'M16 27 Q50 14 84 27 Q50 44 16 27 Z',
    teeth: 'M20 24 Q50 19 80 24 L80 29 Q50 32 20 29 Z',
    tongue: 'M34 38 Q50 32 66 38 Q50 44 34 38 Z',
  },
  // 5 round: the о/у/ю/ё shape — a tall rounded O.
  5: {
    outer: 'M30 30 Q30 6 50 6 Q70 6 70 30 Q70 56 50 56 Q30 56 30 30 Z',
    inner: 'M36 30 Q36 14 50 14 Q64 14 64 30 Q64 48 50 48 Q36 48 36 30 Z',
    teeth: 'M40 20 Q50 17 60 20 L60 25 Q50 27 40 25 Z',
    tongue: 'M40 40 Q50 34 60 40 Q50 46 40 46 Z',
  },
};

/** Per-style scale of the drawn mouth inside its anchor (a beard adds a mask around it). */
const STYLE_SCALE: Record<MouthStyle, { x: number; y: number }> = {
  default: { x: 1, y: 1 },
  wide: { x: 1.18, y: 0.95 },
  small: { x: 0.8, y: 0.85 },
  beard: { x: 0.94, y: 1 },
};

export interface MouthColors {
  lip: string;
  interior: string;
  teeth: string;
  tongue: string;
  beard: string;
}

export function mouthColors(
  accent: string,
  scrim: string,
  text: string,
  hair: string,
): MouthColors {
  return {
    lip: mixHex(accent, scrim, 0.45),
    interior: mixHex(scrim, accent, 0.08),
    teeth: mixHex(text, scrim, 0.18),
    tongue: mixHex(accent, scrim, 0.25),
    beard: hair,
  };
}

function ShapePaths({
  shape,
  current,
  colors,
}: {
  shape: MouthShape;
  current: SharedValue<number>;
  colors: MouthColors;
}) {
  const g = SHAPES[shape];
  const props = useAnimatedProps(() => ({ opacity: current.value === shape ? 1 : 0 }));
  return <AnimatedPath animatedProps={props} d={g.outer} fill={colors.lip} />;
}

/** Interior/teeth/tongue share one animated group per shape so opacity toggles together. */
function ShapeInner({
  shape,
  current,
  colors,
}: {
  shape: MouthShape;
  current: SharedValue<number>;
  colors: MouthColors;
}) {
  const g = SHAPES[shape];
  const props = useAnimatedProps(() => ({ opacity: current.value === shape ? 1 : 0 }));
  if (!g.inner) return null;
  return (
    <AnimatedG animatedProps={props}>
      <Path d={g.inner} fill={colors.interior} />
      {g.teeth && <Path d={g.teeth} fill={colors.teeth} opacity={0.92} />}
      {g.tongue && <Path d={g.tongue} fill={colors.tongue} opacity={0.85} />}
    </AnimatedG>
  );
}

const AnimatedG = Animated.createAnimatedComponent(G);

export const Mouth = React.memo(function Mouth({
  rect,
  rotate = 0,
  style = 'default',
  shape,
  colors,
}: {
  /** Pixel rect inside the scene box (the anchor × the painted body rect). */
  rect: Rect;
  rotate?: number;
  style?: MouthStyle;
  /** The shared shape index (0–5) written by the playback tick. */
  shape: SharedValue<number>;
  colors: MouthColors;
}) {
  const s = STYLE_SCALE[style];
  return (
    <Svg
      pointerEvents="none"
      style={[
        styles.svg,
        {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          transform: [{ rotate: `${rotate}deg` }],
        },
      ]}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
    >
      {style === 'beard' && (
        <Path d="M0 18 Q50 -6 100 18 L100 60 L0 60 Z" fill={colors.beard} opacity={0.55} />
      )}
      <G
        transform={`translate(${VB_W / 2} ${VB_H / 2}) scale(${s.x} ${s.y}) translate(${-VB_W / 2} ${-VB_H / 2})`}
      >
        {MOUTH_SHAPES.map((sh) => (
          <ShapePaths key={`o${sh}`} shape={sh} current={shape} colors={colors} />
        ))}
        {MOUTH_SHAPES.map((sh) => (
          <ShapeInner key={`i${sh}`} shape={sh} current={shape} colors={colors} />
        ))}
      </G>
    </Svg>
  );
});

const styles = StyleSheet.create({
  svg: { position: 'absolute' },
});
