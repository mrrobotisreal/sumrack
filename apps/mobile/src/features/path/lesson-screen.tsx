import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { QueryError } from '@/components/query-error';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { recordLessonCompleted } from '@/features/motivation/service';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { isHouseScene } from './house-map/rooms';
import { RoomScene } from './scenes/room-scene';
import { signalRoomExit, ThresholdOverlay } from './scenes/threshold-transition';
import { usePackTheme } from './scenes/use-pack-theme';
import { useInvalidatePath } from './use-path';

/**
 * Grammar mini-lesson (design §7.5), rendered with T15's markdown component
 * — no second renderer. "Read" is stamped when Mitch reaches the end of the
 * lesson (scroll) or taps Done; rereads never move the stamp.
 */
export function LessonScreen({ packId }: { packId: string }) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const invalidatePath = useInvalidatePath();
  const markedRef = React.useRef(false);

  const lesson = useQuery({
    queryKey: ['lesson', packId],
    queryFn: () => repos.content.getLesson(packId),
  });

  // T31: themed units render their room's ambient scene behind the lesson.
  const theme = usePackTheme(packId);
  const scened = isHouseScene(theme.scene);
  const [entering, setEntering] = React.useState(true);
  const themeRef = React.useRef(theme);
  React.useEffect(() => {
    themeRef.current = theme;
  }, [theme]);
  React.useEffect(
    () => () => {
      // Leaving the room back to the path — the path screen plays the brief
      // reverse threshold if it refocuses promptly (T31).
      const { scene, accent } = themeRef.current;
      if (isHouseScene(scene)) signalRoomExit(scene, accent);
    },
    [],
  );

  React.useEffect(() => {
    track('lesson_opened', { packId });
  }, [packId]);

  const markRead = React.useCallback(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    void repos.path.markLessonRead(packId).then((first) => {
      if (first) {
        track('lesson_completed', { packId });
        void recordLessonCompleted(); // T19 XP
      }
      invalidatePath();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);

  if (lesson.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  if (lesson.isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg px-8">
        <QueryError onRetry={() => void lesson.refetch()} />
      </View>
    );
  }

  const row = lesson.data;
  if (!row) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-bg px-8">
        <Ionicons name="book-outline" size={36} color={tokens.textMuted} />
        <Text variant="muted" className="text-center">
          This unit&apos;s lesson isn&apos;t installed. Sync content in Библиотека and try again.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <Stack.Screen options={{ title: row.titleRu }} />
      {scened && <RoomScene scene={theme.scene} accent={theme.accent} />}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-16 pt-5"
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 32) markRead();
        }}
        scrollEventThrottle={250}
      >
        {/* Over a scene, content floats on a translucent surface card (T31). */}
        <View className={scened ? 'rounded-2xl bg-surface-veil p-4' : ''}>
          <RNText className="font-reading text-3xl text-text">{row.titleRu}</RNText>
          <Text variant="muted" className="mb-5 mt-1">
            {row.titleEn}
          </Text>
          <MarkdownView source={row.body} />
          <Pressable
            onPress={() => {
              markRead();
              router.back();
            }}
            accessibilityRole="button"
            className="mt-8 items-center rounded-xl bg-accent py-3.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-bg">Понятно — done reading</Text>
          </Pressable>
        </View>
      </ScrollView>
      {scened && entering && (
        <ThresholdOverlay
          direction="enter"
          accent={theme.accent}
          onDone={() => setEntering(false)}
        />
      )}
    </View>
  );
}
