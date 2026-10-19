import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { signOut } from './auth-service';
import { deviceName, useAccount } from './store';

/**
 * Settings → «Аккаунт» (T102). Signed out: a sign-in entry. Signed in:
 * email, provider, this phone's name, «Выйти» (local data always stays).
 * `children` is the sync status slot T104 fills.
 */
export function AccountSettingsSection({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const user = useAccount((s) => s.user);

  const confirmSignOut = () =>
    Alert.alert(
      'Выйти из аккаунта?',
      'Все данные останутся на этом телефоне; синхронизация остановится. · Your data stays on this phone; sync stops.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Выйти',
          style: 'destructive',
          onPress: () => {
            void signOut().then(() => track('auth_signed_out'));
          },
        },
      ],
    );

  return (
    <>
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Аккаунт · Account
      </Text>
      <View className="mb-6 overflow-hidden rounded-xl border border-border bg-surface">
        {user ? (
          <>
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              {user.provider === 'google' ? (
                <Image
                  source={require('../../../assets/images/auth/google-g.png')}
                  style={{ width: 20, height: 20 }}
                  contentFit="contain"
                />
              ) : (
                <Ionicons name="mail-outline" size={20} color={tokens.textMuted} />
              )}
              <View className="flex-1">
                <Text numberOfLines={1}>{user.email ?? 'Signed in'}</Text>
                <Text variant="caption">Этот телефон · {deviceName()}</Text>
              </View>
            </View>
            {children}
            <Pressable
              onPress={confirmSignOut}
              accessibilityRole="button"
              className="min-h-12 flex-row items-center gap-3 border-t border-border px-4 active:bg-surface-2"
            >
              <Ionicons name="log-out-outline" size={20} color={tokens.danger} />
              <Text className="text-danger">Выйти</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => {
              track('auth_screen_viewed', { mode: 'sign_in', from: 'settings' });
              router.push('/auth');
            }}
            accessibilityRole="button"
            className="min-h-14 flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-2"
          >
            <Ionicons name="person-circle-outline" size={22} color={tokens.accent} />
            <View className="flex-1">
              <Text>Войти или создать аккаунт</Text>
              <Text variant="caption">Sign in to sync progress between your phones</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={tokens.textMuted} />
          </Pressable>
        )}
      </View>
    </>
  );
}
