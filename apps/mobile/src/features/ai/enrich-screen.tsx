import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';

import { LevelChip } from '@/components/level-chip';
import { Text } from '@/components/ui/text';
import { useBankItems } from '@/db/hooks';
import type { BankItemRow } from '@/db/repositories/bank';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { applyProposal, proposeEnrichment } from './enrichment';
import { friendlyAiMessage } from './errors';
import type { EnrichmentProposal } from './schemas';

/**
 * Enrichment review screen (ticket feature 2): propose → review → apply.
 * The DB is untouched until a proposal is explicitly accepted (per-card
 * or via bulk-accept, which just walks the remaining pending cards);
 * rejecting leaves the card unchanged AND still flagged, so it comes
 * back next time (recorded decision). Scales to "many flagged cards"
 * as a FlatList with a sticky bulk bar (ticket technical note).
 */

type RowStatus =
  | { state: 'pending' }
  | { state: 'accepted' }
  | { state: 'rejected' }
  | { state: 'failed'; message: string };

export function EnrichScreen() {
  const { tokens: theme } = useAppTheme();
  const queryClient = useQueryClient();
  const items = useBankItems({ needsEnrichment: true, limit: 200 });

  const [phase, setPhase] = React.useState<'idle' | 'proposing' | 'review'>('idle');
  const [proposals, setProposals] = React.useState<Map<string, EnrichmentProposal>>(new Map());
  const [statuses, setStatuses] = React.useState<Record<string, RowStatus>>({});
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [failedBatches, setFailedBatches] = React.useState(0);
  const [bulkRunning, setBulkRunning] = React.useState(false);

  React.useEffect(() => {
    track('enrich_screen_opened', { flagged: items.data?.length ?? -1 });
    // Count only wanted once meaningfully; re-runs on load are harmless noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot the flagged list at propose time: accepted rows clear their
  // flag and would otherwise vanish out of the review mid-flow.
  const [reviewItems, setReviewItems] = React.useState<BankItemRow[]>([]);

  const propose = React.useCallback(() => {
    const flagged = items.data ?? [];
    if (flagged.length === 0) return;
    setPhase('proposing');
    setRequestError(null);
    track('enrich_proposals_requested', { count: flagged.length });
    void proposeEnrichment(flagged)
      .then(({ proposals: map, failedBatches: failed }) => {
        setProposals(map);
        setFailedBatches(failed);
        setReviewItems(flagged);
        setStatuses({});
        setPhase('review');
        track('enrich_proposals_received', { proposed: map.size, failedBatches: failed });
      })
      .catch((err) => {
        setRequestError(friendlyAiMessage(err));
        setPhase('idle');
      });
  }, [items.data]);

  const invalidateBank = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['bank-items'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-item'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-word-status'] });
    void queryClient.invalidateQueries({ queryKey: ['bank-items', 'filter-options'] });
  }, [queryClient]);

  const accept = React.useCallback(
    async (item: BankItemRow) => {
      const proposal = proposals.get(item.id);
      if (!proposal) return;
      try {
        await applyProposal(item, proposal);
        setStatuses((s) => ({ ...s, [item.id]: { state: 'accepted' } }));
        track('enrich_accepted', { id: item.id, kind: item.kind });
        invalidateBank();
      } catch (err) {
        setStatuses((s) => ({
          ...s,
          [item.id]: { state: 'failed', message: friendlyAiMessage(err) },
        }));
        track('enrich_apply_failed', { id: item.id });
      }
    },
    [proposals, invalidateBank],
  );

  const reject = React.useCallback((item: BankItemRow) => {
    setStatuses((s) => ({ ...s, [item.id]: { state: 'rejected' } }));
    track('enrich_rejected', { id: item.id, kind: item.kind });
  }, []);

  const acceptAllPending = React.useCallback(() => {
    setBulkRunning(true);
    void (async () => {
      for (const item of reviewItems) {
        const status = statuses[item.id]?.state ?? 'pending';
        if (status === 'pending' && proposals.has(item.id)) {
          await accept(item);
        }
      }
      setBulkRunning(false);
    })();
  }, [reviewItems, statuses, proposals, accept]);

  const pendingCount = reviewItems.filter(
    (item) => (statuses[item.id]?.state ?? 'pending') === 'pending' && proposals.has(item.id),
  ).length;

  const flaggedCount = items.data?.length ?? 0;

  if (items.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (phase !== 'review') {
    return (
      <View className="flex-1 bg-bg px-4 pt-6">
        {flaggedCount === 0 ? (
          <View className="items-center gap-3 pt-24">
            <Ionicons name="checkmark-done-circle-outline" size={40} color={theme.textMuted} />
            <Text className="font-ui-medium text-lg">Nothing to enrich</Text>
            <Text variant="caption" className="px-10 text-center">
              Words and phrases you highlight in the journal or notes land here until AI fills in
              their lemma, translation, and grammar.
            </Text>
          </View>
        ) : (
          <View className="rounded-2xl border border-border bg-surface p-5">
            <Text className="font-ui-medium text-lg">
              {flaggedCount} {flaggedCount === 1 ? 'item needs' : 'items need'} details
            </Text>
            <Text variant="caption" className="mt-1 leading-5">
              Claude proposes lemma, translation, grammar, and level for each — nothing is saved
              until you accept it. Works online only.
            </Text>
            {requestError && (
              <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
                <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
                <Text variant="caption" className="flex-1">
                  {requestError}
                </Text>
              </View>
            )}
            <Pressable
              onPress={propose}
              disabled={phase === 'proposing'}
              accessibilityRole="button"
              className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 active:opacity-80"
            >
              {phase === 'proposing' ? (
                <>
                  <ActivityIndicator size="small" color={theme.text} />
                  <Text className="font-ui-medium">Asking Claude…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="sparkles-outline" size={16} color={theme.text} />
                  <Text className="font-ui-medium">
                    {requestError ? 'Retry proposals' : 'Propose with AI'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {failedBatches > 0 && (
        <View className="mx-4 mt-3 flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <Ionicons name="alert-circle-outline" size={15} color={theme.danger} />
          <Text variant="caption" className="flex-1">
            Some items got no proposal ({failedBatches} {failedBatches === 1 ? 'batch' : 'batches'}{' '}
            failed) — retry from the previous screen.
          </Text>
        </View>
      )}
      <FlatList
        data={reviewItems}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-28 pt-3 gap-3"
        renderItem={({ item }) => (
          <ProposalRow
            item={item}
            proposal={proposals.get(item.id) ?? null}
            status={statuses[item.id] ?? { state: 'pending' }}
            onAccept={() => void accept(item)}
            onReject={() => reject(item)}
          />
        )}
      />
      {pendingCount > 0 && (
        <View className="absolute inset-x-0 bottom-0 border-t border-border bg-bg px-4 pb-8 pt-3">
          <Pressable
            onPress={acceptAllPending}
            disabled={bulkRunning}
            accessibilityRole="button"
            className="flex-row items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 active:opacity-80"
          >
            {bulkRunning ? (
              <ActivityIndicator size="small" color={theme.text} />
            ) : (
              <Ionicons name="checkmark-done-outline" size={16} color={theme.text} />
            )}
            <Text className="font-ui-medium">Accept all remaining ({pendingCount})</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ProposalRow({
  item,
  proposal,
  status,
  onAccept,
  onReject,
}: {
  item: BankItemRow;
  proposal: EnrichmentProposal | null;
  status: RowStatus;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { tokens: theme } = useAppTheme();

  return (
    <View
      className={`rounded-2xl border border-border bg-surface p-4 ${
        status.state === 'rejected' ? 'opacity-50' : ''
      }`}
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 font-reading text-xl">{item.surface}</Text>
        {proposal?.level && <LevelChip level={proposal.level} />}
        <Text variant="caption" className="uppercase">
          {item.kind}
        </Text>
      </View>

      {proposal ? (
        <View className="mt-2 gap-1">
          {proposal.lemma && proposal.lemma !== item.surface && item.kind === 'word' && (
            <FieldLine label="lemma" prev={item.lemma ?? undefined} next={proposal.lemma} />
          )}
          <FieldLine
            label="translation"
            prev={item.translation || undefined}
            next={proposal.translation}
          />
          {proposal.grammar && <FieldLine label="grammar" next={proposal.grammar} />}
          {proposal.pos && item.kind === 'word' && (
            <FieldLine label="pos" prev={item.pos ?? undefined} next={proposal.pos} />
          )}
        </View>
      ) : (
        <Text variant="caption" className="mt-2">
          No proposal for this item — retry later.
        </Text>
      )}

      {status.state === 'failed' && (
        <View className="mt-2 flex-row items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
          <Ionicons name="alert-circle-outline" size={14} color={theme.danger} />
          <Text variant="caption" className="flex-1">
            {status.message}
          </Text>
        </View>
      )}

      {proposal && (status.state === 'pending' || status.state === 'failed') && (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={onAccept}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-accent py-2.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-sm">Accept</Text>
          </Pressable>
          <Pressable
            onPress={onReject}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl border border-border py-2.5 active:bg-surface-2"
          >
            <Text className="font-ui-medium text-sm text-text-muted">Skip</Text>
          </Pressable>
        </View>
      )}
      {status.state === 'accepted' && (
        <View className="mt-3 flex-row items-center gap-1.5">
          <Ionicons name="checkmark-circle" size={16} color={theme.success} />
          <Text variant="caption" style={{ color: theme.success }}>
            Applied
          </Text>
        </View>
      )}
      {status.state === 'rejected' && (
        <Text variant="caption" className="mt-3">
          Skipped — stays flagged for next time
        </Text>
      )}
    </View>
  );
}

function FieldLine({ label, prev, next }: { label: string; prev?: string; next: string }) {
  const changed = prev !== undefined && prev !== next;
  return (
    <View className="flex-row items-baseline gap-2">
      <Text variant="caption" className="w-20">
        {label}
      </Text>
      {changed && (
        <Text variant="caption" className="line-through">
          {prev}
        </Text>
      )}
      <Text className="flex-1 text-sm">{next}</Text>
    </View>
  );
}
