import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { BackHandler, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { safeBack } from '@/lib/safe-back';
import { useAppTheme } from '@/theme/use-app-theme';

import { CoverArt } from './cover-art';
import { formatTime } from './format-time';
import { listenPlayer, useListenStore } from './listen-service';
import { PartsSheet } from './parts-sheet';
import { SKIP_BACK_MS, SKIP_FORWARD_MS } from './listen-player';
import { SpeedSheet, rateLabel } from './speed-sheet';

/** `/listen/[packId]` — the full-story media player (FULL_STORY_LISTEN §2.2). */
export function ListenScreen() {
  const { packId, from } = useLocalSearchParams<{ packId: string; from?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tokens } = useAppTheme();

  const session = useListenStore((s) => s.session);
  const playing = useListenStore((s) => s.playing);
  const positionMs = useListenStore((s) => s.positionMs);
  const durationMs = useListenStore((s) => s.durationMs);
  const rate = useListenStore((s) => s.rate);
  const volume = useListenStore((s) => s.volume);
  const muted = useListenStore((s) => s.muted);
  const partIndex = useListenStore((s) => s.partIndex);
  const finished = useListenStore((s) => s.finished);

  const [scrubMs, setScrubMs] = React.useState<number | null>(null);
  const [speedOpen, setSpeedOpen] = React.useState(false);
  const [partsOpen, setPartsOpen] = React.useState(false);
  const scrubbing = React.useRef(false);

  const openSource = from === 'resume' ? 'resume' : from === 'now-playing' ? 'now-playing' : 'library';
  const load = React.useCallback(() => {
    void listenPlayer.open(packId, { autoplay: false, source: openSource });
  }, [packId, openSource]);

  React.useEffect(() => {
    load();
    // Save on unmount; the session itself keeps playing (module singleton).
    return () => listenPlayer.saveNow();
  }, [load]);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (router.canGoBack()) return false;
      router.replace('/(tabs)');
      return true;
    });
    return () => sub.remove();
  }, [router]);

  const source = session?.source;
  const status = session?.status ?? 'loading';
  const segment = source?.segments[partIndex];
  const total = source?.segments.length ?? 0;
  const shownMs = scrubMs ?? positionMs;
  const coverSize = Math.round(width * 0.72);

  const openInReader = () => {
    if (!source || !segment) return;
    listenPlayer.pauseForReader();
    listenPlayer.track('listen_open_reader', {
      packId: source.packId,
      storyId: segment.storyId,
      positionMs: listenPlayer.store.getState().positionMs,
    });
    router.push(`/reader/${source.packId}/${segment.storyId}`);
  };

  if (status === 'error' || (!session && listenPlayer.store.getState().error)) {
    return (
      <View
        className="flex-1 items-center justify-center gap-4 bg-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <Text className="text-center">Не удалось открыть аудио</Text>
        <Pressable
          onPress={load}
          accessibilityRole="button"
          className="rounded-full border border-border bg-surface px-5 py-2 active:bg-surface-2"
        >
          <Text className="text-accent">Повторить</Text>
        </Pressable>
        <Pressable onPress={() => safeBack(router)} accessibilityRole="button" hitSlop={8}>
          <Text variant="caption">Назад</Text>
        </Pressable>
      </View>
    );
  }

  const ready = status === 'ready' && source != null;
  const remaining = Math.max(0, durationMs - shownMs);

  return (
    <View
      className="flex-1 bg-bg px-6"
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={() => safeBack(router)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Назад"
        >
          <Ionicons name="chevron-back" size={28} color={tokens.text} />
        </Pressable>
        <Pressable
          onPress={openInReader}
          disabled={!ready}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Открыть в читалке"
        >
          <Ionicons name="book-outline" size={24} color={ready ? tokens.text : tokens.textMuted} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center gap-5">
        <View className="items-center gap-1 px-2">
          <Text variant="title" className="text-center" numberOfLines={2}>
            {source?.titleRu ?? ''}
          </Text>
          {source ? (
            <Text variant="caption" className="text-center">
              {source.titleEn} · {source.level}
            </Text>
          ) : null}
        </View>

        <CoverArt coverUri={source?.coverUri ?? null} size={coverSize} />

        <Pressable
          onPress={() => ready && setPartsOpen(true)}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel="Список частей"
          className="items-center gap-0.5 px-2"
        >
          <Text numberOfLines={1} className="text-center">
            {ready ? `Часть ${partIndex + 1} из ${total}${segment ? ` · ${segment.titleRu}` : ''}` : 'Загрузка…'}
          </Text>
          {finished ? <Text variant="caption" className="text-accent">✓ Прослушано</Text> : null}
        </Pressable>
      </View>

      <View className="gap-1">
        <Slider
          style={{ width: '100%', height: 40 }}
          minimumValue={0}
          maximumValue={Math.max(1, durationMs)}
          value={shownMs}
          disabled={!ready}
          onSlidingStart={() => {
            scrubbing.current = true;
          }}
          onValueChange={(v) => {
            if (scrubbing.current) setScrubMs(v);
          }}
          onSlidingComplete={(v) => {
            scrubbing.current = false;
            setScrubMs(null);
            void listenPlayer.seekTo(v, 'scrub');
          }}
          minimumTrackTintColor={tokens.accent}
          maximumTrackTintColor={tokens.textMuted}
          thumbTintColor={tokens.text}
          accessibilityLabel="Позиция"
          accessibilityValue={{ min: 0, max: durationMs, now: Math.round(shownMs), text: formatTime(shownMs) }}
        />
        <View className="flex-row justify-between px-1">
          <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(shownMs)}
          </Text>
          <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
            −{formatTime(remaining)}
          </Text>
        </View>
      </View>

      <View className="mt-4 flex-row items-center justify-between">
        <Pressable
          onPress={() => setSpeedOpen(true)}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel="Скорость"
          className="min-w-[56px] items-center rounded-full border border-border bg-surface px-3 py-1.5 active:bg-surface-2"
        >
          <Text className="font-ui-medium text-sm">{rateLabel(rate)}</Text>
        </Pressable>
        <Pressable
          onPress={() => void listenPlayer.skip(-SKIP_BACK_MS)}
          disabled={!ready}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад на 15 секунд"
        >
          <View className="items-center">
            <Ionicons name="play-back" size={28} color={tokens.text} />
            <Text variant="caption">15</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => listenPlayer.toggle()}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Пауза' : 'Играть'}
          className="h-[72px] w-[72px] items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={34}
            color={tokens.bg}
            style={playing ? undefined : { marginLeft: 4 }}
          />
        </Pressable>
        <Pressable
          onPress={() => void listenPlayer.skip(SKIP_FORWARD_MS)}
          disabled={!ready}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Вперёд на 30 секунд"
        >
          <View className="items-center">
            <Ionicons name="play-forward" size={28} color={tokens.text} />
            <Text variant="caption">30</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => listenPlayer.setMuted(!muted)}
          disabled={!ready}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Включить звук' : 'Выключить звук'}
          className="min-w-[56px] items-center"
        >
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={26}
            color={tokens.text}
          />
        </Pressable>
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        <Ionicons name="volume-low" size={18} color={tokens.textMuted} />
        <Slider
          style={{ flex: 1, height: 36 }}
          minimumValue={0}
          maximumValue={1}
          step={0.01}
          value={muted ? 0 : volume}
          disabled={!ready}
          onSlidingComplete={(v) => {
            if (muted && v > 0) listenPlayer.setMuted(false);
            listenPlayer.setVolume(v);
          }}
          minimumTrackTintColor={tokens.accent}
          maximumTrackTintColor={tokens.textMuted}
          thumbTintColor={tokens.text}
          accessibilityLabel="Громкость"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(volume * 100) }}
        />
        <Ionicons name="volume-high" size={18} color={tokens.textMuted} />
      </View>

      <SpeedSheet
        open={speedOpen}
        rate={rate}
        onSelect={(r) => listenPlayer.setRate(r)}
        onClose={() => setSpeedOpen(false)}
      />
      <PartsSheet
        open={partsOpen}
        segments={source?.segments ?? []}
        currentIndex={partIndex}
        onSelect={(i) => void listenPlayer.seekToPart(i)}
        onClose={() => setPartsOpen(false)}
      />
    </View>
  );
}
