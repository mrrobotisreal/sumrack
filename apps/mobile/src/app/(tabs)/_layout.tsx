import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, type ColorValue } from 'react-native';

import { useAppTheme } from '@/theme/use-app-theme';

/**
 * The five-pillar tab shell (design §10). Russian titles are the intended
 * delight; English fallbacks live here for the future settings toggle
 * (UI_DESIGN §3 — "toggleable, EN fallback strings maintained").
 */
const TAB_TITLES = {
  index: { ru: 'Сегодня', en: 'Today' },
  path: { ru: 'Путь', en: 'Path' },
  library: { ru: 'Библиотека', en: 'Library' },
  dictionary: { ru: 'Словарь', en: 'Word bank' },
  journal: { ru: 'Журнал', en: 'Journal' },
} as const;

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IoniconName) {
  return function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };
}

export default function TabsLayout() {
  const router = useRouter();
  const { tokens } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tokens.accent,
        tabBarInactiveTintColor: tokens.textMuted,
        tabBarStyle: { backgroundColor: tokens.surface, borderTopColor: tokens.border },
        tabBarLabelStyle: { fontFamily: 'GolosText_500Medium', fontSize: 11 },
        headerStyle: { backgroundColor: tokens.surface },
        headerTitleStyle: { fontFamily: 'GolosText_500Medium', color: tokens.text },
        headerRight: () => (
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={8}
            accessibilityLabel="Settings"
            className="mr-4"
          >
            <Ionicons name="person-circle-outline" size={26} color={tokens.textMuted} />
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: TAB_TITLES.index.ru, tabBarIcon: tabIcon('today-outline') }}
      />
      <Tabs.Screen
        name="path"
        options={{ title: TAB_TITLES.path.ru, tabBarIcon: tabIcon('trail-sign-outline') }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: TAB_TITLES.library.ru,
          tabBarIcon: tabIcon('library-outline'),
          headerRight: () => (
            <>
              <Pressable
                onPress={() => router.push('/packs')}
                hitSlop={8}
                accessibilityLabel="Content packs"
                className="mr-4"
              >
                <Ionicons name="cloud-download-outline" size={24} color={tokens.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/settings')}
                hitSlop={8}
                accessibilityLabel="Settings"
                className="mr-4"
              >
                <Ionicons name="person-circle-outline" size={26} color={tokens.textMuted} />
              </Pressable>
            </>
          ),
        }}
      />
      <Tabs.Screen
        name="dictionary"
        options={{ title: TAB_TITLES.dictionary.ru, tabBarIcon: tabIcon('bookmarks-outline') }}
      />
      <Tabs.Screen
        name="journal"
        options={{ title: TAB_TITLES.journal.ru, tabBarIcon: tabIcon('create-outline') }}
      />
    </Tabs>
  );
}
