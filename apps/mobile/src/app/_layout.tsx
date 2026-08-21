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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts as useGolosFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';

import { DbProvider } from '@/db/provider';
import { track } from '@/services/analytics';
import { useThemeStore } from '@/store/theme';
import { useAppTheme } from '@/theme/use-app-theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

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
  const fontsReady = (literataLoaded || !!literataError) && (golosLoaded || !!golosError);

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
            <Stack.Screen name="settings" options={{ title: 'Settings', presentation: 'modal' }} />
            <Stack.Screen name="dev-db" options={{ title: 'DB Debug' }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </DbProvider>
  );
}
