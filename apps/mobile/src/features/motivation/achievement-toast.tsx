import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Animated, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { useAchievementToasts } from './toast-store';

const SHOW_MS = 3600;

/**
 * Achievement unlock toast (T19) — the UI_DESIGN §5 "reserved bigger
 * moment", kept restrained: an ember-tinted card slides down from the top,
 * holds, and fades. One at a time; the queue drains itself. Mounted once in
 * the root layout so unlocks toast on whatever screen triggered them.
 */
export function AchievementToastHost() {
  const queue = useAchievementToasts((s) => s.queue);
  const pop = useAchievementToasts((s) => s.pop);
  const current = queue[0] ?? null;
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();

  // useState initializer, not useRef — render-time ref reads trip the strict
  // react-hooks lint (T15 note); same pattern as checkpoint-screen's pulse.
  const [anim] = React.useState(() => new Animated.Value(0));
  const [translateY] = React.useState(() =>
    anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }),
  );

  React.useEffect(() => {
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 200,
        easing: Easing.bezier(0.2, 0, 0, 1),
        useNativeDriver: true,
      }).start(() => pop());
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [current, anim, pop]);

  if (!current) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 16,
        right: 16,
        opacity: anim,
        transform: [{ translateY }],
      }}
    >
      <View
        className="flex-row items-center gap-3 rounded-xl border bg-surface p-3.5"
        style={{ borderColor: tokens.accent }}
      >
        <View className="h-11 w-11 items-center justify-center rounded-full bg-accent-soft">
          <Ionicons name={current.icon} size={22} color={tokens.accent} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="caption" className="uppercase tracking-wider text-accent">
            Achievement unlocked
          </Text>
          <Text className="font-ui-medium">{current.title}</Text>
          <Text variant="caption">{current.description}</Text>
        </View>
      </View>
    </Animated.View>
  );
}
