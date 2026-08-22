import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Modal, Pressable, Text as RNText, TextInput, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import type { FreeSelection } from '@/components/selectable-text';

export interface BankSaveTarget {
  selection: FreeSelection;
  /** Where the highlight came from — journal entries also record the encounter ref. */
  source: 'journal' | 'note';
  journalEntryId?: string;
}

interface BankSaveSheetProps {
  target: BankSaveTarget | null;
  onClose: () => void;
}

/** ±N chunks of surrounding text shown as context under the highlight. */
const CONTEXT_CHUNKS = 6;

/**
 * Save-to-bank sheet for free-text highlights (design §7.4): journal/notes
 * text has no token annotations, so the item is stored surface-form-only and
 * always flagged `needsEnrichment` — T16's AI enrichment fills lemma /
 * grammar / POS later (a single word's "lemma" is provisionally its surface
 * so the word-dedup key still works). Translation is optional here: Mitch
 * may know it; the flag stays either way since grammar/level are unknown.
 */
export function BankSaveSheet({ target, onClose }: BankSaveSheetProps) {
  if (!target) return null;
  const key = `${target.selection.range.start}-${target.selection.range.end}-${target.selection.surface}`;
  return <SaveSheet key={key} target={target} onClose={onClose} />;
}

function SaveSheet({ target, onClose }: { target: BankSaveTarget; onClose: () => void }) {
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const { selection } = target;

  const [translation, setTranslation] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const context = React.useMemo(() => {
    const { chunks, range } = selection;
    const start = Math.max(0, range.start - CONTEXT_CHUNKS);
    const end = Math.min(chunks.length - 1, range.end + CONTEXT_CHUNKS);
    const text = chunks
      .slice(start, end + 1)
      .map((c) => c.text)
      .join(' ');
    return `${start > 0 ? '…' : ''}${text}${end < chunks.length - 1 ? '…' : ''}`;
  }, [selection]);

  const save = React.useCallback(() => {
    if (saving) return;
    setSaving(true);
    Vibration.vibrate(8);
    const isWord = selection.wordCount === 1;
    const common = {
      surface: selection.surface,
      translation: translation.trim(),
      journalEntryId: target.journalEntryId,
      needsEnrichment: true,
    };
    const add = isWord
      ? repos.bank.addWord({ ...common, lemma: selection.surface })
      : repos.bank.addPhrase(common);
    void add.then((result) => {
      track('journal_highlight_saved', {
        kind: isWord ? 'word' : 'phrase',
        source: target.source,
        created: result.created,
        hasTranslation: translation.trim().length > 0,
      });
      void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
      void queryClient.invalidateQueries({ queryKey: ['bank-count'] });
      void queryClient.invalidateQueries({ queryKey: ['due-count'] });
      onClose();
    });
  }, [saving, selection, translation, target, queryClient, onClose]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Cancel" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">
            {selection.wordCount === 1 ? 'New word' : 'New phrase'}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cancel save">
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <RNText className="font-reading text-xl text-text">{selection.surface}</RNText>

        <View className="mt-2 border-l-2 border-accent/40 pl-3">
          <Text variant="caption" className="font-reading-italic">
            {context}
          </Text>
        </View>

        {/* the §7.4 fallback path, visible: no annotations exist for free text */}
        <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
          <Text variant="caption" className="flex-1">
            Saved without dictionary info — AI enrichment fills lemma & grammar later.
          </Text>
        </View>

        <Text variant="caption" className="mb-1 mt-4 uppercase tracking-wider">
          Translation (optional)
        </Text>
        <TextInput
          value={translation}
          onChangeText={setTranslation}
          multiline
          placeholder="What does it mean?"
          placeholderTextColor={theme.textMuted}
          className="min-h-[44px] rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="Translation"
        />

        <Pressable
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save to word bank"
          className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-80"
        >
          <Ionicons name="bookmark-outline" size={18} color={theme.bg} />
          <Text className="font-ui-medium text-bg">Save to word bank</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
