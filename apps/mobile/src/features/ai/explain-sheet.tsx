import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { MarkdownView } from '@/components/markdown-view';
import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { friendlyAiMessage } from './errors';
import { explain, type ExplainTarget } from './explain';

/**
 * "Explain this" sheet (ticket feature 3): bottom-anchored modal (the
 * word-popup pattern — thumb-reachable, UI_DESIGN §4) that asks Claude
 * about a sentence or card and renders the markdown answer. Transient by
 * design; the session cache in explain.ts makes reopening instant.
 * Remounts per target so state starts fresh (T05 sheet pattern).
 */
export function ExplainSheet({
  target,
  onClose,
}: {
  target: ExplainTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  const key = target.kind === 'sentence' ? target.ru : target.headword;
  return <ExplainSheetInner key={key} target={target} onClose={onClose} />;
}

function ExplainSheetInner({ target, onClose }: { target: ExplainTarget; onClose: () => void }) {
  const { tokens: theme } = useAppTheme();
  const [state, setState] = React.useState<
    { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'done'; markdown: string }
  >({ phase: 'loading' });

  // Async only — resolves/rejects into state, never a synchronous setState.
  const fetchExplanation = React.useCallback(
    () =>
      explain(target)
        .then((markdown) => setState({ phase: 'done', markdown }))
        .catch((err) => setState({ phase: 'error', message: friendlyAiMessage(err) })),
    [target],
  );

  React.useEffect(() => {
    track('explain_opened', { kind: target.kind });
    void fetchExplanation();
  }, [fetchExplanation, target.kind]);

  const run = React.useCallback(() => {
    setState({ phase: 'loading' });
    void fetchExplanation();
  }, [fetchExplanation]);

  const heading = target.kind === 'sentence' ? target.ru : target.headword;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Close" />

      <View
        className="rounded-t-2xl border-t border-border bg-surface px-5 pb-9 pt-4"
        style={{ maxHeight: '75%' }}
      >
        <View className="flex-row items-center gap-3">
          <Ionicons name="sparkles-outline" size={16} color={theme.accent} />
          <Text variant="caption" className="flex-1 uppercase tracking-wider" numberOfLines={1}>
            Explain · online
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={theme.textMuted} />
          </Pressable>
        </View>
        <Text className="mt-2 font-reading text-lg" numberOfLines={2}>
          {heading}
        </Text>

        <View className="mt-3 min-h-[120px]">
          {state.phase === 'loading' && (
            <View className="items-center justify-center py-10">
              <ActivityIndicator color={theme.accent} />
              <Text variant="caption" className="mt-3">
                Asking your tutor…
              </Text>
            </View>
          )}
          {state.phase === 'error' && (
            <View className="items-center gap-3 py-8">
              <Ionicons name="cloud-offline-outline" size={22} color={theme.textMuted} />
              <Text variant="caption" className="px-6 text-center">
                {state.message}
              </Text>
              <Pressable
                onPress={run}
                accessibilityRole="button"
                className="rounded-xl bg-accent px-5 py-2.5 active:opacity-80"
              >
                <Text className="font-ui-medium text-sm">Retry</Text>
              </Pressable>
            </View>
          )}
          {state.phase === 'done' && (
            <ScrollView className="max-h-[440px]" showsVerticalScrollIndicator>
              <MarkdownView source={state.markdown} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
