import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { writeTextToBackupDir } from '@/features/backup/local-target';
import { track } from '@/services/analytics';
import { useFsrsPrefs } from '@/store/fsrs-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import { DEFAULT_W, RETENTION_DEFAULT, RETENTION_MAX, RETENTION_MIN } from './fsrs-settings';
import {
  buildReviewLogExport,
  exportResultMessage,
  formatOptimizerSubtitle,
  formatRetentionPercent,
  formatWeights,
  retentionIsDefault,
  reviewLogFileName,
} from './scheduling-core';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * Settings → «Scheduling» (T39): desired-retention dial, the FSRS optimizer
 * import/revert sheet, and the review-history export that feeds the Mac
 * optimizer (RUNBOOK §10). Retention writes on slide-complete only, so a drag
 * does not reconfigure the scheduler on every tick.
 */
export function SchedulingSettingsSection() {
  const { tokens } = useAppTheme();
  const desiredRetention = useFsrsPrefs((s) => s.desiredRetention);
  const params = useFsrsPrefs((s) => s.params);
  const setDesiredRetention = useFsrsPrefs((s) => s.setDesiredRetention);
  const [draft, setDraft] = React.useState<number | null>(null);
  const sliding = React.useRef(false);
  const [optimizerOpen, setOptimizerOpen] = React.useState(false);
  // Bumped per open so the sheet remounts with a fresh paste box.
  const [sheetKey, setSheetKey] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [exportBusy, setExportBusy] = React.useState(false);

  const shown = draft ?? desiredRetention;

  const exportHistory = React.useCallback(() => {
    if (exportBusy) return;
    setExportBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const rows = await repos.reviews.listAllReviewLog();
        if (rows.length === 0) {
          setNotice('No reviews to export yet.');
          return;
        }
        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const body = JSON.stringify(buildReviewLogExport(rows, now, timezone), null, 2);
        const name = reviewLogFileName(now);
        const written = await writeTextToBackupDir(name, body);
        track('review_log_exported', { rows: rows.length });
        setNotice(exportResultMessage(rows.length, written.name));
      } catch (err) {
        setNotice(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.');
      } finally {
        setExportBusy(false);
      }
    })();
  }, [exportBusy]);

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Scheduling
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        {/* desired retention */}
        <View className="px-4 py-3.5">
          <View className="mb-1 flex-row items-center justify-between gap-3">
            <Text className="font-ui-medium">Desired retention</Text>
            <Text className="font-ui-medium text-accent" accessibilityLiveRegion="polite">
              {formatRetentionPercent(shown)}
            </Text>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={RETENTION_MIN}
            maximumValue={RETENTION_MAX}
            step={0.01}
            value={desiredRetention}
            onSlidingStart={() => {
              sliding.current = true;
            }}
            onValueChange={(v) => {
              if (sliding.current) setDraft(v);
              // Keyboard/TalkBack adjustments do not emit touch completion.
              else setDesiredRetention(v);
            }}
            onSlidingComplete={(v) => {
              sliding.current = false;
              setDraft(null);
              setDesiredRetention(v);
            }}
            minimumTrackTintColor={tokens.accent}
            maximumTrackTintColor={tokens.textMuted}
            thumbTintColor={tokens.text}
            accessibilityLabel="Desired retention"
            accessibilityValue={{
              min: RETENTION_MIN * 100,
              max: RETENTION_MAX * 100,
              now: Math.round(shown * 100),
              text: formatRetentionPercent(shown),
            }}
          />
          <View className="flex-row justify-between">
            <Text variant="caption">80 %</Text>
            <Text variant="caption">95 %</Text>
          </View>
          <Text variant="caption" className="mt-2">
            Higher = more reviews, stronger memory. Lower = fewer reviews, more forgetting. Changes
            apply to future scheduling only — each card reschedules at its next review; nothing is
            reset.
          </Text>
          {!retentionIsDefault(desiredRetention) && (
            <Pressable
              onPress={() => setDesiredRetention(RETENTION_DEFAULT)}
              accessibilityRole="button"
              hitSlop={6}
              className="mt-2 self-start active:opacity-70"
            >
              <Text className="font-ui-medium text-sm text-accent">Default 90 %</Text>
            </Pressable>
          )}
        </View>

        {/* optimizer */}
        <Pressable
          onPress={() => {
            setSheetKey((k) => k + 1);
            setOptimizerOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Optimizer"
          className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
        >
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Optimizer</Text>
            <Text variant="caption">{formatOptimizerSubtitle(params)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
        </Pressable>

        {/* review history export */}
        <Pressable
          onPress={exportHistory}
          disabled={exportBusy}
          accessibilityRole="button"
          accessibilityLabel="Export review history"
          className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
        >
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Export review history</Text>
            <Text variant="caption">
              Writes a JSON file of every review to your backup folder, for the Mac optimizer
            </Text>
          </View>
          {exportBusy ? (
            <ActivityIndicator color={tokens.accent} />
          ) : (
            <Ionicons name="download-outline" size={20} color={tokens.textMuted} />
          )}
        </Pressable>
      </View>
      {notice !== null && (
        <Text variant="caption" className="mt-2 px-1" accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}

      <OptimizerSheet
        key={sheetKey}
        open={optimizerOpen}
        onClose={() => setOptimizerOpen(false)}
        onApplied={() => setNotice('Parameters applied. Future reviews use them.')}
        onReverted={() => setNotice('Reverted to the default parameters.')}
      />
    </>
  );
}

function OptimizerSheet({
  open,
  onClose,
  onApplied,
  onReverted,
}: {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  onReverted: () => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useFsrsPrefs((s) => s.params);
  const importParams = useFsrsPrefs((s) => s.importParams);
  const revertParams = useFsrsPrefs((s) => s.revertParams);
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [importing, setImporting] = React.useState(false);

  const apply = () => {
    const result = importParams(text);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setText('');
    setError(null);
    setImporting(false);
    onApplied();
    onClose();
  };

  const confirmRevert = () => {
    Alert.alert(
      'Revert to default parameters?',
      'Scheduling goes back to the built-in FSRS-6 weights. Future reviews reschedule with them; nothing is reset.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revert',
          style: 'destructive',
          onPress: () => {
            revertParams();
            onReverted();
            onClose();
          },
        },
      ],
    );
  };

  const activeW = params?.w ?? DEFAULT_W;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />
      <View
        className="rounded-t-2xl border-t border-border bg-surface px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 24, maxHeight: '85%' }}
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Optimizer</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          <Text variant="caption">
            Fit FSRS parameters to your own review history on the Mac — see RUNBOOK §10.
          </Text>
          <Text variant="caption" className="mt-1">
            {formatOptimizerSubtitle(params)}
          </Text>

          {!importing ? (
            <Pressable
              onPress={() => setImporting(true)}
              accessibilityRole="button"
              accessibilityLabel="Import parameters"
              className="mt-4 items-center rounded-full border border-accent/40 px-4 py-3 active:bg-surface-2"
            >
              <Text className="font-ui-medium text-accent">Import parameters</Text>
            </Pressable>
          ) : (
            <>
              <Text variant="caption" className="mb-1 mt-4 uppercase tracking-wider">
                Paste the fsrs-params JSON
              </Text>
              <TextInput
                value={text}
                onChangeText={(t) => {
                  setText(t);
                  if (error) setError(null);
                }}
                placeholder='{"v":1,"kind":"sumrak-fsrs-params", …}'
                placeholderTextColor={tokens.textMuted}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                textAlignVertical="top"
                className="min-h-[120px] rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-sm text-text"
                style={{ fontFamily: MONO }}
                accessibilityLabel="Paste the fsrs-params JSON"
              />
              {error !== null && (
                <Text className="mt-2 text-sm text-danger" accessibilityLiveRegion="polite">
                  {error}
                </Text>
              )}
              <Pressable
                onPress={apply}
                disabled={text.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel="Apply"
                className={`mt-3 items-center rounded-full px-4 py-3 ${
                  text.trim().length === 0 ? 'bg-surface-2' : 'bg-accent active:opacity-80'
                }`}
              >
                <Text
                  className={`font-ui-bold ${text.trim().length === 0 ? 'text-text-muted' : 'text-bg'}`}
                >
                  Apply
                </Text>
              </Pressable>
            </>
          )}

          <Text variant="caption" className="mb-1 mt-6 uppercase tracking-wider">
            Active weights{params === null ? ' (defaults)' : ''}
          </Text>
          <View className="rounded-xl bg-surface-2 px-3 py-2.5">
            <Text className="text-xs text-text" style={{ fontFamily: MONO }}>
              {formatWeights(activeW)}
            </Text>
          </View>

          {params !== null && (
            <Pressable
              onPress={confirmRevert}
              accessibilityRole="button"
              accessibilityLabel="Revert to defaults"
              className="mt-4 items-center rounded-full border border-danger/40 px-4 py-3 active:bg-danger/10"
            >
              <Text className="font-ui-medium text-danger">Revert to defaults</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
