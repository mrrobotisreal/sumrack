import type { TypedItem } from '@sumrak/schema';
import * as React from 'react';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { acceptedDisplay, type ItemScore } from '../scoring';
import type { ItemFeedback } from './choice-item-view';

/**
 * Free-text answer (T70): the prompt, a Cyrillic input with a keyboard hint
 * and «Проверить». `feedback: 'instant'` shows the verdict under the field:
 * full → green; HALF → amber «Почти: форма не та» with the accepted form;
 * wrong → red with the accepted form. `feedback: 'none'` (T71) just records
 * the text via `onSubmit` and never reveals anything.
 */
export function TypedItemView({
  item,
  feedback,
  onSubmit,
  result,
}: {
  item: TypedItem;
  feedback: ItemFeedback;
  onSubmit: (text: string) => void;
  /** The scored result once submitted (drills) — drives the verdict block. */
  result?: ItemScore | null;
}) {
  const { tokens } = useAppTheme();
  const [text, setText] = React.useState('');
  const submitted = result != null;
  const tone =
    result?.outcome === 'full'
      ? 'border-success bg-success/15'
      : result?.outcome === 'half'
        ? 'border-track-warm bg-track-warm-soft'
        : 'border-danger bg-danger/15';

  const submit = () => {
    if (submitted && feedback === 'instant') return;
    onSubmit(text);
  };

  return (
    <View className="gap-4">
      <View className="rounded-2xl border border-border bg-surface px-5 py-6">
        <RNText className="font-reading text-2xl leading-10 text-text">{item.prompt}</RNText>
      </View>
      <View className="gap-2">
        <TextInput
          value={text}
          onChangeText={setText}
          editable={!(submitted && feedback === 'instant')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          keyboardType="default"
          placeholder="Напиши ответ…"
          placeholderTextColor={tokens.textMuted}
          onSubmitEditing={submit}
          returnKeyType="done"
          testID="typed-input"
          accessibilityLabel="Type the answer"
          className="rounded-xl border border-border bg-surface px-4 py-3.5 font-reading text-xl text-text"
        />
        <Text variant="caption">
          Включи русскую клавиатуру (ё и е считаются одинаково). / Switch to the Cyrillic keyboard.
        </Text>
      </View>
      {!submitted && (
        <Pressable
          onPress={submit}
          disabled={text.trim().length === 0}
          accessibilityRole="button"
          testID="typed-submit"
          className={`items-center rounded-xl py-3.5 ${
            text.trim().length === 0 ? 'bg-surface-2' : 'bg-accent active:opacity-80'
          }`}
        >
          <Text
            className={`font-ui-medium ${text.trim().length === 0 ? 'text-text-muted' : 'text-bg'}`}
          >
            Проверить
          </Text>
        </Pressable>
      )}
      {submitted && feedback === 'instant' && (
        <View className={`gap-1 rounded-xl border px-4 py-3 ${tone}`} testID="typed-verdict">
          <Text className="font-ui-bold">
            {result.outcome === 'full'
              ? 'Верно!'
              : result.outcome === 'half'
                ? `Почти: ${result.points} из ${result.maxPoints} — смысл верный, форма не та`
                : 'Неверно'}
          </Text>
          {result.outcome !== 'full' && (
            <Text>
              Правильно: <Text className="font-ui-bold">{acceptedDisplay(item)}</Text>
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
