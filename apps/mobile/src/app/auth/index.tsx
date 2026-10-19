import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { authErrorCopy, validateCredentials, type AuthMode } from '@/features/account/auth-errors';
import { signInEmail, signInGoogle, signUpEmail } from '@/features/account/auth-service';
import { FogBackdrop } from '@/features/account/fog-backdrop';
import { useAccount } from '@/features/account/store';
import { track } from '@/services/analytics';
import { useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

const TITLE_RED = '#E8452F';
const GLOW_RED = '#FF3B1F';

type Busy = null | 'email' | 'google';

/**
 * «Вход / Регистрация» (T102, ACCOUNTS_AND_SYNC §3): the crescent moon, the
 * «Сумрак» wordmark in Rubik Wet Paint, slow ember fog, then email +
 * password (with a sign-up confirm), Google, password reset and a quiet
 * «Продолжить без аккаунта». Dark only. Never blocks local data.
 */
export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const setSkipped = useAccount((s) => s.setSkipped);

  const [mode, setMode] = React.useState<AuthMode>('sign_in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [error, setError] = React.useState<ReturnType<typeof authErrorCopy> | null>(null);
  const [focused, setFocused] = React.useState(true);

  const passwordRef = React.useRef<TextInput>(null);
  const confirmRef = React.useRef<TextInput>(null);

  useFocusEffect(
    React.useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const switchMode = (next: AuthMode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
    track('auth_screen_viewed', { mode: next, from: 'toggle' });
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submitEmail = async () => {
    const local = validateCredentials(mode, email, password, confirm);
    if (local) {
      setError(authErrorCopy({ code: local }));
      return;
    }
    setError(null);
    setBusy('email');
    track('auth_submit', { method: 'email', mode });
    try {
      if (mode === 'sign_up') await signUpEmail(email, password);
      else await signInEmail(email, password);
      track('auth_succeeded', { method: 'email', isNewUser: mode === 'sign_up' });
      setSkipped(false);
      leave();
    } catch (err) {
      const copy = authErrorCopy(err);
      setError(copy);
      track('auth_failed', {
        method: 'email',
        code: String((err as { code?: unknown })?.code ?? 'unknown'),
      });
    } finally {
      setBusy(null);
    }
  };

  const submitGoogle = async () => {
    setError(null);
    setBusy('google');
    track('auth_submit', { method: 'google', mode });
    try {
      const res = await signInGoogle();
      if (!res) return; // cancelled — stay quiet
      track('auth_succeeded', { method: 'google', isNewUser: res.isNewUser });
      setSkipped(false);
      leave();
    } catch (err) {
      setError(authErrorCopy(err));
      track('auth_failed', {
        method: 'google',
        code: String((err as { code?: unknown })?.code ?? 'unknown'),
      });
    } finally {
      setBusy(null);
    }
  };

  const skip = () => {
    track('auth_skipped');
    setSkipped(true);
    leave();
  };

  const inputClass = (field: 'email' | 'password' | 'confirm') =>
    `min-h-14 rounded-2xl border bg-surface/90 px-4 font-ui text-base text-text ${
      error?.field === field ? 'border-danger' : 'border-border'
    }`;

  return (
    <View className="flex-1 bg-bg">
      <FogBackdrop paused={!focused} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + 28,
            paddingBottom: insets.bottom + 28,
            paddingHorizontal: 24,
            flexGrow: 1,
          }}
        >
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(600)}
            className="items-center"
          >
            <Image
              source={require('../../../assets/images/auth/sumrak-moon.png')}
              style={{ width: 132, height: 132, borderRadius: 30 }}
              contentFit="cover"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <Text
              accessibilityRole="header"
              style={{
                fontFamily: 'RubikWetPaint_400Regular',
                fontSize: 54,
                lineHeight: 70,
                color: TITLE_RED,
                letterSpacing: 2,
                textShadowColor: GLOW_RED,
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 22,
                marginTop: 10,
              }}
            >
              Сумрак
            </Text>
            <Text variant="caption" className="mt-1 text-center">
              {mode === 'sign_in'
                ? 'С возвращением. Твой прогресс ждёт в темноте.'
                : 'Один аккаунт — оба телефона, один прогресс.'}
            </Text>
          </Animated.View>

          <View
            className="mt-7 flex-row rounded-2xl border border-border bg-surface/80 p-1"
            accessibilityRole="tablist"
          >
            {(
              [
                ['sign_in', 'Вход'],
                ['sign_up', 'Регистрация'],
              ] as const
            ).map(([m, label]) => (
              <Pressable
                key={m}
                onPress={() => switchMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                className={`min-h-11 flex-1 items-center justify-center rounded-xl ${
                  mode === m ? 'bg-accent' : ''
                }`}
              >
                <Text className={`font-ui-medium ${mode === m ? 'text-white' : 'text-text-muted'}`}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-5 gap-3">
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={tokens.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              accessibilityLabel="Email"
              className={inputClass('email')}
              selectionColor={tokens.accent}
            />
            <View className="justify-center">
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder={mode === 'sign_up' ? 'Пароль (минимум 8 символов)' : 'Пароль'}
                placeholderTextColor={tokens.textMuted}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
                textContentType={mode === 'sign_up' ? 'newPassword' : 'password'}
                returnKeyType={mode === 'sign_up' ? 'next' : 'go'}
                onSubmitEditing={() =>
                  mode === 'sign_up' ? confirmRef.current?.focus() : void submitEmail()
                }
                accessibilityLabel="Password"
                className={`${inputClass('password')} pr-14`}
                selectionColor={tokens.accent}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-4"
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                  color={tokens.textMuted}
                />
              </Pressable>
            </View>
            {mode === 'sign_up' && (
              <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
                <TextInput
                  ref={confirmRef}
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Повторите пароль"
                  placeholderTextColor={tokens.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  returnKeyType="go"
                  onSubmitEditing={() => void submitEmail()}
                  accessibilityLabel="Confirm password"
                  className={inputClass('confirm')}
                  selectionColor={tokens.accent}
                />
              </Animated.View>
            )}
          </View>

          {error && (
            <View
              accessibilityLiveRegion="polite"
              className="mt-3 flex-row gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5"
            >
              <Ionicons name="alert-circle-outline" size={18} color={tokens.danger} />
              <View className="flex-1">
                <Text className="text-sm text-text">{error.ru}</Text>
                <Text variant="caption" className="text-xs">
                  {error.en}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            onPress={() => void submitEmail()}
            disabled={busy != null}
            accessibilityRole="button"
            accessibilityLabel={mode === 'sign_in' ? 'Sign in' : 'Create account'}
            accessibilityState={{ busy: busy === 'email', disabled: busy != null }}
            className="mt-5 min-h-14 items-center justify-center rounded-2xl bg-accent active:opacity-85"
            style={{ opacity: busy != null && busy !== 'email' ? 0.6 : 1 }}
          >
            {busy === 'email' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="font-ui-bold text-base text-white">
                {mode === 'sign_in' ? 'Войти' : 'Создать аккаунт'}
              </Text>
            )}
          </Pressable>

          {mode === 'sign_in' && (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/auth/reset', params: { email: email.trim() } })
              }
              accessibilityRole="link"
              className="mt-3 min-h-11 items-center justify-center self-center px-3"
            >
              <Text className="text-sm text-text-muted">Забыли пароль?</Text>
            </Pressable>
          )}

          <View className="my-5 flex-row items-center gap-3">
            <View className="h-px flex-1 bg-border" />
            <Text variant="caption">или</Text>
            <View className="h-px flex-1 bg-border" />
          </View>

          <Pressable
            onPress={() => void submitGoogle()}
            disabled={busy != null}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Google"
            accessibilityState={{ busy: busy === 'google', disabled: busy != null }}
            className="min-h-14 flex-row items-center justify-center gap-3 rounded-2xl border border-border bg-surface-2 active:opacity-85"
            style={{ opacity: busy != null && busy !== 'google' ? 0.6 : 1 }}
          >
            {busy === 'google' ? (
              <ActivityIndicator color={tokens.text} />
            ) : (
              <>
                <Image
                  source={require('../../../assets/images/auth/google-g.png')}
                  style={{ width: 22, height: 22 }}
                  contentFit="contain"
                  accessible={false}
                />
                <Text className="font-ui-medium text-base text-text">Войти через Google</Text>
              </>
            )}
          </Pressable>

          <View className="flex-1" />

          <Pressable
            onPress={skip}
            disabled={busy != null}
            accessibilityRole="button"
            className="mt-8 min-h-11 items-center justify-center self-center px-4"
          >
            <Text className="text-sm text-text-muted">Продолжить без аккаунта</Text>
            <Text variant="caption" className="text-xs">
              Everything stays on this phone · sign in later in Settings
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
