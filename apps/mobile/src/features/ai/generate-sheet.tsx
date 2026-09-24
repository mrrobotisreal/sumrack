import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { isOnline } from './connectivity';
import {
  estimateRun,
  formatEstimate,
  getGrammarPreset,
  getModelTable,
  DEFAULT_GRAMMAR_PRESET,
  DEFAULT_MODEL_TABLE,
  setGrammarPreset,
  type AiRunProfile,
  type ModelTable,
  type RunEstimate,
} from './run-profile';
import { RunProfileControls } from './run-profile-controls';

export interface GenerateSheetProps {
  open: boolean;
  purpose: 'profile' | 'lesson' | 'batch';
  /** «Generate forms for «говорить»», «Learn: Non-past conjugation», «Generate forms for 37 words». */
  title: string;
  /** Batch only — the estimate multiplies by it. */
  count?: number;
  onClose: () => void;
  onGenerate: (profile: AiRunProfile, opts: { saveAsDefault: boolean }) => void;
}

function sameProfile(a: AiRunProfile, b: AiRunProfile): boolean {
  return a.provider === b.provider && a.quality === b.quality && a.effort === b.effort;
}

/**
 * The reusable Generate sheet (WORD_FORMS §4.6): pre-filled from the
 * «Grammar & word forms» preset, the shared controls, a receipt-based
 * estimate line for the selected notch, «Save as my default», and a
 * Generate button that is disabled offline with a reason. T52+ mount it
 * from the Forms tab / Learn buttons / the batch entry; T51 only ships it.
 */
export function GenerateSheet({
  open,
  purpose,
  title,
  count,
  onClose,
  onGenerate,
}: GenerateSheetProps) {
  const { tokens } = useAppTheme();
  const [preset, setPreset] = React.useState<AiRunProfile>(DEFAULT_GRAMMAR_PRESET);
  const [profile, setProfile] = React.useState<AiRunProfile>(DEFAULT_GRAMMAR_PRESET);
  const [table, setTable] = React.useState<ModelTable>(DEFAULT_MODEL_TABLE);
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);
  const [estimate, setEstimate] = React.useState<RunEstimate | null>(null);
  const [online, setOnline] = React.useState(true);

  // Re-read the preset + table + connectivity every time the sheet opens.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([getGrammarPreset(), getModelTable(), isOnline()]).then(
      ([storedPreset, storedTable, isUp]) => {
        if (cancelled) return;
        setSaveAsDefault(false);
        setPreset(storedPreset);
        setProfile(storedPreset);
        setTable(storedTable);
        setOnline(isUp);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  // The estimate follows the selected notch (batch multiplies by count).
  const estimatePurpose = purpose === 'lesson' ? 'lesson' : 'profile';
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void estimateRun(estimatePurpose, profile).then((est) => {
      if (!cancelled) setEstimate(est);
    });
    return () => {
      cancelled = true;
    };
  }, [open, estimatePurpose, profile]);

  const multiplier = purpose === 'batch' ? Math.max(1, count ?? 1) : 1;

  const generate = React.useCallback(() => {
    if (!sameProfile(profile, preset)) {
      track('ai_grammar_preset_changed', { ...profile, scope: 'run' });
    }
    if (saveAsDefault && !sameProfile(profile, preset)) {
      void setGrammarPreset(profile);
      track('ai_grammar_preset_changed', { ...profile, scope: 'default' });
    }
    onGenerate(profile, { saveAsDefault });
  }, [profile, preset, saveAsDefault, onGenerate]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-10 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="flex-1 pr-3 font-ui-medium text-lg" numberOfLines={2}>
            {title}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close generate sheet">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>

        <RunProfileControls profile={profile} table={table} onChange={setProfile} />

        <Text variant="caption" className="mt-3" accessibilityLabel="Estimate">
          {formatEstimate(estimate, multiplier)}
          {purpose === 'batch' && estimate ? ` × ${multiplier} words` : ''}
        </Text>

        <View className="mt-3 flex-row items-center justify-between">
          <Text className="text-sm">Save as my default</Text>
          <Switch
            value={saveAsDefault}
            onValueChange={setSaveAsDefault}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Save as my default"
          />
        </View>

        <Pressable
          onPress={generate}
          disabled={!online}
          accessibilityRole="button"
          accessibilityState={{ disabled: !online }}
          className={`mt-4 items-center rounded-xl px-4 py-3 ${
            online ? 'bg-accent active:opacity-80' : 'bg-surface-2'
          }`}
        >
          <Text className={`font-ui-medium ${online ? 'text-text' : 'text-text-muted'}`}>
            {online ? 'Generate' : 'Offline — connect to generate'}
          </Text>
        </Pressable>
      </View>
    </Modal>
  );
}
