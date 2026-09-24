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
import { CrashGuard } from '@/components/crash-guard';
import { AiQueue } from '@/components/ai-queue';
import { AutoBackup } from '@/components/auto-backup';
import { AutoSync } from '@/components/auto-sync';
import { DbProvider } from '@/db/provider';
import { AmbientAudioHost } from '@/features/ambient-audio/ambient-audio-host';
import { ShareIntentGate } from '@/features/import/share-gate';
import { AchievementToastHost } from '@/features/motivation/achievement-toast';
import { NotificationRouter } from '@/features/motivation/notification-router';
import { ReminderReplanner } from '@/features/motivation/reminder-replanner';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import { installGlobalErrorLogging } from '@/services/error-log';
import { useThemeStore } from '@/store/theme';
import { useAppTheme } from '@/theme/use-app-theme';

SplashScreen.preventAutoHideAsync();

// T22 crash guard: capture unhandled JS errors + promise rejections into the
// local error log from the earliest possible moment (before first render).
installGlobalErrorLogging();

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
            <CrashGuard>
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
                  name="review/daily"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="review/listening"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="review/pronunciation"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="review/cloze"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="review/sentence-builder"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen name="games" options={{ title: 'Games' }} />
                <Stack.Screen name="dialogues" options={{ title: 'Диалоги' }} />
                <Stack.Screen
                  name="dialogue/[packId]/[dialogueId]"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen name="dashboard/index" options={{ title: 'Progress' }} />
                <Stack.Screen name="dashboard/assessment" options={{ title: 'AI assessment' }} />
                <Stack.Screen name="path/[packId]/lesson" options={{ title: 'Lesson' }} />
                <Stack.Screen
                  name="path/[packId]/quiz"
                  options={{ headerShown: false, animation: 'fade', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="path/checkpoint/[packId]"
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
                <Stack.Screen name="word-bank/enrich" options={{ title: 'Enrich with AI' }} />
                <Stack.Screen name="lessons/index" options={{ title: 'Lessons' }} />
                <Stack.Screen name="lessons/[id]" options={{ title: 'Lesson' }} />
                <Stack.Screen name="packs" options={{ title: 'Content packs' }} />
                <Stack.Screen name="restore" options={{ title: 'Restore from backup' }} />
                <Stack.Screen name="error-log" options={{ title: 'Error log' }} />
                <Stack.Screen
                  name="journal/[id]"
                  options={{ headerShown: false, animation: 'fade' }}
                />
                <Stack.Screen name="journal/search" options={{ title: 'Search' }} />
                <Stack.Screen name="search" options={{ title: 'Search' }} />
                <Stack.Screen name="bookmarks" options={{ title: 'Закладки' }} />
                <Stack.Screen name="import" options={{ title: 'Импорт' }} />
                <Stack.Screen name="import-review/[id]" options={{ title: 'Проверка импорта' }} />
                <Stack.Screen
                  name="notes/[id]"
                  options={{ headerShown: false, animation: 'fade' }}
                />
                <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
                <Stack.Screen name="dev-db" options={{ title: 'DB Debug' }} />
                <Stack.Screen name="dev-tts" options={{ title: 'Read any text' }} />
              </Stack>
              <AmbientAudioHost ready={introDone} />
              <AutoSync />
              <AutoBackup />
              <AiQueue />
              <ShareIntentGate />
              <NotificationRouter />
              <ReminderReplanner />
              <AchievementToastHost />
              {!introDone && <AnimatedSplash onDone={() => setIntroDone(true)} />}
            </CrashGuard>
          </ThemeProvider>
        </QueryClientProvider>
      </DbProvider>
    </GestureHandlerRootView>
  );
}
