import '../global.css';

import {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_700Bold,
} from '@expo-google-fonts/golos-text';
import {
  Literata_400Regular,
  Literata_400Regular_Italic,
  Literata_700Bold,
  useFonts,
} from '@expo-google-fonts/literata';
import {
  RubikWetPaint_400Regular,
  useFonts as useDisplayFonts,
} from '@expo-google-fonts/rubik-wet-paint';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts as useGolosFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplash } from '@/components/animated-splash';
import { AutoSync } from '@/components/auto-sync';
import { DbProvider } from '@/db/provider';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import { useThemeStore } from '@/store/theme';
import { useAppTheme } from '@/theme/use-app-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Importing the theme store applies the persisted dark/light/system mode
  // to NativeWind on startup (see src/store/theme.ts).
  useThemeStore();
  const { scheme, navTheme, tokens } = useAppTheme();

  const [literataLoaded, literataError] = useFonts({
    Literata_400Regular,
    Literata_400Regular_Italic,
    Literata_700Bold,
  });
  const [golosLoaded, golosError] = useGolosFonts({
    GolosText_400Regular,
    GolosText_500Medium,
    GolosText_700Bold,
  });
  // Display font for the splash intro + branding (Сумрак wordmark)
  const [displayLoaded, displayError] = useDisplayFonts({
    RubikWetPaint_400Regular,
  });
  const fontsReady =
    (literataLoaded || !!literataError) &&
    (golosLoaded || !!golosError) &&
    (displayLoaded || !!displayError);

  const [introDone, setIntroDone] = React.useState(false);

  React.useEffect(() => {
    track('app_opened');
  }, []);

  React.useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DbProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme}>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerTitleStyle: { fontFamily: 'GolosText_500Medium', color: tokens.text },
                headerStyle: { backgroundColor: tokens.surface },
                contentStyle: { backgroundColor: tokens.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="reader/[packId]/[storyId]"
                options={{ headerShown: false, animation: 'fade' }}
              />
              <Stack.Screen
                name="review/session"
                options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
              />
              <Stack.Screen
                name="review/pronunciation"
                options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
              />
              <Stack.Screen
                name="settings"
                options={{ title: 'Settings', presentation: 'modal' }}
              />
              <Stack.Screen name="word-bank/[id]" options={{ title: 'Word bank' }} />
              <Stack.Screen
                name="word-bank/add"
                options={{ title: 'Add to word bank', presentation: 'modal' }}
              />
              <Stack.Screen name="packs" options={{ title: 'Content packs' }} />
              <Stack.Screen name="dev-db" options={{ title: 'DB Debug' }} />
              <Stack.Screen name="dev-tts" options={{ title: 'Read any text' }} />
            </Stack>
            <AutoSync />
            {!introDone && <AnimatedSplash onDone={() => setIntroDone(true)} />}
          </ThemeProvider>
        </QueryClientProvider>
      </DbProvider>
    </GestureHandlerRootView>
  );
}
