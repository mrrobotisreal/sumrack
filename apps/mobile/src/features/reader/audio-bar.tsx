import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import type { AudioTrackRow } from '@/db/repositories/content';
import { useAppTheme } from '@/theme/use-app-theme';

import { trackLabel, type Narration } from './use-narration';

/**
 * AudioBar (UI_DESIGN §7, design §7.1): the reader's bottom-anchored
 * narration bar — play/pause, inline scrubber, elapsed/total time, speed
 * cycle, and a voice/style switcher sheet when the story ships >1 track.
 * Rendered only when the story has playable (downloaded) audio.
 */

interface AudioBarProps {
  narration: Narration;
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioBar({ narration }: AudioBarProps) {
  const insets = useSafeAreaInsets();
  const { tokens } = useAppTheme();
  const [trackSheetOpen, setTrackSheetOpen] = React.useState(false);

  const {
    playing,
    positionMs,
    durationMs,
    rate,
    error,
    playableTracks,
    currentTrack,
    toggle,
    seekToMs,
    cycleRate,
    switchTrack,
  } = narration;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 border-t border-border bg-surface px-4 pt-2"
      style={{ paddingBottom: insets.bottom + 8 }}
    >
      {error ? (
        <Text variant="caption" className="pb-1 text-danger">
          Audio unavailable — {error}
        </Text>
      ) : null}

      <Scrubber
        positionMs={positionMs}
        durationMs={durationMs}
        onSeek={(ms) => seekToMs(ms, 'scrub')}
      />

      <View className="mt-1 flex-row items-center gap-3">
        <Pressable
          onPress={toggle}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause narration' : 'Play narration'}
          className="h-11 w-11 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={22}
            color={tokens.bg}
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>

        <View className="flex-1">
          <Text variant="caption" className="font-ui tabular-nums">
            {formatTime(positionMs)} / {formatTime(durationMs)}
          </Text>
          {currentTrack && (
            <Text variant="caption" className="text-text-muted" numberOfLines={1}>
              {trackLabel(currentTrack)}
              {narration.mode === 'sentence' ? '  ·  sentence sync' : ''}
            </Text>
          )}
        </View>

        <Pressable
          onPress={cycleRate}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${rate}x`}
          className="min-w-[52px] items-center rounded-full border border-border bg-surface-2 px-3 py-1.5 active:bg-border"
        >
          <Text variant="caption" className="font-ui-medium tabular-nums">
            {rate}×
          </Text>
        </Pressable>

        {playableTracks.length > 1 && (
          <Pressable
            onPress={() => setTrackSheetOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Switch narration voice"
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface-2 active:bg-border"
          >
            <Ionicons name="people-outline" size={17} color={tokens.textMuted} />
          </Pressable>
        )}
      </View>

      <TrackSheet
        open={trackSheetOpen}
        tracks={playableTracks}
        currentId={currentTrack?.id ?? null}
        onSelect={(id) => {
          setTrackSheetOpen(false);
          switchTrack(id);
        }}
        onClose={() => setTrackSheetOpen(false)}
      />
    </View>
  );
}

/**
 * Dependency-free scrub bar: drag previews the position locally and seeks
 * once on release; a plain tap jumps. Uses RN's responder touch events
 * directly — a GestureDetector here (inside the absolutely-positioned bar)
 * never received touches on-device, and the responder route is simpler
 * anyway (T10 session note).
 */
function Scrubber({
  positionMs,
  durationMs,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const widthRef = React.useRef(1);
  const [dragFraction, setDragFraction] = React.useState<number | null>(null);
  const dragFractionRef = React.useRef<number | null>(null);

  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    widthRef.current = Math.max(1, e.nativeEvent.layout.width);
  }, []);

  const moveTo = React.useCallback((x: number) => {
    const fraction = Math.min(1, Math.max(0, x / widthRef.current));
    dragFractionRef.current = fraction;
    setDragFraction(fraction);
  }, []);

  const finish = React.useCallback(() => {
    const fraction = dragFractionRef.current;
    if (fraction != null && durationMs > 0) onSeek(Math.round(fraction * durationMs));
    dragFractionRef.current = null;
    setDragFraction(null);
  }, [durationMs, onSeek]);

  const playedFraction =
    dragFraction ?? (durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0);

  return (
    <View
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => moveTo(e.nativeEvent.locationX)}
      onResponderMove={(e) => moveTo(e.nativeEvent.locationX)}
      onResponderRelease={finish}
      onResponderTerminate={() => {
        dragFractionRef.current = null;
        setDragFraction(null);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Narration position"
      className="justify-center py-2"
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <View className="h-[3px] overflow-hidden rounded-full bg-surface-2">
        <View
          className="h-full rounded-full bg-accent"
          style={{ width: `${playedFraction * 100}%` }}
        />
      </View>
      <View
        className="absolute h-3 w-3 rounded-full bg-accent"
        style={{ left: `${playedFraction * 100}%`, marginLeft: -6 }}
      />
    </View>
  );
}

/** Voice/style switcher — bottom sheet listing the story's playable tracks. */
function TrackSheet({
  open,
  tracks,
  currentId,
  onSelect,
  onClose,
}: {
  open: boolean;
  tracks: AudioTrackRow[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { tokens } = useAppTheme();
  if (!open) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />
      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <Text className="font-ui-medium pb-2">Narration voice</Text>
        {tracks.map((t) => {
          const selected = t.id === currentId;
          return (
            <Pressable
              key={t.id}
              onPress={() => onSelect(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className="flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-surface-2"
            >
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? tokens.accent : tokens.border}
              />
              <View className="flex-1">
                <Text>{trackLabel(t)}</Text>
                <Text variant="caption">{formatTime(t.durationMs)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
