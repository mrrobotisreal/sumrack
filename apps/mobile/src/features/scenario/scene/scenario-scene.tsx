import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect as SvgRect, Stop } from 'react-native-svg';

import { RadialGlow, Vignette } from '@/features/path/scenes/layers';
import { scenePalette, withAlpha } from '@/features/path/scenes/scene-palette';
import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { Backdrop } from './backdrop';
import { PngCharacter } from './character';
import { Mouth, mouthColors } from './mouth';
import { bustPalette, BUST_CANVAS } from './placeholder-busts';
import { PlaceholderCharacter } from './placeholder-character';
import type { ScenePose } from './poses';
import { SceneBox } from './scene-box';
import {
  characterRect,
  containRect,
  deskRect,
  mouthRect,
  PLACEHOLDER_MOUTH_ANCHOR,
  type Size,
} from './scene-geometry';
import { placeholderOf, type SceneSpec } from './scene-spec';
import { useBlink, usePoseMotion } from './use-poses';

/**
 * `ScenarioScene` (T61, §8.1): the layered talking-cast scene inside a
 * measured `SceneBox`. Bottom → top: backdrop (PNG or wash) · vignette +
 * host glow · character (PNG body + lids, or the placeholder bust) · mouth.
 * The mouth's shape comes from `shape` (the `useMouthTrack` shared value);
 * every other motion is a pose recipe on shared values. Reduce-motion
 * freezes all of it except the mouth. A PNG that fails to decode swaps to
 * the placeholder (§12) — never an error.
 *
 * Renders once per (spec, pose, box) — the dev render probe warns when it
 * re-renders with playback (the T31 method).
 */

export interface ScenarioSceneProps {
  spec: SceneSpec;
  pose: ScenePose;
  /** The mouth shape shared value (0–5) from `useMouthTrack`. */
  shape: SharedValue<number>;
  /** Focused + foregrounded; false parks every loop on its poster. */
  active?: boolean;
  /** Hub thumbnail: no lids/mouth motion, no vignette. */
  thumbnail?: boolean;
  /** Dev: force the placeholder even when PNGs exist (simulate missing art). */
  forcePlaceholder?: boolean;
  style?: object;
}

/**
 * The T31 render probe, keyed on the props: commits are counted only while
 * the props stay identical (a line playing changes nothing but the shared
 * value), so a prop change resets the count and a warning means the scene
 * re-rendered with playback — which must never happen.
 */
function useRenderProbe(enabled: boolean, signature: string) {
  const count = React.useRef({ signature: '', renders: 0 });
  React.useEffect(() => {
    if (count.current.signature !== signature) count.current = { signature, renders: 0 };
    count.current.renders += 1;
    if (__DEV__ && enabled && count.current.renders > 8) {
      console.warn(
        `[T61] ScenarioScene rendered ${count.current.renders}× with unchanged props — the scene must not re-render with playback`,
      );
    }
  });
}

export const ScenarioScene = React.memo(function ScenarioScene({
  spec,
  pose,
  shape,
  active = true,
  thumbnail = false,
  forcePlaceholder = false,
  style,
}: ScenarioSceneProps) {
  useRenderProbe(
    !thumbnail,
    `${pose}|${active}|${forcePlaceholder}|${spec.bodyUri ?? ''}|${spec.layout}|${spec.placeholder?.kind ?? ''}|${spec.placeholder?.hue ?? ''}|${spec.mouthStyle}|${JSON.stringify(spec.mouthAnchor)}`,
  );
  return (
    <SceneBox style={[styles.box, style]} accessibilityLabel={spec.hostName ?? undefined}>
      {(box) => (
        <SceneLayers
          box={box}
          spec={spec}
          pose={pose}
          shape={shape}
          active={active}
          thumbnail={thumbnail}
          forcePlaceholder={forcePlaceholder}
        />
      )}
    </SceneBox>
  );
});

function SceneLayers({
  box,
  spec,
  pose,
  shape,
  active,
  thumbnail,
  forcePlaceholder,
}: Required<Omit<ScenarioSceneProps, 'style'>> & { box: Size }) {
  const { tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const palette = scenePalette(tokens, spec.accent);

  // PNG mode needs the decoded body size for the contain-fit rect; until
  // then (and forever for the placeholder) the canvas aspect applies.
  const [bodySize, setBodySize] = React.useState<Size | null>(null);
  const [bodyFailed, setBodyFailed] = React.useState<string | null>(null);
  const png = !forcePlaceholder && spec.bodyUri != null && bodyFailed !== spec.bodyUri;
  const run = active && !reduceMotion;

  const layoutRect = characterRect(spec.layout, box);
  const aspect = png && bodySize ? bodySize.w / bodySize.h : BUST_CANVAS.w / BUST_CANVAS.h;
  const bodyRect = containRect(layoutRect, aspect);
  const anchor = png ? (spec.mouthAnchor ?? PLACEHOLDER_MOUTH_ANCHOR) : PLACEHOLDER_MOUTH_ANCHOR;
  const mouth = mouthRect(anchor, bodyRect);
  const placeholder = placeholderOf(spec);
  const bust = React.useMemo(
    () => bustPalette(placeholder.hue, tokens, palette.glow),
    [placeholder.hue, tokens, palette.glow],
  );
  const mouthPalette = React.useMemo(
    () => mouthColors(palette.glow, tokens.scrim, tokens.text, bust.hair),
    [palette.glow, tokens.scrim, tokens.text, bust.hair],
  );

  const motion = usePoseMotion(pose, { active: run, reduceMotion, png });
  const blink = useBlink(run && !thumbnail);
  const glowStyle = useAnimatedStyle(() => ({ opacity: motion.glow.value }));

  return (
    <>
      <Backdrop uri={spec.backdropUri} palette={palette} />
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} pointerEvents="none">
        <RadialGlow
          id="scenario-host-glow"
          color={palette.glow}
          alpha={0.34}
          cx={(bodyRect.x + bodyRect.w / 2) / box.w}
          cy={(bodyRect.y + bodyRect.h * 0.38) / box.h}
          rx={0.42}
          ry={0.36}
        />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, motion.bodyStyle]} pointerEvents="none">
        <Animated.View style={[StyleSheet.absoluteFill, motion.headStyle]}>
          {png ? (
            <PngCharacter
              bodyUri={spec.bodyUri!}
              eyelidsUri={spec.eyelidsUri}
              rect={layoutRect}
              blink={blink}
              thumbnail={thumbnail}
              onLoaded={(size) =>
                setBodySize((prev) =>
                  prev && prev.w === size.w && prev.h === size.h ? prev : size,
                )
              }
              onFailed={() => setBodyFailed(spec.bodyUri!)}
            />
          ) : (
            <PlaceholderCharacter
              kind={placeholder.kind}
              palette={bust}
              rect={bodyRect}
              blink={blink}
              browStyle={motion.browStyle}
              gazeStyle={motion.gazeStyle}
            />
          )}
          {!thumbnail && (
            <Mouth
              rect={mouth}
              rotate={anchor.rotate ?? 0}
              style={png ? spec.mouthStyle : 'default'}
              shape={shape}
              colors={mouthPalette}
            />
          )}
        </Animated.View>
      </Animated.View>
      {spec.layout === 'desk' && (
        <DeskStrip box={box} shadow={palette.shadow} glow={palette.glow} />
      )}
      {!thumbnail && <Vignette id="scenario-vignette" shadow={palette.shadow} strength={0.5} />}
    </>
  );
}

/** The `desk` preset's foreground strip: a dark surface with a glow-tinted edge. */
function DeskStrip({ box, shadow, glow }: { box: Size; shadow: string; glow: string }) {
  const r = deskRect(box);
  return (
    <View style={[styles.desk, { top: r.y, height: r.h }]} pointerEvents="none">
      <Svg width={r.w} height={r.h}>
        <Defs>
          <LinearGradient id="scenario-desk" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={glow} stopOpacity={0.35} />
            <Stop offset="0.08" stopColor={shadow} stopOpacity={0.9} />
            <Stop offset="1" stopColor={shadow} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <SvgRect x="0" y="0" width={r.w} height={r.h} fill="url(#scenario-desk)" />
        <SvgRect x="0" y="0" width={r.w} height={2} fill={withAlpha(glow, 0.5)} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1 },
  desk: { position: 'absolute', left: 0, right: 0 },
});
