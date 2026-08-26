import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { DialogueGraphChoice, DialogueGraphNode } from '@/db/repositories/dialogues';
import { isAsrInstalled } from '@/features/pronunciation/asr-manager';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import {
  cancelAttemptRecording,
  MAX_ATTEMPT_MS,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import { RecordButton, type RecordButtonState } from '@/features/pronunciation/record-button';
import { TokenText } from '@/features/reader/token-text';
import { track } from '@/services/analytics';
import { useGamePrefs } from '@/store/game-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

import SherpaSpeech from '../../../modules/sherpa-speech';

import { DIALOGUE_READING_STYLE, type OnDialogueWordPress } from './transcript';
import {
  matchTranscriptToChoices,
  TAP_UNLOCK_AFTER_ATTEMPTS,
  type ChoiceMatchResult,
} from './matching';

/**
 * The player turn (T27, V2 §3.3): 2–4 `ChoiceCard`s (tap-word enabled,
 * long-press reveals the EN hint, optional coach «hear it» audio) and the
 * T12 mic flow — record → ASR → match against every choice + alternates.
 * Below-threshold/ambiguous ⇒ «Скажи ещё раз?» with per-word ✗ against the
 * best candidate; TAP_UNLOCK_AFTER_ATTEMPTS failures unlock tap-to-choose.
 * Voice-first, never voice-locked: `dialogueTapMode`, a missing ASR model,
 * or a denied mic all make tap primary with a clear notice instead.
 *
 * Gesture interplay (T05 patterns): word taps are RNText onPress inside the
 * card; the card's own onPress is nil (no accidental choosing), choosing is
 * an explicit ≥48dp button; long-press lands on either the card Pressable or
 * a token chunk (TokenText `onChunkLongPress` — RN Text cancels its tap when
 * long-press fires, so no double-fire).
 */

interface ChoicePanelProps {
  node: DialogueGraphNode;
  disabled: boolean;
  onResolve: (choice: DialogueGraphChoice, opts: { score?: number; via: 'voice' | 'tap' }) => void;
  onWordPress: OnDialogueWordPress;
}

type MicPhase = 'idle' | 'recording' | 'processing' | 'feedback';

export function ChoicePanel({ node, disabled, onResolve, onWordPress }: ChoicePanelProps) {
  const { tokens: theme } = useAppTheme();
  const tapMode = useGamePrefs((s) => s.dialogueTapMode);
  const asrAvailable = isAsrInstalled();

  const [phase, setPhase] = React.useState<MicPhase>('idle');
  const [level, setLevel] = React.useState(0);
  const [attempts, setAttempts] = React.useState(0);
  const [result, setResult] = React.useState<ChoiceMatchResult | null>(null);
  const [heard, setHeard] = React.useState('');
  const [micDenied, setMicDenied] = React.useState(false);
  const [micError, setMicError] = React.useState(false);
  const [hintsShown, setHintsShown] = React.useState<ReadonlySet<string>>(new Set());
  const phaseRef = React.useRef(phase);
  React.useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const autoStopRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachPlayerRef = React.useRef<AudioPlayer | null>(null);

  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l }) => setLevel(l));
    return () => {
      sub.remove();
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      coachPlayerRef.current?.release();
      if (phaseRef.current === 'recording') void cancelAttemptRecording();
    };
  }, []);

  const voiceUsable = asrAvailable && !micDenied && !micError;
  const tapUnlocked = tapMode || !voiceUsable || attempts >= TAP_UNLOCK_AFTER_ATTEMPTS;

  const finishRecording = React.useCallback(async () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    setPhase('processing');
    try {
      const { path } = await stopAttemptRecording();
      const transcript = await transcribeWav(path);
      const matchables = node.choices.map((c) => ({
        id: c.id,
        ru: c.sentence?.ru ?? '',
        asrAlternates: c.asrAlternates,
      }));
      const match = matchTranscriptToChoices(transcript.text, matchables);
      const attemptNo = attempts + 1;
      track('dialogue_choice_attempt', {
        outcome: match.outcome,
        score: match.best?.score ?? 0,
        margin: Math.round(match.margin),
        attempt: attemptNo,
        choices: node.choices.length,
      });
      if (match.outcome === 'matched' && match.best) {
        const chosen = node.choices.find((c) => c.id === match.best!.choiceId);
        if (chosen) {
          setPhase('idle');
          onResolve(chosen, { score: match.best.score, via: 'voice' });
          return;
        }
      }
      setAttempts(attemptNo);
      setResult(match);
      setHeard(transcript.text.trim());
      setPhase('feedback');
      if (attemptNo === TAP_UNLOCK_AFTER_ATTEMPTS) {
        track('dialogue_tap_unlocked', { attempts: attemptNo });
      }
    } catch (err) {
      console.warn('[dialogue] attempt failed', err);
      // ASR/recorder failure mid-turn: unlock tap, never a dead end.
      setMicError(true);
      setPhase('idle');
    }
  }, [attempts, node.choices, onResolve]);

  const startRecording = React.useCallback(async () => {
    const permission = await requestMicPermission();
    if (permission !== 'granted') {
      setMicDenied(true);
      return;
    }
    try {
      await startAttemptRecording();
      setLevel(0);
      setPhase('recording');
      autoStopRef.current = setTimeout(() => {
        if (phaseRef.current === 'recording') void finishRecording();
      }, MAX_ATTEMPT_MS);
    } catch (err) {
      console.warn('[dialogue] recording failed', err);
      setMicError(true);
    }
  }, [finishRecording]);

  const revealHint = React.useCallback((choice: DialogueGraphChoice) => {
    if (!choice.hintEn && !choice.hintRu) return;
    setHintsShown((prev) => {
      if (prev.has(choice.id)) return prev;
      track('dialogue_hint_revealed', { choiceId: choice.id });
      return new Set(prev).add(choice.id);
    });
  }, []);

  const playCoach = React.useCallback((choice: DialogueGraphChoice) => {
    const uri = choice.audio?.localUri;
    if (!uri) return;
    track('dialogue_coach_played', { choiceId: choice.id });
    coachPlayerRef.current?.release();
    const player = createAudioPlayer({ uri });
    coachPlayerRef.current = player;
    player.play();
  }, []);

  const buttonState: RecordButtonState =
    phase === 'recording' ? 'recording' : phase === 'processing' ? 'processing' : 'idle';

  const retryMessage =
    result?.outcome === 'no-speech'
      ? 'Не расслышал — попробуй ещё раз, чуть громче.'
      : result?.outcome === 'ambiguous'
        ? 'Похоже сразу на два ответа — скажи ещё раз, полной фразой.'
        : 'Скажи ещё раз? Красные слова не прозвучали.';

  return (
    <View className="border-t border-border bg-bg px-4 pb-4 pt-3">
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        {tapUnlocked && !voiceUsable ? 'Выбери ответ' : 'Твой ответ'}
      </Text>

      <View className="gap-2">
        {node.choices.map((choice) => (
          <ChoiceCard
            key={choice.id}
            choice={choice}
            tapUnlocked={tapUnlocked}
            disabled={disabled}
            hintShown={hintsShown.has(choice.id)}
            onLongPress={() => revealHint(choice)}
            onChooseTap={() => {
              track('dialogue_choice_tapped', { attempts });
              onResolve(choice, { via: 'tap' });
            }}
            onPlayCoach={choice.audio?.localUri ? () => playCoach(choice) : undefined}
            onWordPress={onWordPress}
          />
        ))}
      </View>

      {/* retry feedback: per-word ✗ against the best candidate (T12 chips) */}
      {phase === 'feedback' && result?.best && (
        <View className="mt-3 items-center gap-2">
          <Text variant="muted" className="text-center">
            {retryMessage}
          </Text>
          <View className="flex-row flex-wrap justify-center gap-1.5">
            {result.best.detail.words.map((w, i) => (
              <View
                key={`${i}-${w.target}`}
                className={`rounded-lg px-2 py-1 ${w.matched ? 'bg-success/20' : 'bg-danger/25'}`}
              >
                <RNText
                  className="font-reading text-base"
                  style={{ color: w.matched ? theme.success : theme.danger }}
                >
                  {w.display}
                </RNText>
              </View>
            ))}
          </View>
          {heard.length > 0 && (
            <Text variant="caption" className="text-center">
              Услышал: «{heard}»
            </Text>
          )}
          {attempts >= TAP_UNLOCK_AFTER_ATTEMPTS && (
            <Text variant="caption" className="text-center text-accent">
              Или выбери ответ нажатием →
            </Text>
          )}
        </View>
      )}

      {/* voice-unavailable notices — tap is primary, never a dead end */}
      {!asrAvailable && (
        <Text variant="caption" className="mt-3 text-center">
          Голосовой режим недоступен — модель распознавания не установлена (Settings → Speech
          recognition). Отвечай нажатием.
        </Text>
      )}
      {asrAvailable && micDenied && (
        <Text variant="caption" className="mt-3 text-center">
          Нет доступа к микрофону — отвечай нажатием, или разреши доступ в настройках системы.
        </Text>
      )}
      {asrAvailable && !micDenied && micError && (
        <Text variant="caption" className="mt-3 text-center">
          Распознавание не сработало — отвечай нажатием.
        </Text>
      )}

      {/* mic zone */}
      {voiceUsable && (
        <View className="mt-2 items-center">
          {phase === 'recording' && (
            <Text variant="caption" className="mb-1 text-danger">
              Говори — нажми, чтобы закончить
            </Text>
          )}
          <RecordButton
            state={buttonState}
            level={level}
            onPress={() => {
              if (disabled) return;
              if (phase === 'recording') void finishRecording();
              else if (phase !== 'processing') void startRecording();
            }}
          />
        </View>
      )}
    </View>
  );
}

function ChoiceCard({
  choice,
  tapUnlocked,
  disabled,
  hintShown,
  onLongPress,
  onChooseTap,
  onPlayCoach,
  onWordPress,
}: {
  choice: DialogueGraphChoice;
  tapUnlocked: boolean;
  disabled: boolean;
  hintShown: boolean;
  onLongPress: () => void;
  onChooseTap: () => void;
  onPlayCoach?: () => void;
  onWordPress: OnDialogueWordPress;
}) {
  const { tokens: theme } = useAppTheme();
  const sentence = choice.sentence;
  const hint = choice.hintEn ?? choice.hintRu;
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={320}
      accessibilityLabel={`Answer: ${sentence?.ru ?? ''}. Long press for a hint`}
      className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <View className="flex-1">
        {sentence ? (
          <TokenText
            tokens={sentence.tokens}
            readingStyle={DIALOGUE_READING_STYLE}
            onWordPress={(token) => onWordPress(token, sentence.id)}
            selectionEnabled={false}
            onChunkLongPress={onLongPress}
          />
        ) : (
          <RNText style={[DIALOGUE_READING_STYLE, { color: theme.textMuted }]}>…</RNText>
        )}
        {hintShown && hint && (
          <Text variant="caption" className="mt-1 font-reading-italic">
            {hint}
          </Text>
        )}
      </View>
      {onPlayCoach && (
        <Pressable
          onPress={onPlayCoach}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Hear how to say it"
          className="h-11 w-11 items-center justify-center rounded-full bg-surface-2 active:bg-border"
        >
          <Ionicons name="volume-medium-outline" size={18} color={theme.textMuted} />
        </Pressable>
      )}
      {tapUnlocked && (
        <Pressable
          onPress={disabled ? undefined : onChooseTap}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Choose this answer"
          className="h-12 w-12 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <Ionicons name="arrow-forward" size={20} color={theme.bg} />
        </Pressable>
      )}
    </Pressable>
  );
}
