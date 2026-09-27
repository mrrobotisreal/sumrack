import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { TokenRow } from '@/db/repositories/content';
import type {
  ScenarioDetail,
  ScenarioRunDebrief,
  ScenarioTurnRuntime,
} from '@/db/repositories/scenarios';
import { DIALOGUE_READING_STYLE } from '@/features/dialogue/transcript';
import { TokenText } from '@/features/reader/token-text';
import type { WordPopupTarget } from '@/features/reader/word-popup';
import { useAppTheme } from '@/theme/use-app-theme';

import { AttemptRow, type MediaState } from './attempt-row';
import type { ClipPlayer } from './use-clip-player';

/**
 * One turn of the debrief in walk order (T63 §10.2): the host's prompt
 * (tap-word, «EN» reveal, ▶ replay of the pre-rendered line) → the
 * attempts → the model answer (`accept[0]`, tap-word, ▶ coach audio when
 * rendered). Meta asks render inside the attempt list where they happened.
 */
export function TurnCard({
  index,
  turn,
  runtime,
  detail,
  runId,
  media,
  clips,
  onWordPress,
  onPlayedAttempt,
}: {
  index: number;
  turn: ScenarioRunDebrief['turns'][number];
  runtime: ScenarioTurnRuntime | null;
  detail: ScenarioDetail | null;
  runId: string;
  media: MediaState;
  clips: ClipPlayer;
  onWordPress: (target: WordPopupTarget) => void;
  onPlayedAttempt: (ext: 'wav' | 'ogg') => void;
}) {
  const { tokens } = useAppTheme();
  const [showEn, setShowEn] = React.useState(false);

  const promptId = runtime?.say[runtime.say.length - 1] ?? null;
  const prompt = promptId && detail ? (detail.lines[promptId] ?? null) : null;
  const promptSentence = prompt?.sentence ?? null;
  const promptUri = prompt?.audio?.localUri ?? null;
  const promptKey = `${turn.turnId}:prompt`;

  const coachId = runtime?.expect?.coachSentenceId ?? null;
  const coach = coachId && detail ? (detail.lines[coachId] ?? null) : null;
  const coachUri = coach?.audio?.localUri ?? null;
  const coachKey = `${turn.turnId}:coach`;
  const modelAnswer = runtime?.expect?.accept[0] ?? null;
  const modelSentence = coach?.sentence ?? null;

  const answered = turn.attempts.some((a) => a.kind === 'answer');

  return (
    <View className="rounded-2xl border border-border bg-surface p-4">
      <View className="flex-row items-center gap-2">
        <Text variant="caption" className="uppercase tracking-wider">
          Ход {index + 1}
        </Text>
        {turn.step.skipped && <Text variant="caption">· пропущен</Text>}
        {turn.step.assisted && <Text variant="caption">· с подсказкой</Text>}
        {turn.step.rescued && <Text variant="caption">· принято онлайн</Text>}
        {turn.step.meta > 0 && <Text variant="caption">· {turn.step.meta} ❔</Text>}
        <View className="flex-1" />
        {promptUri && (
          <Pressable
            onPress={() => clips.toggle(promptKey, promptUri)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={clips.playing === promptKey ? 'Pause the line' : 'Replay the line'}
          >
            <Ionicons
              name={clips.playing === promptKey ? 'pause-circle-outline' : 'play-circle-outline'}
              size={22}
              color={tokens.accent}
            />
          </Pressable>
        )}
        <Pressable
          onPress={() => setShowEn((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={showEn ? 'Hide translation' : 'Show translation'}
          accessibilityState={{ expanded: showEn }}
        >
          <Ionicons
            name={showEn ? 'language' : 'language-outline'}
            size={18}
            color={showEn ? tokens.accent : tokens.textMuted}
          />
        </Pressable>
      </View>

      <View className="mt-2">
        {promptSentence ? (
          <TokenText
            tokens={promptSentence.tokens as TokenRow[]}
            readingStyle={{ ...DIALOGUE_READING_STYLE, fontSize: 18, lineHeight: 27 }}
            onWordPress={(token) =>
              onWordPress({
                token,
                sentenceId: promptSentence.id,
                storyId: detail?.scenario.id ?? runId,
              })
            }
            selectionEnabled={false}
          />
        ) : (
          <RNText className="font-reading text-lg text-text-muted">
            {runtime ? '(line unavailable — pack not installed)' : '(turn no longer in the pack)'}
          </RNText>
        )}
        {showEn && promptSentence && (
          <RNText className="mt-1.5 border-l-2 border-accent/40 pl-3 font-reading-italic text-base text-text-muted">
            {promptSentence.en}
          </RNText>
        )}
      </View>

      {turn.attempts.length > 0 ? (
        turn.attempts.map((a) => (
          <AttemptRow
            key={a.id}
            runId={runId}
            attempt={a}
            step={turn.step}
            media={media}
            clips={clips}
            onPlayed={onPlayedAttempt}
          />
        ))
      ) : runtime?.expect ? (
        <Text variant="caption" className="mt-2 pl-1">
          {turn.step.skipped ? 'Skipped without an attempt.' : 'No attempt recorded.'}
        </Text>
      ) : null}

      {modelAnswer && (answered || turn.step.skipped) && (
        <View className="mt-3 rounded-xl border border-dashed border-border px-3 py-2.5">
          <View className="flex-row items-center gap-2">
            <Text variant="caption" className="flex-1 uppercase tracking-wider">
              Можно было сказать
            </Text>
            {coachUri && (
              <Pressable
                onPress={() => clips.toggle(coachKey, coachUri)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  clips.playing === coachKey ? 'Pause the model answer' : 'Hear the model answer'
                }
              >
                <Ionicons
                  name={
                    clips.playing === coachKey ? 'pause-circle-outline' : 'volume-medium-outline'
                  }
                  size={20}
                  color={tokens.accent}
                />
              </Pressable>
            )}
          </View>
          <View className="mt-1">
            {modelSentence ? (
              <TokenText
                tokens={modelSentence.tokens as TokenRow[]}
                readingStyle={{ ...DIALOGUE_READING_STYLE, fontSize: 17, lineHeight: 26 }}
                onWordPress={(token) =>
                  onWordPress({
                    token,
                    sentenceId: modelSentence.id,
                    storyId: detail?.scenario.id ?? runId,
                  })
                }
                selectionEnabled={false}
              />
            ) : (
              <RNText className="font-reading text-lg text-text">{modelAnswer}</RNText>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
