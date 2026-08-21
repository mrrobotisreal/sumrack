import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Modal, Pressable, Text as RNText, TextInput, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { glossTranslation, phraseSurface, wordTokensInRange } from './token-chunks';

import type { PhraseSelection } from './token-text';

export interface PhraseCardTarget {
  selection: PhraseSelection;
  /** Sentence context shown on the card + source refs for the save. */
  sentenceRu: string;
  sentenceId: string;
  storyId: string;
}

interface PhraseCardSheetProps {
  target: PhraseCardTarget | null;
  onClose: () => void;
}

/**
 * Phrase card editor (design §7.1): after a drag selection, the phrase with
 * its sentence context and a gloss-assembled translation — editable before
 * save, which is what makes naive gloss concatenation acceptable (ticket
 * technical note; don't over-engineer translation quality here).
 */
export function PhraseCardSheet({ target, onClose }: PhraseCardSheetProps) {
  if (!target) return null;
  // Remount per selection so the editable fields start fresh.
  const key = `${target.sentenceId}:${target.selection.range.start}-${target.selection.range.end}`;
  return <PhraseSheet key={key} target={target} onClose={onClose} />;
}

function PhraseSheet({ target, onClose }: { target: PhraseCardTarget; onClose: () => void }) {
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();

  const surface = React.useMemo(
    () => phraseSurface(target.selection.chunks, target.selection.range),
    [target],
  );
  const defaultTranslation = React.useMemo(
    () => glossTranslation(target.selection.chunks, target.selection.range),
    [target],
  );

  const [translation, setTranslation] = React.useState(defaultTranslation);
  const [note, setNote] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const save = React.useCallback(() => {
    if (saving) return;
    setSaving(true);
    Vibration.vibrate(8);
    const wordCount = wordTokensInRange(target.selection.chunks, target.selection.range).length;
    void repos.bank
      .addPhrase({
        surface,
        translation: translation.trim(),
        sentenceId: target.sentenceId,
        sourceStoryId: target.storyId,
        note: note.trim() || undefined,
        needsEnrichment: translation.trim().length === 0,
      })
      .then((result) => {
        track('phrase_added_to_bank', { words: wordCount, created: result.created });
        void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
        void queryClient.invalidateQueries({ queryKey: ['bank-count'] });
        void queryClient.invalidateQueries({ queryKey: ['due-count'] });
        onClose();
      });
  }, [target, saving, surface, translation, note, queryClient, onClose]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Cancel" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">New phrase</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cancel phrase">
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        {/* the phrase */}
        <RNText className="font-reading text-xl text-text">{surface}</RNText>

        {/* sentence context */}
        <View className="mt-2 border-l-2 border-accent/40 pl-3">
          <Text variant="caption" className="font-reading-italic">
            {target.sentenceRu}
          </Text>
        </View>

        {/* editable translation */}
        <Text variant="caption" className="mb-1 mt-4 uppercase tracking-wider">
          Translation
        </Text>
        <TextInput
          value={translation}
          onChangeText={setTranslation}
          multiline
          placeholder="What does it mean?"
          placeholderTextColor={theme.textMuted}
          className="min-h-[44px] rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="Phrase translation"
        />

        {/* optional note */}
        <Text variant="caption" className="mb-1 mt-3 uppercase tracking-wider">
          Note (optional)
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Idiom, tone, when to use it…"
          placeholderTextColor={theme.textMuted}
          className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="Phrase note"
        />

        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save phrase to word bank"
          className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-80"
        >
          <Ionicons name="bookmark-outline" size={18} color={theme.bg} />
          <Text className="font-ui-medium text-bg">Save to word bank</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
