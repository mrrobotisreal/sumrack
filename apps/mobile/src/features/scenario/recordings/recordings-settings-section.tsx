import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { formatBytes } from '@/features/tts/catalog';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { deleteAllRecordings, pruneRecordings, recordingsTotalBytes } from './prune';
import {
  CAP_BYTE_OPTIONS,
  DEFAULT_RECORDINGS_SETTINGS,
  getRecordingsSettings,
  PRUNE_DAY_OPTIONS,
  setRecordingsSettings,
  type RecordingsSettings,
} from './recordings-settings';

/**
 * Settings → Speech → «Recordings» (T63, SPEAKING_SCENARIOS §10.1): how much
 * the scenario recordings take on disk, the two prune knobs (days · cap),
 * a «Prune now» and «Delete all recordings». Pinned runs are never pruned;
 * deleting never touches the debrief text — only the audio.
 */
export function RecordingsSettingsSection() {
  const { tokens } = useAppTheme();
  const [settings, setSettings] = React.useState<RecordingsSettings>(DEFAULT_RECORDINGS_SETTINGS);
  const [bytes, setBytes] = React.useState<number>(0);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void getRecordingsSettings().then((next) => {
      setSettings(next);
      setBytes(recordingsTotalBytes());
    });
  }, []);
  React.useEffect(() => {
    reload();
  }, [reload]);

  const update = React.useCallback((patch: Partial<Omit<RecordingsSettings, 'v'>>) => {
    void setRecordingsSettings(patch).then((next) => {
      setSettings(next);
      track('scenario_pref_changed', {
        key: Object.keys(patch)[0] ?? 'recordings',
        value: Object.values(patch)[0] ?? 0,
      });
    });
  }, []);

  const pruneNow = React.useCallback(() => {
    if (busy) return;
    setBusy(true);
    void pruneRecordings('manual')
      .then((r) => {
        setNote(
          r.runs > 0
            ? `Pruned ${r.runs} run${r.runs === 1 ? '' : 's'} · ${formatKb(r.bytes)} freed`
            : 'Nothing to prune',
        );
        reload();
      })
      .finally(() => setBusy(false));
  }, [busy, reload]);

  const confirmDeleteAll = React.useCallback(() => {
    Alert.alert(
      'Delete all recordings?',
      `Frees ${formatKb(bytes)}. Your debriefs keep every word and score — only the audio goes. Runs already backed up can be downloaded again from the debrief.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void deleteAllRecordings()
              .then((r) => {
                setNote(`Deleted ${r.runs} run${r.runs === 1 ? '' : 's'} · ${formatKb(r.bytes)}`);
                reload();
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [bytes, reload]);

  return (
    <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
      <View className="flex-row items-center justify-between px-4 py-3.5">
        <View className="flex-1 gap-0.5 pr-3">
          <Text className="font-ui-medium">Recordings</Text>
          <Text variant="caption">
            Every scenario attempt you speak is kept as audio for the debrief · {formatKb(bytes)} on
            device
          </Text>
        </View>
        <Pressable
          onPress={confirmDeleteAll}
          hitSlop={8}
          disabled={busy || bytes === 0}
          accessibilityRole="button"
          accessibilityLabel="Delete all recordings"
        >
          <Ionicons
            name="trash-outline"
            size={18}
            color={bytes === 0 ? tokens.border : tokens.textMuted}
          />
        </Pressable>
      </View>

      <View className="border-t border-border px-4 py-3.5">
        <Text className="font-ui-medium">Keep for</Text>
        <Text variant="caption" className="mt-0.5">
          Audio older than this is removed (pinned runs never are). Words and scores stay.
        </Text>
        <View className="mt-3 flex-row gap-2">
          {PRUNE_DAY_OPTIONS.map((d) => (
            <Chip
              key={d}
              label={`${d} days`}
              selected={settings.pruneDays === d}
              onPress={() => update({ pruneDays: d })}
              accessibilityLabel={`Keep recordings for ${d} days`}
            />
          ))}
        </View>
      </View>

      <View className="border-t border-border px-4 py-3.5">
        <Text className="font-ui-medium">Storage cap</Text>
        <Text variant="caption" className="mt-0.5">
          Beyond this, the oldest unpinned runs lose their audio first.
        </Text>
        <View className="mt-3 flex-row gap-2">
          {CAP_BYTE_OPTIONS.map((c) => (
            <Chip
              key={c}
              label={formatBytes(c)}
              selected={settings.capBytes === c}
              onPress={() => update({ capBytes: c })}
              accessibilityLabel={`Recordings cap ${formatBytes(c)}`}
            />
          ))}
        </View>
      </View>

      <View className="flex-row items-center justify-between border-t border-border px-4 py-3">
        <Text variant="caption" className="flex-1 pr-3">
          {note ??
            (settings.lastPruneAt
              ? `Last checked ${new Date(settings.lastPruneAt).toLocaleString()}`
              : 'Checked at every start and after every run')}
        </Text>
        <Pressable
          onPress={pruneNow}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Prune recordings now"
          className="rounded-full bg-surface-2 px-3 py-1.5 active:bg-border"
        >
          <Text variant="caption" className="text-accent">
            {busy ? '…' : 'Prune now'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatKb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return formatBytes(bytes);
}

function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      className={`flex-1 items-center rounded-lg border px-2 py-2 ${
        selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2'
      }`}
    >
      <Text className={`font-ui-medium text-sm ${selected ? 'text-accent' : ''}`}>{label}</Text>
    </Pressable>
  );
}
