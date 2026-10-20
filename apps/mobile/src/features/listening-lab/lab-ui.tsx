import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

import { Text } from '@/components/ui/text';
import { safeBack } from '@/lib/safe-back';

export function LabButton({
  children,
  onPress,
  disabled = false,
  primary = false,
  selected = false,
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      className={`min-h-12 justify-center rounded-xl border px-4 py-3 ${primary || selected ? 'border-accent bg-surface-2' : 'border-border bg-surface'} ${disabled ? 'opacity-50' : 'active:bg-surface-2'}`}
    >
      <Text className={primary || selected ? 'font-ui-bold text-accent' : 'text-text'}>
        {children}
      </Text>
    </Pressable>
  );
}
export function LabHeader({ title }: { title: string }) {
  const router = useRouter(),
    insets = useSafeAreaInsets();
  return (
    <View className="border-b border-border px-5 pb-4" style={{ paddingTop: insets.top + 8 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Pressable
        onPress={() => safeBack(router)}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="min-h-12 justify-center self-start px-2"
      >
        <Text className="text-accent">‹ Back</Text>
      </Pressable>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}
