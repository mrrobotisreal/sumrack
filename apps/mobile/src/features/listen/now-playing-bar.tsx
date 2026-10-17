import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { CoverArt } from './cover-art';
import { listenPlayer, useListenStore } from './listen-service';

/**
 * Now-playing bar (FULL_STORY_LISTEN §2.3): 48 px, rendered above the tab bar
 * only while a listen session exists. Tap -> the player; play/pause; ✕ stops.
 */
export function NowPlayingBar() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const session = useListenStore((s) => s.session);
  const playing = useListenStore((s) => s.playing);
  if (!session || session.status === 'error') return null;
  const { source } = session;
  return (
    <View
      className="h-12 flex-row items-center gap-3 border-t border-border bg-surface px-3"
      accessibilityRole="toolbar"
    >
      <Pressable
        onPress={() =>
          router.push({ pathname: '/listen/[packId]', params: { packId: source.packId, from: 'now-playing' } })
        }
        accessibilityRole="button"
        accessibilityLabel="Открыть плеер"
        className="flex-1 flex-row items-center gap-3"
      >
        <CoverArt coverUri={source.coverUri} size={32} rounded={6} />
        <Text numberOfLines={1} className="flex-1 text-sm">
          {source.titleRu}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => listenPlayer.toggle()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Пауза' : 'Играть'}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={24} color={tokens.text} />
      </Pressable>
      <Pressable
        onPress={() => listenPlayer.stop('user')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Остановить"
      >
        <Ionicons name="close" size={22} color={tokens.textMuted} />
      </Pressable>
    </View>
  );
}
