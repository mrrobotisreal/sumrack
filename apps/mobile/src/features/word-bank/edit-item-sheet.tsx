import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import type { BankItemRow } from '@/db/repositories/bank';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { LevelPicker, type CefrLevelOrNull } from './level-picker';

interface EditItemSheetProps {
  open: boolean;
  item: BankItemRow;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Edit sheet for a bank item (design §7.2 "edit/delete"). Words expose the
 * full annotation set; phrases just translation + note (their identity is
 * the normalized text, which editing would break — recollect instead).
 * The form mounts fresh each time the sheet opens, so fields always start
 * from the item's current values.
 */
export function EditItemSheet({ open, item, onClose, onSaved }: EditItemSheetProps) {
  if (!open) return null;
  return <EditForm item={item} onClose={onClose} onSaved={onSaved} />;
}

function EditForm({ item, onClose, onSaved }: Omit<EditItemSheetProps, 'open'>) {
  const { tokens: theme } = useAppTheme();

  const [lemma, setLemma] = React.useState(item.lemma ?? '');
  const [translation, setTranslation] = React.useState(item.translation);
  const [pos, setPos] = React.useState(item.pos ?? '');
  const [grammar, setGrammar] = React.useState(item.grammar ?? '');
  const [level, setLevel] = React.useState<CefrLevelOrNull>(item.level);
  const [note, setNote] = React.useState(item.note ?? '');
  const [error, setError] = React.useState<string | null>(null);

  const save = React.useCallback(() => {
    if (item.kind === 'word' && !lemma.trim()) {
      setError('A word needs its lemma (dictionary form).');
      return;
    }
    void repos.bank
      .updateItem(item.id, {
        ...(item.kind === 'word' ? { lemma: lemma.trim() } : {}),
        translation: translation.trim(),
        pos: pos.trim() || null,
        grammar: grammar.trim() || null,
        level,
        note: note.trim() || null,
        // A filled-in translation resolves the enrichment flag.
        needsEnrichment: item.needsEnrichment && translation.trim() ? false : item.needsEnrichment,
      })
      .then(() => {
        track('bank_item_edited', { id: item.id, kind: item.kind });
        onSaved();
        onClose();
      });
  }, [item, lemma, translation, pos, grammar, level, note, onSaved, onClose]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Cancel" />

      <View className="max-h-[85%] rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-ui-medium text-lg">Edit {item.kind}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Cancel edit">
            <Ionicons name="close" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled">
          {item.kind === 'word' ? (
            <Field label="Lemma" value={lemma} onChange={setLemma} placeholder="Dictionary form" />
          ) : (
            <View className="mb-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <Text className="font-reading text-base">{item.surface}</Text>
              <Text variant="caption" className="mt-0.5">
                Phrase text is fixed — it identifies this card.
              </Text>
            </View>
          )}
          <Field
            label="Translation"
            value={translation}
            onChange={setTranslation}
            placeholder="English meaning"
          />
          {item.kind === 'word' && (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Part of speech" value={pos} onChange={setPos} placeholder="noun…" />
              </View>
              <View className="flex-1">
                <Field
                  label="Grammar"
                  value={grammar}
                  onChange={setGrammar}
                  placeholder="f.sg. prep.…"
                />
              </View>
            </View>
          )}
          <Text variant="caption" className="mb-1 mt-1 uppercase tracking-wider">
            Level
          </Text>
          <LevelPicker value={level} onChange={setLevel} />
          <Field
            label="Note"
            value={note}
            onChange={setNote}
            placeholder="Anything worth remembering"
          />

          {error && (
            <Text variant="caption" className="mt-2 text-danger">
              {error}
            </Text>
          )}

          <Pressable
            onPress={save}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
            className="mt-4 items-center rounded-xl bg-accent py-3 active:opacity-80"
          >
            <Text className="font-ui-medium text-bg">Save</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { tokens: theme } = useAppTheme();
  return (
    <View className="mb-3">
      <Text variant="caption" className="mb-1 uppercase tracking-wider">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        autoFocus={autoFocus}
        autoCorrect={false}
        className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
        accessibilityLabel={label}
      />
    </View>
  );
}
