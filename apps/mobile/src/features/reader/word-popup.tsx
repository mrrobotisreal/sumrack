import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Modal, Pressable, Text as RNText, Vibration, View } from 'react-native';

import { LevelChip, type CefrLevel } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { queryKeys } from '@/db/hooks';
import { normalizeRu } from '@/db/normalize';
import type { AddResult } from '@/db/repositories/bank';
import type { TokenRow } from '@/db/repositories/content';
import type { ClassificationEventProps } from '@/features/library/categories';
import { track } from '@/services/analytics';
import { getSpeechService, speak } from '@/services/speech';
import { useLookupPrefs } from '@/store/lookup-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import type { WordSegmentPlayer } from './use-narration';

export interface WordPopupTarget {
  token: TokenRow;
  /** Source refs for the encounter/bank writes. */
  sentenceId: string;
  storyId: string;
  /**
   * M14 (T46): the reader's per-mount `category`/`genre` props, spread onto
   * `encounter_recorded` / `word_added_to_bank`. Optional — the dialogue
   * player's popup (T27) has no pack row at hand and fires them bare.
   */
  eventProps?: ClassificationEventProps;
}

interface WordPopupProps {
  target: WordPopupTarget | null;
  onClose: () => void;
  /**
   * T10: narration word-segment playback for the speaker button. When the
   * tapped word has a stamp on the loaded track, the button plays exactly
   * that slice; otherwise it falls back to the speech service (a no-op with
   * a disabled look until T11 registers Piper).
   */
  segments?: WordSegmentPlayer | null;
}

/**
 * Tap-word popup (design §7.1): bottom-anchored sheet (thumb-reachable,
 * UI_DESIGN §4 — never a tooltip at the tap point) showing the token's
 * annotations with speaker + add-to-bank. Lemma dedup is visible here: a
 * banked lemma renders "In bank ✓" instead of a second add.
 *
 * The sheet remounts per target (key below), so per-word state starts
 * fresh without reset effects.
 */
export function WordPopup({ target, onClose, segments }: WordPopupProps) {
  if (!target) return null;
  return (
    <WordPopupSheet
      key={`${target.sentenceId}:${target.token.tokenIndex}`}
      target={target}
      onClose={onClose}
      segments={segments ?? null}
    />
  );
}

function WordPopupSheet({
  target,
  onClose,
  segments,
}: {
  target: WordPopupTarget;
  onClose: () => void;
  segments: WordSegmentPlayer | null;
}) {
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const encounterOnLookup = useLookupPrefs((s) => s.encounterOnLookup);

  const { token } = target;
  // A token with no lemma (names) still banks — under its surface form.
  const effectiveLemma = token.lemma ?? token.text;

  const bankStatus = useQuery({
    queryKey: queryKeys.bankWordStatus(normalizeRu(effectiveLemma)),
    queryFn: () => repos.bank.findWordByLemma(effectiveLemma),
  });

  const invalidateBank = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-count'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-word-status'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-item'] });
    // Adds create FSRS cards (due immediately) — Today's count must follow.
    void queryClient.invalidateQueries({ queryKey: ['due-count'] });
  }, [queryClient]);

  // Encounter-on-lookup (configurable, §7.1): once per popup open, an
  // already-banked lemma gets an encounter recorded automatically.
  const encounterLoggedRef = React.useRef(false);
  React.useEffect(() => {
    if (!bankStatus.data || !encounterOnLookup || encounterLoggedRef.current) return;
    encounterLoggedRef.current = true;
    void repos.bank
      .addEncounter(bankStatus.data.id, token.text, { sentenceId: target.sentenceId })
      .then(() => {
        track('encounter_recorded', {
          via: 'tap-lookup',
          lemma: effectiveLemma,
          ...target.eventProps,
        });
        invalidateBank();
      });
  }, [
    bankStatus.data,
    encounterOnLookup,
    token.text,
    target.sentenceId,
    target.eventProps,
    effectiveLemma,
    invalidateBank,
  ]);

  const [justAdded, setJustAdded] = React.useState(false);

  /**
   * Add the word to the bank and resolve with the repository's `AddResult`
   * (T53 — was fire-and-forget). The Add button still ignores the promise
   * and keeps its optimistic «In bank ✓»; only the «Формы» path awaits it
   * to learn the new item's id.
   */
  const addToBank = React.useCallback((): Promise<AddResult> => {
    Vibration.vibrate(8);
    // The add itself records this lookup's encounter — the refetched bank
    // status must not trigger a second one for the same popup open.
    encounterLoggedRef.current = true;
    return repos.bank
      .addWord({
        lemma: effectiveLemma,
        surface: token.text,
        translation: token.translation ?? '',
        grammar: token.grammar ?? undefined,
        pos: token.pos ?? undefined,
        level: (token.level as CefrLevel | null) ?? undefined,
        sentenceId: target.sentenceId,
        sourceStoryId: target.storyId,
        note: token.note ?? undefined,
        needsEnrichment: !token.translation,
      })
      .then((result) => {
        track('word_added_to_bank', {
          lemma: effectiveLemma,
          created: result.created,
          level: token.level ?? '',
          ...target.eventProps,
        });
        setJustAdded(true);
        invalidateBank();
        return result;
      });
  }, [token, target, effectiveLemma, invalidateBank]);

  const inBank = !!bankStatus.data || justAdded;

  // «Формы» (M16/T53, WORD_FORMS §7.4): deep-link into the item's Forms tab,
  // banking the word first when it is not in the bank yet. Close the popup
  // first so the reader is not left with a stale sheet under the pushed screen.
  const [formsBusy, setFormsBusy] = React.useState(false);
  const openForms = React.useCallback(() => {
    if (formsBusy) return;
    const banked = bankStatus.data;
    if (banked) {
      track('popup_forms_opened', { banked: true });
      onClose();
      router.push({ pathname: '/word-bank/[id]', params: { id: banked.id, tab: 'forms' } });
      return;
    }
    setFormsBusy(true);
    void addToBank()
      .then((result) => {
        track('popup_forms_opened', { banked: false });
        onClose();
        router.push({ pathname: '/word-bank/[id]', params: { id: result.item.id, tab: 'forms' } });
      })
      .finally(() => setFormsBusy(false));
  }, [formsBusy, bankStatus.data, addToBank, onClose, router]);
  const showLemma = token.lemma && normalizeRu(token.lemma) !== normalizeRu(token.text);

  // Speaker: prefer the exact narration slice of THIS surface form (T10);
  // else the speech service (Piper once T11 lands). Neither → disabled look.
  const hasSegment = segments?.hasSegment(target.sentenceId, token.tokenIndex) ?? false;
  const canSpeak = hasSegment || getSpeechService().available;
  const handleSpeak = React.useCallback(() => {
    if (hasSegment) {
      segments!.playSegment(target.sentenceId, token.tokenIndex);
    } else {
      void speak(token.lemma ?? token.text);
    }
  }, [hasSegment, segments, target.sentenceId, token]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4">
        {/* headword row */}
        <View className="flex-row items-center gap-3">
          <View className="flex-1 flex-row flex-wrap items-baseline gap-x-2">
            <RNText className="font-reading text-2xl text-text">{token.text}</RNText>
            {showLemma && (
              <RNText className="font-reading-italic text-lg text-text-muted">{token.lemma}</RNText>
            )}
          </View>
          {token.level && <LevelChip level={token.level} />}
          <Pressable
            onPress={canSpeak ? handleSpeak : undefined}
            disabled={!canSpeak}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={canSpeak ? 'Pronounce word' : 'No audio available for this word'}
            accessibilityState={{ disabled: !canSpeak }}
            className={
              canSpeak
                ? 'h-11 w-11 items-center justify-center rounded-full bg-surface-2 active:bg-border'
                : 'h-11 w-11 items-center justify-center rounded-full bg-surface-2 opacity-40'
            }
          >
            <Ionicons
              name={canSpeak ? 'volume-medium' : 'volume-mute-outline'}
              size={22}
              color={canSpeak ? theme.accent : theme.textMuted}
            />
          </Pressable>
        </View>

        {/* translation + grammar */}
        <View className="mt-2 gap-1">
          <Text className="text-lg">{token.translation ?? 'No gloss — add and enrich later'}</Text>
          {(token.pos || token.grammar) && (
            <Text variant="caption">{[token.pos, token.grammar].filter(Boolean).join(' · ')}</Text>
          )}
          {token.note && (
            <View className="mt-1 rounded-lg bg-surface-2 px-3 py-2">
              <Text variant="caption" className="font-reading-italic">
                {token.note}
              </Text>
            </View>
          )}
        </View>

        {/* footer: add / in-bank + «Формы» (T53) */}
        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={inBank ? undefined : () => void addToBank()}
            disabled={inBank}
            accessibilityRole="button"
            accessibilityLabel={inBank ? 'Already in word bank' : 'Add to word bank'}
            className={
              inBank
                ? 'flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 py-3'
                : 'flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3 active:opacity-80'
            }
          >
            <Ionicons
              name={inBank ? 'checkmark-circle' : 'bookmark-outline'}
              size={18}
              color={inBank ? theme.success : theme.bg}
            />
            <Text className={inBank ? 'font-ui-medium text-text-muted' : 'font-ui-medium text-bg'}>
              {inBank ? 'In bank ✓' : 'Add to word bank'}
            </Text>
          </Pressable>
          {/* Russian label on purpose — the popup sits on the Russian reading surface */}
          <Pressable
            onPress={openForms}
            disabled={formsBusy}
            accessibilityRole="button"
            accessibilityLabel="Word forms"
            accessibilityState={{ disabled: formsBusy }}
            className="flex-row items-center justify-center gap-2 rounded-xl border border-accent/40 px-4 py-3 active:bg-surface-2"
          >
            <Ionicons name="git-branch-outline" size={18} color={theme.accent} />
            <Text className="font-ui-medium text-accent">Формы</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
