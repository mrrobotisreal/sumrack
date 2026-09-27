import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Ellipse, G, Path } from 'react-native-svg';

import {
  BUST_CANVAS,
  bustNodes,
  layerNodes,
  type BustNode,
  type BustPalette,
  type PlaceholderKind,
} from './placeholder-busts';
import type { Rect } from './scene-geometry';
import type { AnimatedViewStyle } from './use-poses';

/**
 * Layer 3, placeholder variant (§8.3): one code-drawn bust in the 300×400
 * canvas, scaled into the character rect. Four Svgs — base, brows, irises,
 * lids — so the poses move the brows/irises and the blink fades the lids
 * from Animated wrappers without re-rasterising the base. All static; the
 * only per-frame work is the wrappers' transforms/opacity.
 */

function Nodes({ nodes }: { nodes: readonly BustNode[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.tag === 'path' ? (
          <Path
            key={i}
            d={n.d}
            fill={n.fill}
            stroke={n.stroke}
            strokeWidth={n.strokeWidth}
            strokeLinecap="round"
          />
        ) : (
          <Ellipse
            key={i}
            cx={n.cx}
            cy={n.cy}
            rx={n.rx}
            ry={n.ry}
            fill={n.fill}
            stroke={n.stroke}
            strokeWidth={n.strokeWidth}
          />
        ),
      )}
    </>
  );
}

function Layer({ nodes, style }: { nodes: readonly BustNode[]; style?: AnimatedViewStyle }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${BUST_CANVAS.w} ${BUST_CANVAS.h}`}
        preserveAspectRatio="xMidYMax meet"
      >
        <G>
          <Nodes nodes={nodes} />
        </G>
      </Svg>
    </Animated.View>
  );
}

export const PlaceholderCharacter = React.memo(function PlaceholderCharacter({
  kind,
  palette,
  rect,
  blink,
  browStyle,
  gazeStyle,
}: {
  kind: PlaceholderKind;
  palette: BustPalette;
  /** The painted body rect (canvas-aspect) inside the scene box. */
  rect: Rect;
  blink: SharedValue<number>;
  browStyle: AnimatedViewStyle;
  gazeStyle: AnimatedViewStyle;
}) {
  const nodes = React.useMemo(() => bustNodes(kind, palette), [kind, palette]);
  const lidStyle = useAnimatedStyle<ViewStyle>(() => ({ opacity: blink.value }));
  // The brow/gaze offsets are in scene px; the SVG scales the canvas, so a
  // px translate on the wrapper moves the layer by that many px on screen.
  return (
    <View
      style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      pointerEvents="none"
    >
      <Layer nodes={layerNodes(nodes, 'base')} />
      <Layer nodes={layerNodes(nodes, 'irises')} style={gazeStyle} />
      <Layer nodes={layerNodes(nodes, 'lids')} style={lidStyle} />
      <Layer nodes={layerNodes(nodes, 'brows')} style={browStyle} />
    </View>
  );
});
