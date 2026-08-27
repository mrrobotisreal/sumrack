import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import type { UnitState } from '../path-model';
import { roomForScene } from './rooms';

/**
 * «Дом с шестью комнатами» — the vertical house cross-section (T30, V2
 * §5.3). Pure props-in presentation: the caller passes the house-themed
 * units already ordered (orderHouseUnits) and says which node is current.
 *
 * Room states: completed = lit warm window glow · current = subtle flicker
 * (stilled to a steady glow under reduce-motion) · future = dark but visible
 * and TAPPABLE — nothing in the path is ever locked (hard product rule).
 * The real ambient scene engine is T31; the flicker here is a minimal
 * token-colored affect.
 */
export interface HouseMapProps {
  units: UnitState[];
  /** Pack id of the path's current node (may be none of these units). */
  currentId: string | null;
  onPressRoom: (unit: UnitState) => void;
}

const ROOF_H = 44;
const FLOOR_H = 72;
const INSET = 6; // house wall inset from the container edge
const GROUND_OVERHANG = 6; // ground line pokes past the walls

export function HouseMap({ units, currentId, onPressRoom }: HouseMapProps) {
  const { tokens } = useAppTheme();
  const [width, setWidth] = React.useState(0);

  const floors = units.map((unit) => ({
    unit,
    room: roomForScene(unit.pack.themeScene ?? ''),
  }));
  const groundIdx = floors.findIndex((f) => f.room?.belowGround);
  const height = ROOF_H + floors.length * FLOOR_H + 2;
  const yTop = (i: number) => ROOF_H + i * FLOOR_H;

  return (
    <View
      className="mb-3"
      style={{ height }}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {width > 0 && (
        <Svg
          width={width}
          height={height}
          style={{ position: 'absolute', top: 0, left: 0 }}
          pointerEvents="none"
        >
          {/* roof */}
          <Path
            d={`M ${INSET - 2} ${ROOF_H} L ${width / 2} 4 L ${width - INSET + 2} ${ROOF_H} Z`}
            fill={tokens.surface2}
            stroke={tokens.border}
            strokeWidth={1.5}
          />
          {/* floors */}
          {floors.map((floor, i) => (
            <Rect
              key={floor.unit.pack.id}
              x={INSET}
              y={yTop(i)}
              width={width - INSET * 2}
              height={FLOOR_H}
              fill={floor.room?.belowGround ? tokens.bg : tokens.surface}
              stroke={tokens.border}
              strokeWidth={1}
              strokeDasharray={floor.room?.belowGround ? '4 3' : undefined}
            />
          ))}
          {/* ground line — the world above vs. the cellar below */}
          {groundIdx >= 0 && (
            <Line
              x1={INSET - GROUND_OVERHANG}
              y1={yTop(groundIdx)}
              x2={width - INSET + GROUND_OVERHANG}
              y2={yTop(groundIdx)}
              stroke={tokens.textMuted}
              strokeWidth={2}
            />
          )}
        </Svg>
      )}

      {/* one tappable row per floor, laid over the SVG floors exactly */}
      <View style={{ position: 'absolute', top: ROOF_H, left: INSET, right: INSET }}>
        {floors.map(({ unit, room }) => {
          const state = unit.complete
            ? 'completed'
            : unit.pack.id === currentId
              ? 'current'
              : 'future';
          return (
            <Pressable
              key={unit.pack.id}
              onPress={() => onPressRoom(unit)}
              accessibilityRole="button"
              accessibilityLabel={`Room ${unit.pack.titleRu}, ${
                state === 'completed'
                  ? 'completed'
                  : state === 'current'
                    ? 'current'
                    : 'not started'
              }`}
              className="flex-row items-center gap-3 px-3 active:opacity-70"
              style={{ height: FLOOR_H }}
            >
              <RoomWindow state={state} />
              <View className="flex-1 gap-0.5">
                <RNText
                  className={`font-reading text-lg ${state === 'future' ? 'text-text-muted' : 'text-text'}`}
                  numberOfLines={1}
                >
                  {unit.pack.titleRu}
                </RNText>
                <Text variant="caption" numberOfLines={1}>
                  {room?.titleEn ?? unit.pack.titleEn} · {unit.stepsDone}/{unit.stepsTotal}
                </Text>
              </View>
              {unit.complete && (
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: tokens.accent }} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A four-pane window: lit (completed), flickering (current — irregular
 * lamp-like loop, stilled by reduce-motion), or dark (future).
 */
function RoomWindow({ state }: { state: 'completed' | 'current' | 'future' }) {
  const { tokens } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const glow = useSharedValue(1);

  React.useEffect(() => {
    if (state === 'current' && !reduceMotion) {
      // Irregular candle flicker — dips and recoveries of uneven length, a
      // long steady hold between (small + moody, no strobing).
      glow.value = withRepeat(
        withSequence(
          withTiming(0.45, { duration: 140, easing: Easing.linear }),
          withTiming(0.95, { duration: 90, easing: Easing.linear }),
          withTiming(0.6, { duration: 220, easing: Easing.linear }),
          withTiming(1, { duration: 120, easing: Easing.linear }),
          withTiming(1, { duration: 2600, easing: Easing.linear }),
          withTiming(0.7, { duration: 100, easing: Easing.linear }),
          withTiming(1, { duration: 1800, easing: Easing.linear }),
        ),
        -1,
      );
    } else {
      cancelAnimation(glow);
      glow.value = 1;
    }
    return () => cancelAnimation(glow);
  }, [state, reduceMotion, glow]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const lit = state !== 'future';
  return (
    <View className="h-11 w-11 items-center justify-center">
      {/* soft halo behind lit windows */}
      {lit && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 42,
              height: 42,
              borderRadius: 12,
              backgroundColor: tokens.accent,
              opacity: 0.22,
            },
            animatedStyle,
          ]}
        />
      )}
      <Animated.View
        style={[
          {
            width: 26,
            height: 26,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: lit ? tokens.accent : tokens.border,
            backgroundColor: lit ? tokens.accent : tokens.bg,
            overflow: 'hidden',
          },
          lit ? animatedStyle : null,
        ]}
      >
        {/* window panes (cross mullion) */}
        <View
          style={{
            position: 'absolute',
            left: 11.5,
            top: 0,
            bottom: 0,
            width: 1.5,
            backgroundColor: lit ? tokens.surface : tokens.border,
            opacity: lit ? 0.55 : 1,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 11.5,
            left: 0,
            right: 0,
            height: 1.5,
            backgroundColor: lit ? tokens.surface : tokens.border,
            opacity: lit ? 0.55 : 1,
          }}
        />
      </Animated.View>
    </View>
  );
}
