import * as React from 'react';
import { StyleSheet, View } from 'react-native';

import { track } from '@/services/analytics';
import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import type { SceneLayerProps } from './layers';
import { scenePalette, type SceneId } from './scene-palette';
import { CellarScene } from './scene-cellar';
import { HallwayScene } from './scene-hallway';
import { KitchenScene } from './scene-kitchen';
import { LivingRoomScene } from './scene-living-room';
import { NurseryScene } from './scene-nursery';
import { PantryScene } from './scene-pantry';
import { useAppStateActive, useScreenFocused } from './use-scene-active';

/**
 * The ambient room scene engine (T31, V2 §5.3): an absolute-fill,
 * non-interactive background layer keyed by the pack's `theme.scene`.
 * Unknown/absent scenes render NOTHING — the screen's normal bg token is
 * the default backdrop (T30's forward-compat contract). All motion lives on
 * the UI thread in the scene modules; this component renders once and must
 * not re-render with content (dev probe below asserts it).
 */

const SCENE_COMPONENTS: Record<SceneId, React.ComponentType<SceneLayerProps>> = {
  hallway: HallwayScene,
  'living-room': LivingRoomScene,
  kitchen: KitchenScene,
  pantry: PantryScene,
  nursery: NurseryScene,
  cellar: CellarScene,
};

export interface RoomSceneProps {
  scene: string | null | undefined;
  /** Pack `theme.accent` override (validated in scenePalette). */
  accent?: string | null;
  /**
   * 'screen' (default): full backdrop behind veil-carded content.
   * 'card': inside an expanded unit card, directly under its text — runs
   * dimmer so captions keep their contrast (recorded T31 decision).
   */
  variant?: 'screen' | 'card';
}

function useRenderProbe(label: string, enabled: boolean) {
  const count = React.useRef(0);
  // Counts committed renders (effects run once per commit) — enough to catch
  // a scene re-rendering with content, which must never happen.
  React.useEffect(() => {
    count.current += 1;
    if (__DEV__ && enabled && count.current > 12) {
      console.warn(
        `[T31] ${label} rendered ${count.current}× — ambient scenes must not re-render with content`,
      );
    }
  });
}

export const RoomScene = React.memo(function RoomScene({
  scene,
  accent,
  variant = 'screen',
}: RoomSceneProps) {
  const { scheme, tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const appActive = useAppStateActive();
  const focused = useScreenFocused();
  // Scenes size to THEIR box (full screen or an expanded unit card) — one
  // measured layout pass, then the size is stable.
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);

  const Scene = scene != null ? SCENE_COMPONENTS[scene as SceneId] : undefined;
  const known = Scene != null;

  React.useEffect(() => {
    if (known && scene != null) track('room_scene_shown', { scene });
  }, [known, scene]);

  useRenderProbe(`RoomScene(${scene ?? 'none'})`, known);

  if (!Scene) return null;

  const palette = scenePalette(tokens, accent);
  const active = focused && appActive && !reduceMotion;

  // Daylight is deliberate, not inverted (UI_DESIGN §1) — shadow washes that
  // whisper on near-black shout on warm paper, so light theme runs every
  // scene at half strength; in-card scenes sit directly under card text and
  // run dimmer still (recorded T31 decisions).
  const strength = (scheme === 'light' ? 0.5 : 1) * (variant === 'card' ? 0.55 : 1);

  return (
    <View
      style={[StyleSheet.absoluteFill, strength < 1 && { opacity: strength }]}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox((prev) =>
          prev && prev.w === Math.round(width) && prev.h === Math.round(height)
            ? prev
            : { w: Math.round(width), h: Math.round(height) },
        );
      }}
    >
      {box && box.w > 0 && box.h > 0 && (
        <Scene active={active} palette={palette} width={box.w} height={box.h} />
      )}
    </View>
  );
});
