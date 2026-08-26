import { Ionicons } from '@expo/vector-icons';
import type { Token } from '@sumrak/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { friendlyAiMessage } from '@/features/ai/errors';
import {
  deleteSentence,
  envelopeProgress,
  mergeWithNext,
  parseEnvelope,
  sentenceWords,
  splitAfterWord,
  type EnvelopeSentence,
} from '@/features/ai/import-annotate-core';
import { rerunSentences, saveEnvelopeEdit } from '@/features/ai/import-annotate';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { useImportRequest } from './hooks';
import { commitAnnotatedRequest, removeImportRequest } from './import-service';

/**
 * T29 review screen (design V2 §4.2, the enrichment review-before-apply
 * pattern): every annotated sentence is inspectable — RU + proposed EN,
 * token table, low-confidence flags — with boundary merge/split,
 * per-sentence re-run, and delete. NOTHING persists to content tables
 * before Commit; every edit here lives on the request row's annotation
 * envelope only. Commit excludes flagged/pending sentences after explicit
 * confirmation (recorded T29 decision).
 */
export function ImportReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = id ?? '';
  const { tokens } = useAppTheme();
  const router = useRouter();
  const request = useImportRequest(requestId);

  const env = React.useMemo(
    () => (request.data ? parseEnvelope(request.data.annotationJson) : null),
    [request.data],
  );

  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [expandedUid, setExpandedUid] = React.useState<string | null>(null);
  const [splitUid, setSplitUid] = React.useState<string | null>(null);
  const [busyUid, setBusyUid] = React.useState<string | null>(null);
  const [committing, setCommitting] = React.useState(false);

  const openedRef = React.useRef(false);
  React.useEffect(() => {
    if (env && !openedRef.current) {
      openedRef.current = true;
      const { total, flagged } = envelopeProgress(env);
      track('import_review_opened', { sentences: total, flagged });
    }
  }, [env]);

  const rerun = React.useCallback(
    (uid: string) => {
      setBusyUid(uid);
      void (async () => {
        try {
          await rerunSentences(requestId, [uid]);
        } catch (err) {
          Alert.alert('Не получилось', friendlyAiMessage(err));
        } finally {
          setBusyUid(null);
        }
      })();
    },
    [requestId],
  );

  const merge = React.useCallback(
    (uid: string) => {
      track('import_review_merged', {});
      setSplitUid(null);
      void saveEnvelopeEdit(requestId, (e) => mergeWithNext(e, uid));
    },
    [requestId],
  );

  const split = React.useCallback(
    (uid: string, wordIdx: number) => {
      track('import_review_split', {});
      setSplitUid(null);
      void saveEnvelopeEdit(requestId, (e) => splitAfterWord(e, uid, wordIdx));
    },
    [requestId],
  );

  const remove = React.useCallback(
    (uid: string) => {
      Alert.alert('Удалить предложение?', 'It will not be part of the imported story.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            track('import_review_sentence_deleted', {});
            setExpandedUid(null);
            void saveEnvelopeEdit(requestId, (e) => deleteSentence(e, uid));
          },
        },
      ]);
    },
    [requestId],
  );

  const doCommit = React.useCallback(async () => {
    setCommitting(true);
    try {
      const { packId, included, excluded } = await commitAnnotatedRequest(requestId);
      Alert.alert(
        'Импортировано',
        `${included} sentences committed${excluded > 0 ? `, ${excluded} excluded` : ''}.`,
        [
          { text: 'OK', onPress: () => router.back() },
          {
            text: 'Читать',
            onPress: () => router.replace(`/reader/${packId}/s1`),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Не получилось', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCommitting(false);
    }
  }, [requestId, router]);

  const onCommit = React.useCallback(() => {
    if (!env) return;
    const notOk = env.sentences.filter((s) => s.status !== 'ok').length;
    if (notOk > 0) {
      Alert.alert(
        'Исключить непроверенные?',
        `${notOk} flagged or un-annotated sentence${notOk === 1 ? '' : 's'} will be EXCLUDED from the story. Re-run or delete them first if you want them included.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Commit without them', style: 'destructive', onPress: () => void doCommit() },
        ],
      );
    } else {
      void doCommit();
    }
  }, [env, doCommit]);

  const onDiscard = React.useCallback(() => {
    Alert.alert('Удалить запрос?', 'The request and its annotation will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void removeImportRequest(requestId).then(() => router.back());
        },
      },
    ]);
  }, [requestId, router]);

  if (request.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }
  if (!request.data || !env) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-bg px-8">
        <Ionicons name="alert-circle-outline" size={28} color={tokens.textMuted} />
        <Text variant="muted" className="text-center">
          {request.data
            ? 'This request has no annotation yet — it runs automatically when online.'
            : 'Import request not found.'}
        </Text>
      </View>
    );
  }

  const { total, flagged } = envelopeProgress(env);
  const okCount = env.sentences.filter((s) => s.status === 'ok').length;
  const committed = request.data.status === 'committed';
  const visible = flaggedOnly
    ? env.sentences.filter((s) => s.status !== 'ok' || (s.flagged?.length ?? 0) > 0)
    : env.sentences;

  return (
    <View className="flex-1 bg-bg">
      <ScrollView className="flex-1" contentContainerClassName="px-4 pb-32 pt-4">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 font-ui-medium" numberOfLines={2}>
            {request.data.title}
          </Text>
          {env.level && <LevelChip level={env.level} />}
        </View>
        <Text variant="caption" className="mt-1">
          {okCount}/{total} verified{flagged > 0 ? ` · ${flagged} flagged` : ''}
          {request.data.sourceLabel ? ` · ${request.data.sourceLabel}` : ''}
        </Text>

        {flagged > 0 && (
          <Pressable
            onPress={() => setFlaggedOnly((v) => !v)}
            accessibilityRole="button"
            className={`mt-3 self-start rounded-full border px-3 py-1.5 ${
              flaggedOnly ? 'border-accent bg-accent-soft' : 'border-border bg-surface'
            }`}
          >
            <Text variant="caption" className={flaggedOnly ? 'text-accent' : ''}>
              Только с флагом
            </Text>
          </Pressable>
        )}

        <View className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
          {visible.map((sentence, i) => (
            <SentenceRow
              key={sentence.uid}
              sentence={sentence}
              first={i === 0}
              isLast={env.sentences[env.sentences.length - 1]?.uid === sentence.uid}
              expanded={expandedUid === sentence.uid}
              splitting={splitUid === sentence.uid}
              busy={busyUid === sentence.uid}
              readOnly={committed}
              onToggle={() => setExpandedUid((cur) => (cur === sentence.uid ? null : sentence.uid))}
              onRerun={() => rerun(sentence.uid)}
              onMerge={() => merge(sentence.uid)}
              onSplitStart={() =>
                setSplitUid((cur) => (cur === sentence.uid ? null : sentence.uid))
              }
              onSplitAt={(wordIdx) => split(sentence.uid, wordIdx)}
              onDelete={() => remove(sentence.uid)}
            />
          ))}
          {visible.length === 0 && (
            <View className="items-center px-6 py-8">
              <Text variant="muted">Нет предложений с флагом.</Text>
            </View>
          )}
        </View>

        {!committed && (
          <Pressable onPress={onDiscard} accessibilityRole="button" className="mt-6 items-center">
            <Text variant="caption" className="text-danger">
              Удалить запрос
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {!committed && (
        <View className="absolute inset-x-0 bottom-0 border-t border-border bg-surface px-4 pb-8 pt-3">
          <Pressable
            onPress={onCommit}
            disabled={committing || okCount === 0}
            accessibilityRole="button"
            className={`flex-row items-center justify-center gap-2 rounded-xl px-4 py-3 ${
              committing || okCount === 0 ? 'bg-surface-2' : 'bg-accent active:opacity-80'
            }`}
          >
            {committing ? (
              <ActivityIndicator size="small" color={tokens.text} />
            ) : (
              <Ionicons name="checkmark-outline" size={18} color={tokens.text} />
            )}
            <Text className="font-ui-medium">
              {okCount === 0 ? 'Нечего импортировать' : `Импортировать ${okCount} предл.`}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function SentenceRow(props: {
  sentence: EnvelopeSentence;
  first: boolean;
  isLast: boolean;
  expanded: boolean;
  splitting: boolean;
  busy: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onRerun: () => void;
  onMerge: () => void;
  onSplitStart: () => void;
  onSplitAt: (wordIdx: number) => void;
  onDelete: () => void;
}) {
  const { sentence: s, first, isLast, expanded, splitting, busy, readOnly } = props;
  const { tokens } = useAppTheme();
  const lowConfidence = (s.flagged?.length ?? 0) > 0;
  const words = sentenceWords(s.ru);

  return (
    <View className={first ? '' : 'border-t border-border'}>
      <Pressable
        onPress={props.onToggle}
        accessibilityRole="button"
        className="gap-1 px-4 py-3 active:opacity-80"
      >
        <View className="flex-row items-start gap-2">
          <Text variant="reading" className="flex-1 text-base">
            {s.ru}
          </Text>
          {s.status === 'needs-review' && (
            <Ionicons name="warning-outline" size={16} color={tokens.danger} />
          )}
          {s.status === 'pending' && (
            <Ionicons name="ellipse-outline" size={14} color={tokens.textMuted} />
          )}
          {s.status === 'ok' && lowConfidence && (
            <Ionicons name="flag-outline" size={14} color={tokens.accent} />
          )}
        </View>
        {s.en ? (
          <Text variant="caption" numberOfLines={expanded ? undefined : 2}>
            {s.en}
          </Text>
        ) : null}
        <Text variant="caption" className="text-xs">
          {s.status === 'ok'
            ? `${s.tokens?.length ?? 0} tokens${lowConfidence ? ` · ${s.flagged!.length} flagged` : ''}`
            : s.status === 'pending'
              ? 'Не аннотировано — re-run to annotate'
              : 'Проверьте вручную — annotation failed'}
        </Text>
      </Pressable>

      {expanded && (
        <View className="gap-2 border-t border-border bg-surface-2 px-4 py-3">
          {s.status === 'needs-review' && s.error ? (
            <Text variant="caption" className="text-danger">
              {s.error}
            </Text>
          ) : null}

          {s.tokens && <TokenTable tokens={s.tokens} flagged={s.flagged ?? []} />}

          {splitting ? (
            <View className="gap-2">
              <Text variant="caption">Разделить после слова:</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {words.slice(0, -1).map((w, wi) => (
                  <Pressable
                    key={`${wi}-${w}`}
                    onPress={() => props.onSplitAt(wi)}
                    accessibilityRole="button"
                    className="rounded-lg border border-border bg-surface px-2 py-1 active:opacity-70"
                  >
                    <Text variant="caption">{w} ∣</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {!readOnly && (
            <View className="flex-row flex-wrap gap-2 pt-1">
              <RowAction
                icon="refresh-outline"
                label={s.status === 'pending' ? 'Annotate' : 'Re-run'}
                busy={busy}
                onPress={props.onRerun}
              />
              {!isLast && (
                <RowAction icon="git-merge-outline" label="Merge ↓" onPress={props.onMerge} />
              )}
              {words.length > 1 && (
                <RowAction
                  icon="cut-outline"
                  label={splitting ? 'Cancel split' : 'Split'}
                  onPress={props.onSplitStart}
                />
              )}
              <RowAction icon="trash-outline" label="Delete" onPress={props.onDelete} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function RowAction(props: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  busy?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.busy}
      accessibilityRole="button"
      className="flex-row items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 active:opacity-70"
    >
      {props.busy ? (
        <ActivityIndicator size={14} color={tokens.accent} />
      ) : (
        <Ionicons name={props.icon} size={14} color={tokens.textMuted} />
      )}
      <Text variant="caption">{props.label}</Text>
    </Pressable>
  );
}

/** Read-only draft-table view: text | lemma | translation (+ pos·grammar·level). */
function TokenTable({ tokens: toks, flagged }: { tokens: Token[]; flagged: number[] }) {
  const flaggedSet = React.useMemo(() => new Set(flagged), [flagged]);
  return (
    <View className="overflow-hidden rounded-lg border border-border">
      {toks.map((tok, i) => {
        const isFlagged = flaggedSet.has(i);
        const meta = [tok.pos, tok.grammar, tok.level].filter(Boolean).join(' · ');
        return (
          <View
            key={i}
            className={`flex-row items-start gap-2 px-2.5 py-1.5 ${i === 0 ? '' : 'border-t border-border/50'} ${
              isFlagged ? 'bg-accent-soft' : ''
            }`}
          >
            <Text variant="reading" className="w-28 text-sm">
              {tok.text}
            </Text>
            {tok.isPunct ? (
              <Text variant="caption" className="flex-1 text-xs">
                punctuation
              </Text>
            ) : (
              <View className="flex-1 gap-0.5">
                <Text variant="caption" className="text-text">
                  {tok.lemma} — {tok.translation}
                  {isFlagged ? ' ⚑' : ''}
                </Text>
                {meta ? (
                  <Text variant="caption" className="text-xs">
                    {meta}
                  </Text>
                ) : null}
                {tok.note ? (
                  <Text variant="caption" className="text-xs italic">
                    {tok.note}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
