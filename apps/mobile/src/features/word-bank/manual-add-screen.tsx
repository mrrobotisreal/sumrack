import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { track } from '@/services/analytics';
import { logError } from '@/services/error-log';

import { Field } from './edit-item-sheet';
import { LevelPicker, type CefrLevelOrNull } from './level-picker';

/**
 * Manual add (design §7.2): for words learned from Alina IRL — a bank item
 * with no source sentence/story. The encounter it creates carries no source
 * either; detail renders that as "Added manually".
 */
export function ManualAddScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [kind, setKind] = React.useState<'word' | 'phrase'>('word');
  const [lemma, setLemma] = React.useState('');
  const [surface, setSurface] = React.useState('');
  const [translation, setTranslation] = React.useState('');
  const [pos, setPos] = React.useState('');
  const [grammar, setGrammar] = React.useState('');
  const [level, setLevel] = React.useState<CefrLevelOrNull>(null);
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const save = React.useCallback(() => {
    if (saving) return;
    const ruText = kind === 'word' ? lemma.trim() : surface.trim();
    if (!ruText) {
      setError(kind === 'word' ? 'The word (lemma) is required.' : 'The phrase is required.');
      return;
    }
    if (!translation.trim()) {
      setError('A translation is required — you can refine it later.');
      return;
    }
    setSaving(true);
    const common = {
      translation: translation.trim(),
      note: note.trim() || undefined,
    };
    const write =
      kind === 'word'
        ? repos.bank.addWord({
            ...common,
            lemma: lemma.trim(),
            surface: surface.trim() || lemma.trim(),
            pos: pos.trim() || undefined,
            grammar: grammar.trim() || undefined,
            level: level ?? undefined,
          })
        : repos.bank.addPhrase({ ...common, surface: surface.trim() });
    void write
      .then((result) => {
        track('bank_manual_added', { kind, created: result.created });
        void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
        void queryClient.invalidateQueries({ queryKey: ['bank-count'] });
        void queryClient.invalidateQueries({ queryKey: ['bank-word-status'] });
        void queryClient.invalidateQueries({ queryKey: ['due-count'] });
        router.back();
      })
      .catch((err) => {
        logError('manual', err);
        setSaving(false);
        setError("Couldn't save — something went wrong writing to the database.");
      });
  }, [saving, kind, lemma, surface, translation, pos, grammar, level, note, queryClient, router]);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-16 pt-4"
      keyboardShouldPersistTaps="handled"
    >
      {/* kind toggle */}
      <View className="mb-4 flex-row overflow-hidden rounded-xl border border-border">
        {(['word', 'phrase'] as const).map((k, i) => (
          <Pressable
            key={k}
            onPress={() => {
              setKind(k);
              setError(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k }}
            className={`flex-1 items-center py-2.5 ${
              kind === k ? 'bg-accent-soft' : 'bg-surface active:bg-surface-2'
            } ${i > 0 ? 'border-l border-border' : ''}`}
          >
            <Text
              className={`text-sm ${kind === k ? 'font-ui-medium text-accent' : 'text-text-muted'}`}
            >
              {k === 'word' ? 'Word' : 'Phrase'}
            </Text>
          </Pressable>
        ))}
      </View>

      {kind === 'word' ? (
        <>
          <Field
            label="Word (dictionary form)"
            value={lemma}
            onChange={setLemma}
            placeholder="слово"
            autoFocus
          />
          <Field
            label="As heard (optional)"
            value={surface}
            onChange={setSurface}
            placeholder="словами — the form you actually met"
          />
        </>
      ) : (
        <Field
          label="Phrase"
          value={surface}
          onChange={setSurface}
          placeholder="как дела"
          autoFocus
        />
      )}

      <Field
        label="Translation"
        value={translation}
        onChange={setTranslation}
        placeholder="English meaning"
      />

      {kind === 'word' && (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Part of speech" value={pos} onChange={setPos} placeholder="noun…" />
          </View>
          <View className="flex-1">
            <Field label="Grammar" value={grammar} onChange={setGrammar} placeholder="f.sg.…" />
          </View>
        </View>
      )}

      <Text variant="caption" className="mb-1 uppercase tracking-wider">
        Level (optional)
      </Text>
      <LevelPicker value={level} onChange={setLevel} />

      <Field label="Note" value={note} onChange={setNote} placeholder="Where it came up, tone…" />

      {error && (
        <Text variant="caption" className="mb-2 text-danger">
          {error}
        </Text>
      )}

      <Pressable
        onPress={save}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Save to word bank"
        className="mt-2 items-center rounded-xl bg-accent py-3 active:opacity-80"
      >
        <Text className="font-ui-medium text-bg">Save to word bank</Text>
      </Pressable>

      <Text variant="caption" className="mt-3 text-center">
        Adding an existing word records a new encounter instead of a duplicate.
      </Text>
    </ScrollView>
  );
}
