import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable } from 'react-native';

import { useAppTheme } from '@/theme/use-app-theme';

import { useSyncStore } from './store';

/** Today-header cloud (T104): visible only while syncing or in error; tap → Settings. */
export function SyncCloud() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const status = useSyncStore((s) => s.status);
  if (status !== 'syncing' && status !== 'error') return null;
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      hitSlop={8}
      accessibilityLabel={status === 'error' ? 'Sync problem' : 'Syncing'}
      className="mr-4"
    >
      <Ionicons
        name={status === 'error' ? 'cloud-offline-outline' : 'cloud-upload-outline'}
        size={24}
        color={status === 'error' ? tokens.danger : tokens.textMuted}
      />
    </Pressable>
  );
}
