import * as React from 'react';
import { Pressable, Text as RNText, Vibration, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Rating, type Grade } from '@/db/repositories/reviews';

import { DIRECTION_LABELS } from './format';
import { answerText, promptText, type SessionItem } from './session';

interface FlashcardViewProps {
  entry: SessionItem;
  onGrade: (rating: Grade, durationMs: number) => void;
}

/**
 * Flashcard mode (design §7.3 mode 1): flip, then self-grade with the four
 * literal FSRS ratings. durationMs measures prompt-shown → grade-tapped.
 * Remounted per card (key in the screen), so state starts fresh.
 */
export function FlashcardView({ entry, onGrade }: FlashcardViewProps) {
  const [flipped, setFlipped] = React.useState(false);
  // Set on mount (remounted per card) — Date.now() is impure in render.
  const shownAtRef = React.useRef(0);
  React.useEffect(() => {
    shownAtRef.current = Date.now();
  }, []);

  const front = promptText(entry.item, entry.direction);
  const back = answerText(entry.item, entry.direction);
  // The Russian side gets reading type; the English side UI type.
  const frontIsRu = entry.direction !== 'en-ru';

  const grade = (rating: Grade) => {
    Vibration.vibrate(8);
    onGrade(rating, Date.now() - shownAtRef.current);
  };

  return (
    <View className="flex-1 px-4 pt-6">
      <Text variant="caption" className="text-center uppercase tracking-wider">
        {DIRECTION_LABELS[entry.direction]} · {entry.item.kind}
      </Text>

      <Pressable
        onPress={() => setFlipped(true)}
        disabled={flipped}
        accessibilityRole="button"
        accessibilityLabel={flipped ? 'Card revealed' : 'Show answer'}
        className="mt-4 flex-1 items-center justify-center rounded-2xl border border-border bg-surface px-6"
      >
        <RNText
          className={
            frontIsRu ? 'font-reading text-3xl text-text' : 'font-ui-medium text-2xl text-text'
          }
          style={{ textAlign: 'center' }}
        >
          {front}
        </RNText>

        {flipped ? (
          <>
            <View className="my-5 h-px w-24 bg-border" />
            <RNText
              className={
                frontIsRu ? 'font-ui-medium text-2xl text-text' : 'font-reading text-3xl text-text'
              }
              style={{ textAlign: 'center' }}
            >
              {back}
            </RNText>
            {(entry.item.pos || entry.item.grammar) && (
              <Text variant="caption" className="mt-3 text-center">
                {[entry.item.pos, entry.item.grammar].filter(Boolean).join(' · ')}
              </Text>
            )}
          </>
        ) : (
          <Text variant="caption" className="mt-6">
            Tap to reveal
          </Text>
        )}
      </Pressable>

      <View className="mt-4">
        {flipped ? (
          <View className="flex-row gap-2">
            <GradeButton
              label="Again"
              sub="forgot"
              tone="danger"
              onPress={() => grade(Rating.Again)}
            />
            <GradeButton
              label="Hard"
              sub="barely"
              tone="muted"
              onPress={() => grade(Rating.Hard)}
            />
            <GradeButton
              label="Good"
              sub="got it"
              tone="success"
              onPress={() => grade(Rating.Good)}
            />
            <GradeButton
              label="Easy"
              sub="instant"
              tone="accent"
              onPress={() => grade(Rating.Easy)}
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setFlipped(true)}
            accessibilityRole="button"
            accessibilityLabel="Show answer"
            className="items-center rounded-xl bg-surface-2 py-4 active:bg-border"
          >
            <Text className="font-ui-medium">Show answer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const TONE_CLASSES = {
  danger: 'border-danger/50 bg-danger/15',
  muted: 'border-border bg-surface-2',
  success: 'border-success/50 bg-success/15',
  accent: 'border-accent/50 bg-accent/15',
} as const;

function GradeButton({
  label,
  sub,
  tone,
  onPress,
}: {
  label: string;
  sub: string;
  tone: keyof typeof TONE_CLASSES;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Grade ${label}`}
      className={`flex-1 items-center rounded-xl border py-3 active:opacity-70 ${TONE_CLASSES[tone]}`}
    >
      <Text className="font-ui-medium">{label}</Text>
      <Text variant="caption" className="mt-0.5 text-xs">
        {sub}
      </Text>
    </Pressable>
  );
}
