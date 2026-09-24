import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAmbientCursors } from '@/store/ambient-cursors';
import { useAmbientPrefs } from '@/store/ambient-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { useAmbientActivity, useStudyAmbience } from './activity';
import { AMBIENT_THEME_ORDER, AMBIENT_THEMES, type AmbientThemeId } from './beds';
import { nextStart } from './cursors';
import {
  formatClock,
  formatTrackCount,
  previewDisabledReason,
  SOUNDTRACK_ICONS,
  themeDurationMs,
} from './soundtracks';

/**
 * The «Soundtracks» list inside the Background-music card (M15/T49, design
 * AMBIENT_SOUNDTRACKS §8): one row per theme with «Up next» from the
 * persisted cursor, a ▶/■ preview and «Reset rotation». The preview is an
 * ordinary study activity registered with the chosen theme while Settings is
 * focused — it plays through the ONE engine under the same policy, so
 * listening advances the cursor exactly like reading would.
 */
export function SoundtracksList() {
  const { tokens } = useAppTheme();
  const prefs = useAmbientPrefs();
  const narrating = useAmbientActivity((s) => s.narrations.size > 0);
  const cursors = useAmbientCursors((s) => s.cursors);
  const resetCursor = useAmbientCursors((s) => s.resetCursor);
  const [requested, setPreviewTheme] = React.useState<AmbientThemeId | null>(null);

  // A preview that the policy would silence (ambience switched off, volume
  // dragged to 0, narration started with the mix off) is dropped rather than
  // left looking live — the ▶ shows again with the hint underneath.
  const disabledReason = previewDisabledReason(prefs, narrating);
  const previewTheme = disabledReason ? null : requested;

  useStudyAmbience(previewTheme != null, previewTheme ?? undefined);
  // Leaving Settings unregisters the activity (focus-scoped); also reset the
  // ▶ icons so a return to the screen does not claim a preview is playing.
  useFocusEffect(React.useCallback(() => () => setPreviewTheme(null), []));

  const togglePreview = (theme: AmbientThemeId) => {
    if (previewTheme === theme) {
      setPreviewTheme(null);
      return;
    }
    track('ambient_preview_played', { theme });
    setPreviewTheme(theme);
  };

  const reset = (theme: AmbientThemeId) => {
    // The store's reset also tells the engine to restart a loaded theme from
    // bed 1 @ 0 (`ambient-audio-host.tsx`), so a live preview restarts too.
    resetCursor(theme);
    track('ambient_rotation_reset', { theme });
  };

  return (
    <View className="border-t border-border">
      <View className="gap-0.5 px-4 pb-2 pt-3.5">
        <Text className="font-ui-medium">Soundtracks</Text>
        <Text variant="caption">
          Each theme resumes where it left off — listening here counts too. Preview plays through
          the same volume and narration settings.
        </Text>
        {disabledReason && (
          <Text variant="caption" className="mt-1 text-accent">
            {disabledReason}
          </Text>
        )}
      </View>
      {AMBIENT_THEME_ORDER.map((id) => {
        const theme = AMBIENT_THEMES[id];
        const upNext = nextStart(id, cursors[id]);
        const previewing = previewTheme === id;
        return (
          <View
            key={id}
            className="flex-row items-center gap-3 border-t border-border px-4 py-3"
            accessibilityLabel={`${theme.label.en} · ${theme.label.ru}`}
          >
            <Ionicons name={SOUNDTRACK_ICONS[id]} size={20} color={tokens.textMuted} />
            <View className="flex-1 gap-0.5">
              <Text className="font-ui-medium">{theme.label.en}</Text>
              <Text variant="caption">
                {formatTrackCount(theme.beds.length)} · {formatClock(themeDurationMs(id))}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                Up next: {upNext.bed.title} · {formatClock(upNext.positionMs)}
              </Text>
            </View>
            <Pressable
              onPress={() => reset(id)}
              hitSlop={8}
              className="min-h-11 justify-center px-2"
              accessibilityRole="button"
              accessibilityLabel={`Reset ${theme.label.en} rotation`}
            >
              <Text variant="caption">Reset</Text>
            </Pressable>
            <Pressable
              onPress={() => togglePreview(id)}
              disabled={disabledReason != null}
              hitSlop={4}
              className="h-11 w-11 items-center justify-center rounded-full bg-surface2"
              style={disabledReason ? { opacity: 0.4 } : undefined}
              accessibilityRole="button"
              accessibilityState={{ disabled: disabledReason != null, selected: previewing }}
              accessibilityLabel={
                previewing ? `Stop ${theme.label.en} preview` : `Preview ${theme.label.en}`
              }
            >
              <Ionicons
                name={previewing ? 'stop' : 'play'}
                size={20}
                color={previewing ? tokens.accent : tokens.text}
              />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
