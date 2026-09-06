import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStudyAmbience } from '@/features/ambient-audio/activity';
import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

interface SessionShellProps {
  current: number;
  total: number;
  onQuit: () => void;
  children: React.ReactNode;
  /**
   * T31: the unit quiz hosts an ambient room scene BEHIND the shell — the
   * host owns the bg then. Every other caller keeps the opaque default.
   */
  transparentBg?: boolean;
}

/**
 * The shared session chrome (UI_DESIGN §7 `SessionShell`): progress bar,
 * item counter, quit — so every game mode feels like a variation of one
 * flow, not a different app. T13/T14 games render inside this too.
 */
export function SessionShell({
  current,
  total,
  onQuit,
  children,
  transparentBg = false,
}: SessionShellProps) {
  useStudyAmbience();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const progress = total > 0 ? Math.min(1, current / total) : 0;

  return (
    <View
      className={`flex-1 ${transparentBg ? '' : 'bg-bg'}`}
      style={{ paddingTop: insets.top + 8 }}
    >
      <View className="flex-row items-center gap-3 px-4">
        <Pressable
          onPress={onQuit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="End session"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-2"
        >
          <Ionicons name="close" size={22} color={tokens.textMuted} />
        </Pressable>
        <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <View className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </View>
        <Text variant="caption" className="min-w-12 text-right">
          {Math.min(current + 1, total)} / {total}
        </Text>
      </View>
      <View className="flex-1" style={{ paddingBottom: insets.bottom + 12 }}>
        {children}
      </View>
    </View>
  );
}
