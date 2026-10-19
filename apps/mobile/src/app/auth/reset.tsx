import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { authErrorCopy, validateCredentials } from '@/features/account/auth-errors';
import { sendReset } from '@/features/account/auth-service';
import { FogBackdrop } from '@/features/account/fog-backdrop';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

/** «Забыли пароль?» (T102): one field, Firebase sends the reset email. */
export default function ResetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = React.useState(params.email ?? '');
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<ReturnType<typeof authErrorCopy> | null>(null);

  const submit = async () => {
    if (validateCredentials('sign_in', email, 'x', '')) {
      setError(authErrorCopy({ code: 'local/email-format' }));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await sendReset(email);
      track('auth_password_reset_sent');
      setSent(true);
    } catch (err) {
      setError(authErrorCopy(err));
      track('auth_failed', {
        method: 'email',
        code: String((err as { code?: unknown })?.code ?? 'unknown'),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-bg px-6" style={{ paddingTop: insets.top + 16 }}>
      <FogBackdrop paused={false} />
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        className="min-h-11 w-11 justify-center"
      >
        <Ionicons name="chevron-back" size={26} color={tokens.text} />
      </Pressable>
      <Text variant="heading" className="mt-4">
        Сброс пароля
      </Text>
      <Text variant="caption" className="mt-1">
        Мы пришлём ссылку на почту · we&apos;ll email you a reset link.
      </Text>
      {sent ? (
        <View className="mt-8 flex-row gap-3 rounded-2xl border border-border bg-surface p-4">
          <Ionicons name="mail-open-outline" size={22} color={tokens.accent} />
          <View className="flex-1">
            <Text>Письмо отправлено.</Text>
            <Text variant="caption">Check {email.trim()} (and spam), then sign in again.</Text>
          </View>
        </View>
      ) : (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Email"
            selectionColor={tokens.accent}
            className={`mt-8 min-h-14 rounded-2xl border bg-surface px-4 font-ui text-base text-text ${
              error ? 'border-danger' : 'border-border'
            }`}
          />
          {error && (
            <Text className="mt-2 text-sm text-danger">
              {error.ru} <Text variant="caption">{error.en}</Text>
            </Text>
          )}
          <Pressable
            onPress={() => void submit()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Send reset email"
            className="mt-5 min-h-14 items-center justify-center rounded-2xl bg-accent active:opacity-85"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-ui-bold text-white">Отправить ссылку</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}
