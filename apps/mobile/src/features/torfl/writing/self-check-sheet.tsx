import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Modal, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/cn';
import { useAppTheme } from '@/theme/use-app-theme';

import { SELF_CHECKS, type SelfCheckId, type SelfCheckValue } from '../grading/writing';

export type SelfCheckAnswers = Record<SelfCheckId, SelfCheckValue>;

const EMPTY: SelfCheckAnswers = {
  'vocab-range': 0,
  'vocab-fit': 0,
  'grammar-cases': 0,
  'grammar-verbs': 0,
};

/**
 * «Самопроверка» (T72, TORFL §6.2): when the AI never grades (offline for
 * good, no key), Mitch rates the four AI-only questions 0 / ½ / 1 against
 * the model letter shown above them. The host folds the answers with the
 * offline criteria (`selfCheckCriteria`) → `gradedBy: 'self'`, final.
 */
export function SelfCheckSheet({
  open,
  letter,
  modelLetter,
  onClose,
  onSubmit,
}: {
  open: boolean;
  letter: string;
  modelLetter: string | null;
  onClose: () => void;
  onSubmit: (answers: SelfCheckAnswers) => void;
}) {
  return open ? (
    <SelfCheckBody
      letter={letter}
      modelLetter={modelLetter}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  ) : null;
}

function SelfCheckBody({
  letter,
  modelLetter,
  onClose,
  onSubmit,
}: {
  letter: string;
  modelLetter: string | null;
  onClose: () => void;
  onSubmit: (answers: SelfCheckAnswers) => void;
}) {
  const { tokens } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [answers, setAnswers] = React.useState<SelfCheckAnswers>(EMPTY);
  const [showModel, setShowModel] = React.useState(true);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-scrim/50" onPress={onClose} accessibilityLabel="Закрыть" />
      <View
        // A FIXED height (not max-h) so the ScrollView is bounded and the save button never
        // overlaps the last visible row (S25 finding: a «½» tap hit «Сохранить»).
        className="h-[88%] rounded-t-2xl border-t border-border bg-surface px-5 pt-4"
        style={{ paddingBottom: insets.bottom + 16 }}
        testID="self-check"
      >
        <View className="mb-2 flex-row items-center gap-2">
          <Ionicons name="checkbox-outline" size={18} color={tokens.accent} />
          <Text className="flex-1 font-ui-medium text-lg">Самопроверка</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close" size={22} color={tokens.textMuted} />
          </Pressable>
        </View>
        <Text variant="caption" className="mb-3">
          ИИ не оценил письмо. Сравни своё письмо с образцом и оцени четыре пункта честно — 0, ½ или
          1. Оценка станет окончательной.
        </Text>
        <ScrollView className="flex-1" contentContainerClassName="gap-3 pb-3">
          {modelLetter ? (
            <View className="rounded-2xl border border-border bg-bg px-4 py-3">
              <Pressable
                onPress={() => setShowModel((v) => !v)}
                accessibilityRole="button"
                className="flex-row items-center gap-2"
              >
                <Text className="flex-1 font-ui-medium text-sm">Образец письма</Text>
                <Ionicons
                  name={showModel ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={tokens.textMuted}
                />
              </Pressable>
              {showModel && (
                <RNText className="mt-2 font-reading text-base leading-6 text-text">
                  {modelLetter}
                </RNText>
              )}
            </View>
          ) : (
            <Text variant="caption">
              У этого задания нет образца письма — оцени по памяти о правилах.
            </Text>
          )}
          <View className="rounded-2xl border border-border bg-bg px-4 py-3">
            <Text className="mb-1 font-ui-medium text-sm">Твоё письмо</Text>
            <RNText className="font-reading text-base leading-6 text-text">{letter}</RNText>
          </View>
          {SELF_CHECKS.map((check) => (
            <View
              key={check.id}
              className="gap-2 rounded-2xl border border-border bg-bg px-4 py-3"
              testID={`self-check-${check.id}`}
            >
              <Text className="font-ui-medium">{check.ru}</Text>
              <Text variant="caption">{check.en}</Text>
              <View className="flex-row gap-2">
                {([0, 0.5, 1] as const).map((v) => {
                  const selected = answers[check.id] === v;
                  return (
                    <Pressable
                      key={v}
                      onPress={() => setAnswers((a) => ({ ...a, [check.id]: v }))}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`self-check-${check.id}-${v}`}
                      className={cn(
                        'flex-1 items-center rounded-full border py-1.5',
                        selected ? 'border-accent bg-accent-soft' : 'border-border',
                      )}
                    >
                      <Text
                        className={cn(
                          'font-ui-medium text-sm',
                          selected ? 'text-accent' : 'text-text-muted',
                        )}
                      >
                        {v === 0 ? '0' : v === 0.5 ? '½' : '1'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable
          onPress={() => onSubmit(answers)}
          accessibilityRole="button"
          testID="self-check-submit"
          className="mt-2 items-center rounded-full bg-accent px-5 py-3.5 active:opacity-80"
        >
          <Text className="font-ui-bold text-bg">Сохранить оценку</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
