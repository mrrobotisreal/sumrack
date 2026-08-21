import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text as RNText,
  View,
} from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { repos } from '@/db';
import { useBankItemDetail, type EncounterWithContext } from '@/db/hooks';
import { track } from '@/services/analytics';
import { speak } from '@/services/speech';
import { useAppTheme } from '@/theme/use-app-theme';

import { EditItemSheet } from './edit-item-sheet';

/** The four FSRS directions a bank item can train (design §5) — real state lands in T06. */
const DIRECTIONS = ['RU → EN', 'EN → RU', 'Listening', 'Production'] as const;

/**
 * Bank item detail (design §7.2): leads with encounters-in-context ("the
 * sentence is the memory hook", UI_DESIGN §4), FSRS state per direction as
 * an honest placeholder until T06, edit and delete.
 */
export function ItemDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const detail = useBankItemDetail(id);
  const [editOpen, setEditOpen] = React.useState(false);

  React.useEffect(() => {
    track('bank_item_viewed', { id });
  }, [id]);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-item'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-word-status'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-count'] });
  }, [queryClient]);

  const confirmDelete = React.useCallback(() => {
    const item = detail.data;
    if (!item) return;
    Alert.alert(
      'Delete from word bank?',
      `«${item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface}» and its encounters will be removed. Review history goes with it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void repos.bank.deleteItem(item.id).then(() => {
              track('bank_item_deleted', { id: item.id, kind: item.kind });
              invalidate();
              router.back();
            });
          },
        },
      ],
    );
  }, [detail.data, invalidate, router]);

  if (detail.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const item = detail.data;
  if (!item) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-bg px-8">
        <Text className="font-ui-medium text-lg">Not found</Text>
        <Text variant="muted" className="text-center">
          This bank item no longer exists.
        </Text>
      </View>
    );
  }

  const headword = item.kind === 'word' ? (item.lemma ?? item.surface) : item.surface;

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-4 pb-16 pt-4">
      {/* headword card */}
      <View className="rounded-xl border border-border bg-surface p-4">
        <View className="flex-row items-start gap-3">
          <View className="flex-1">
            <RNText className="font-reading text-2xl text-text">{headword}</RNText>
            {item.kind === 'word' && item.surface && item.surface !== headword && (
              <Text variant="caption" className="mt-0.5">
                first seen as «{item.surface}»
              </Text>
            )}
          </View>
          {item.level && <LevelChip level={item.level} />}
          <Pressable
            onPress={() => void speak(headword)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Pronounce"
            className="h-11 w-11 items-center justify-center rounded-full bg-surface-2 active:bg-border"
          >
            <Ionicons name="volume-medium-outline" size={22} color={theme.textMuted} />
          </Pressable>
        </View>

        <Text className="mt-2 text-lg">{item.translation || 'No translation yet'}</Text>
        {(item.pos || item.grammar) && (
          <Text variant="caption" className="mt-1">
            {[item.pos, item.grammar].filter(Boolean).join(' · ')}
          </Text>
        )}
        {item.needsEnrichment && (
          <View className="mt-2 flex-row items-center gap-1.5">
            <Ionicons name="help-circle" size={14} color={theme.danger} />
            <Text variant="caption" className="text-danger">
              Needs info — AI enrichment arrives with T16
            </Text>
          </View>
        )}
        {item.note && (
          <View className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
            <Text variant="caption" className="font-reading-italic">
              {item.note}
            </Text>
          </View>
        )}

        {/* actions */}
        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={() => setEditOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit item"
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-2 py-2.5 active:bg-border"
          >
            <Ionicons name="pencil-outline" size={15} color={theme.text} />
            <Text className="font-ui-medium text-sm">Edit</Text>
          </Pressable>
          <Pressable
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete item"
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-danger/40 py-2.5 active:bg-danger/10"
          >
            <Ionicons name="trash-outline" size={15} color={theme.danger} />
            <Text className="font-ui-medium text-sm text-danger">Delete</Text>
          </Pressable>
        </View>
      </View>

      {/* FSRS placeholder (honest, not broken — ticket scope note) */}
      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Reviews
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface">
        {DIRECTIONS.map((d, i) => (
          <View
            key={d}
            className={`flex-row items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
          >
            <Text className="text-sm">{d}</Text>
            <Text variant="caption">not yet scheduled</Text>
          </View>
        ))}
        <View className="border-t border-border bg-surface-2 px-4 py-2">
          <Text variant="caption">Spaced review begins with T06.</Text>
        </View>
      </View>

      {/* encounters — the memory hooks */}
      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Encounters · {item.encounters.length}
      </Text>
      <View className="gap-2">
        {item.encounters.map((enc) => (
          <EncounterCard key={enc.id} encounter={enc} />
        ))}
      </View>

      <EditItemSheet
        open={editOpen}
        item={item}
        onClose={() => setEditOpen(false)}
        onSaved={invalidate}
      />
    </ScrollView>
  );
}

function EncounterCard({ encounter }: { encounter: EncounterWithContext }) {
  const date = new Date(encounter.createdAt).toLocaleDateString();
  return (
    <View className="rounded-xl border border-border bg-surface px-4 py-3">
      {encounter.context ? (
        <>
          <RNText className="font-reading text-base leading-6 text-text">
            {encounter.context.sentence.ru}
          </RNText>
          <Text variant="caption" className="mt-1.5">
            {encounter.context.story ? `«${encounter.context.story.titleRu}»` : 'Story removed'} ·
            as «{encounter.surface}» · {date}
          </Text>
        </>
      ) : (
        <>
          <RNText className="font-reading text-base text-text">«{encounter.surface}»</RNText>
          <Text variant="caption" className="mt-1.5">
            {encounter.journalEntryId
              ? `Journal entry · ${date}`
              : encounter.sentenceId
                ? `Source no longer installed · ${date}`
                : `Added manually · ${date}`}
          </Text>
        </>
      )}
    </View>
  );
}
