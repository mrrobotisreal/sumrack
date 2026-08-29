import * as React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { scenePalette, THRESHOLD_ENTER_MS, THRESHOLD_EXIT_MS, withAlpha } from './scene-palette';

/**
 * «Crossing the threshold» (T31, V2 §5.3): entering a themed unit from the
 * path plays a ≤800 ms door-crack-of-light — two bg-colored panels part
 * from the center while a sliver of the room's glow widens and fades. The
 * reverse (room → path) is a brief door-swing shut behind you. Pure
 * opacity/scale, pointerEvents none (content below is interactive from
 * frame 0), skipped entirely under reduce-motion, self-removing. Never used
 * between inner screens.
 */

interface RoomExitSignal {
  scene: string;
  accent: string | null;
  at: number;
}

let lastRoomExit: RoomExitSignal | null = null;

/** Called by a themed room screen (lesson/quiz) as it unmounts back to the path. */
export function signalRoomExit(scene: string, accent: string | null) {
  lastRoomExit = { scene, accent, at: Date.now() };
}

/** Path screen consumes the signal on refocus; stale signals expire. */
export function consumeRoomExit(maxAgeMs = 1000): Omit<RoomExitSignal, 'at'> | null {
  const signal = lastRoomExit;
  lastRoomExit = null;
  if (!signal || Date.now() - signal.at > maxAgeMs) return null;
  return { scene: signal.scene, accent: signal.accent };
}

export function ThresholdOverlay({
  direction,
  accent,
  onDone,
}: {
  direction: 'enter' | 'exit';
  accent?: string | null;
  onDone: () => void;
}) {
  const { tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  const duration = direction === 'enter' ? THRESHOLD_ENTER_MS : THRESHOLD_EXIT_MS;

  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const finish = React.useCallback(() => onDoneRef.current(), []);

  React.useEffect(() => {
    if (reduceMotion) {
      finish();
      return;
    }
    progress.value = withTiming(
      1,
      { duration, easing: Easing.bezier(0.2, 0, 0, 1) },
      (finished) => {
        if (finished) runOnJS(finish)();
      },
    );
    return () => cancelAnimation(progress);
  }, [duration, finish, progress, reduceMotion]);

  const leftPanel = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX:
          direction === 'enter'
            ? 1 - progress.value
            : interpolate(progress.value, [0, 0.45, 1], [0, 0.42, 0]),
      },
    ],
  }));
  const rightPanel = useAnimatedStyle(() => ({
    transform: [
      {
        scaleX:
          direction === 'enter'
            ? 1 - progress.value
            : interpolate(progress.value, [0, 0.45, 1], [0, 0.42, 0]),
      },
    ],
  }));
  const sliver = useAnimatedStyle(() => ({
    opacity:
      direction === 'enter'
        ? interpolate(progress.value, [0, 0.2, 0.75, 1], [0, 0.5, 0.2, 0])
        : interpolate(progress.value, [0, 0.45, 1], [0, 0.3, 0]),
    transform: [{ scaleX: direction === 'enter' ? 0.01 + progress.value * 1.2 : 0.4 }],
  }));

  if (reduceMotion) return null;

  const glow = scenePalette(tokens, accent).glow;

  return (
    <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: '50%',
            backgroundColor: tokens.bg,
            transformOrigin: 'left center',
          },
          leftPanel,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: '50%',
            backgroundColor: tokens.bg,
            transformOrigin: 'right center',
          },
          rightPanel,
        ]}
      />
      {/* the crack of light itself */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: width / 2 - 14,
            width: 28,
            backgroundColor: withAlpha(glow, 0.55),
          },
          sliver,
        ]}
      />
    </Animated.View>
  );
}
