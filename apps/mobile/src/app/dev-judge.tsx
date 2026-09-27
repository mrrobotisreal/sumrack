import { createAudioPlayer } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import SherpaSpeech from '../../modules/sherpa-speech';
import { useScenario, useScenarios } from '@/db/hooks';
import type { ScenarioDetail, ScenarioTurnRuntime } from '@/db/repositories/scenarios';
import { hasApiKey } from '@/features/ai/config';
import { isOnline } from '@/features/ai/connectivity';
import { isAsrInstalled } from '@/features/pronunciation/asr-manager';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { isAssistInstalled, transcribeEnglish } from '@/features/pronunciation/assist-service';
import {
  getMicPermission,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import {
  endpointConfig,
  endpointManualStop,
  endpointStep,
  INITIAL_ENDPOINT,
  type EndpointConfig,
  type EndpointSensitivity,
  type EndpointState,
} from '@/features/scenario/engine/endpointing';
import { judgeAnswer, type JudgeResult } from '@/features/scenario/judge/judge';
import { maybeRescue, shouldRescue, type RescueOutcome } from '@/features/scenario/judge/rescue';
import {
  detectMetaIntent,
  resolveExplain,
  resolveHowToSay,
  type MetaDetection,
  type MetaResolution,
  type PlayedToken,
} from '@/features/scenario/meta-intents';
import {
  fetchExplainLine,
  fetchHowToSayLine,
  speakGloss,
  speakRu,
  stopPrompter,
} from '@/features/scenario/prompter';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Judge lab (T60 ticket item 7, dev builds only — the dev-tts / dev-assist
 * pattern): pick an installed scenario turn → tap-to-talk with LIVE
 * endpointing (preset switch + level thresholds) or type a transcript →
 * meta-intent detection + resolver source, else the judge's verdict ·
 * slots · score · near-miss · reject index, then the online rescue verdict
 * when its gate passes. «Play clip» plays a glossary hit's rendered line.
 * Every result is logged as `[judge-lab]` JSON so an adb session can drive
 * it and read the numbers off logcat/Metro.
 */

interface RunLine {
  at: number;
  text: string;
}

const PRESETS: EndpointSensitivity[] = ['quick', 'normal', 'patient'];
const START_LEVELS = [0.04, 0.06, 0.08, 0.12, 0.16];
const LOUD_LEVELS = [0.02, 0.03, 0.05, 0.08];

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function LabButton({
  label,
  onPress,
  tone = 'plain',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={
        tone === 'primary'
          ? `rounded-full bg-accent px-4 py-2.5 active:opacity-80 ${disabled ? 'opacity-40' : ''}`
          : `rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2 ${disabled ? 'opacity-40' : ''}`
      }
    >
      <Text className={tone === 'primary' ? 'font-ui-medium text-bg' : 'font-ui-medium'}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function DevJudgeScreen() {
  const { tokens: theme } = useAppTheme();
  /**
   * adb-drivable (dev only): `sumrak://dev-judge?turn=t03&say=...` picks the
   * first installed scenario + the turn and judges the transcript;
   * `&wav=/data/local/tmp/x.wav` transcribes a pushed WAV first (the ASR path
   * without a mic). `n` is a nonce so the same query can be re-fired.
   */
  const params = useLocalSearchParams<{ turn?: string; say?: string; wav?: string; n?: string }>();
  const families = useScenarios();
  const [picked, setPicked] = React.useState<{ packId: string; scenarioId: string } | null>(null);
  const detailQ = useScenario(picked?.packId, picked?.scenarioId);
  const detail: ScenarioDetail | null = detailQ.data ?? null;
  const [turnId, setTurnId] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');
  const [preset, setPreset] = React.useState<EndpointSensitivity>('normal');
  const [startLevel, setStartLevel] = React.useState(0.08);
  const [loudLevel, setLoudLevel] = React.useState(0.05);
  const [recording, setRecording] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [ep, setEp] = React.useState<EndpointState>(INITIAL_ENDPOINT);
  const [busy, setBusy] = React.useState(false);
  const [lines, setLines] = React.useState<RunLine[]>([]);
  const [last, setLast] = React.useState<{
    transcript: string;
    meta: { detection: MetaDetection; resolution: MetaResolution } | null;
    /** Whisper's English re-decode of the same WAV (shown so a real-voice test can see what was caught). */
    whisperText: string | null;
    judge: JudgeResult | null;
    rescue: RescueOutcome | null | 'gated';
    clipSentenceId: string | null;
  } | null>(null);

  const epRef = React.useRef<EndpointState>(INITIAL_ENDPOINT);
  const finishRef = React.useRef<(reason: string, speechMs: number) => Promise<void>>(
    async () => undefined,
  );
  const cfgRef = React.useRef<EndpointConfig>(endpointConfig('normal'));
  const recordingRef = React.useRef(false);
  const playedRef = React.useRef<PlayedToken[]>([]);
  const lastWavRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    cfgRef.current = endpointConfig(preset, { startLevel, loudLevel });
  }, [preset, startLevel, loudLevel]);

  const log = React.useCallback((obj: Record<string, unknown>) => {
    const text = JSON.stringify(obj);
    console.log(`[judge-lab] ${text}`);
    setLines((prev) => [{ at: Date.now(), text }, ...prev].slice(0, 40));
  }, []);

  const turns = React.useMemo(
    () => (detail ? detail.turns.filter((t) => t.expect !== null) : []),
    [detail],
  );
  const turn: ScenarioTurnRuntime | null = React.useMemo(
    () => turns.find((t) => t.id === turnId) ?? turns[0] ?? null,
    [turns, turnId],
  );

  // The host lines of the picked turn count as "played" for the explain resolver.
  React.useEffect(() => {
    if (!detail || !turn) return;
    const played: PlayedToken[] = [];
    for (const t of detail.turns) {
      for (const sid of t.say) {
        const sentence = detail.lines[sid]?.sentence;
        if (!sentence) continue;
        for (const tok of sentence.tokens) {
          if (!tok.isPunct)
            played.push({ text: tok.text, lemma: tok.lemma, translation: tok.translation });
        }
      }
      if (t.id === turn.id) break;
    }
    playedRef.current = played;
  }, [detail, turn]);

  const promptText = (t: ScenarioTurnRuntime | null) =>
    t && detail ? (detail.lines[t.say[t.say.length - 1]!]?.sentence?.ru ?? t.id) : '';

  const analyze = React.useCallback(
    async (transcript: string, wavPath: string | null) => {
      if (!detail || !turn?.expect) return;
      setBusy(true);
      try {
        const detection = detectMetaIntent(transcript, detail.scenario.language);
        const glossary = detail.glossary.map((g) => ({
          id: g.id,
          ru: g.ru,
          en: g.en,
          forms: g.forms,
          translit: g.translit,
        }));
        const clips = Object.fromEntries(
          detail.glossary.map((g) => [
            g.id,
            { explain: g.explainSentenceId, howToSay: g.howToSaySentenceId },
          ]),
        );
        if (detection) {
          let resolution: MetaResolution;
          let whisperText: string | null = null;
          const t0 = Date.now();
          if (detection.intent === 'explain') {
            resolution = await resolveExplain(detection, {
              glossary,
              explainSentenceId: (id) => clips[id]?.explain ?? null,
              played: playedRef.current,
              online: fetchExplainLine,
            });
          } else if (detection.intent === 'howtosay') {
            resolution = await resolveHowToSay(detection, {
              glossary,
              howToSaySentenceId: (id) => clips[id]?.howToSay ?? null,
              whisper:
                wavPath && isAssistInstalled()
                  ? async () => {
                      const w = await transcribeEnglish(wavPath);
                      whisperText = w.text;
                      log({ op: 'whisper', text: w.text, decodeMs: w.decodeMs });
                      return w.text;
                    }
                  : undefined,
              online: fetchHowToSayLine,
            });
          } else {
            resolution = { intent: detection.intent } as MetaResolution;
          }
          const clipSentenceId = 'sentenceId' in resolution ? resolution.sentenceId : null;
          setLast({
            transcript,
            meta: { detection, resolution },
            whisperText,
            judge: null,
            rescue: null,
            clipSentenceId,
          });
          log({
            op: 'meta',
            transcript,
            intent: detection.intent,
            query: detection.query,
            score: detection.score,
            resolution,
            ms: Date.now() - t0,
          });
          if (
            resolution.intent === 'explain' &&
            (resolution.source === 'played' || resolution.source === 'online')
          ) {
            void speakGloss(resolution.ru, resolution.en);
          } else if (resolution.intent === 'howtosay' && resolution.source === 'online') {
            void speakRu(resolution.ru);
          }
          return;
        }
        const t0 = Date.now();
        const judge = judgeAnswer(transcript, turn.expect);
        const judgeMs = Date.now() - t0;
        const [online, key] = await Promise.all([isOnline(), hasApiKey()]);
        const gate = shouldRescue({ judge, online, rescueOnline: true, hasKey: key });
        setLast({
          transcript,
          meta: null,
          whisperText: null,
          judge,
          rescue: gate ? null : 'gated',
          clipSentenceId: null,
        });
        log({
          op: 'judge',
          turn: turn.id,
          transcript,
          verdict: judge.verdict,
          matchedBy: judge.matchedBy,
          branchKey: judge.branchKey,
          slots: judge.slots,
          score: judge.score,
          target: judge.target,
          nearMiss: judge.nearMiss,
          rejectIndex: judge.rejectIndex,
          contentTokens: judge.contentTokenCount,
          judgeMs,
          rescueGate: gate,
          online,
          key,
        });
        if (!gate) return;
        const prompt = detail.lines[turn.say[turn.say.length - 1]!]?.sentence;
        const allowedKeys =
          typeof turn.next === 'object' && turn.next ? Object.keys(turn.next.on) : [];
        const t1 = Date.now();
        const outcome = await maybeRescue(
          judge,
          {
            language: detail.scenario.language,
            questionRu: prompt?.ru ?? '',
            questionEn: prompt?.en ?? '',
            slots: turn.expect.slots,
            accept: turn.expect.accept,
            allowedKeys,
            transcript,
          },
          { rescueOnline: true },
        );
        setLast((prev) => (prev ? { ...prev, rescue: outcome } : prev));
        log({ op: 'rescue', ...(outcome ?? { verdict: 'gated' }), wallMs: Date.now() - t1 });
      } catch (err) {
        log({ op: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setBusy(false);
      }
    },
    [detail, turn, log],
  );

  const finishRecording = React.useCallback(
    async (reason: string, speechMs: number) => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      setRecording(false);
      const res = await stopAttemptRecording().catch(() => null);
      const wavPath = res
        ? res.path.startsWith('file://')
          ? res.path
          : `file://${res.path}`
        : null;
      lastWavRef.current = wavPath;
      log({
        op: 'endpoint',
        reason,
        speechMs,
        durationMs: res?.durationMs ?? 0,
        peak: epRef.current.peak,
        speechStartMs: epRef.current.speechStartMs,
        preset,
        startLevel,
        loudLevel,
      });
      if (reason === 'no-speech' || !wavPath || !res || res.durationMs === 0) return;
      try {
        const r = await transcribeWav(wavPath);
        log({ op: 'asr', text: r.text, decodeMs: r.decodeMs, audioMs: r.audioMs });
        setTyped(r.text);
        await analyze(r.text, wavPath);
      } catch (err) {
        log({ op: 'asr', error: err instanceof Error ? err.message : String(err) });
      }
    },
    [analyze, log, preset, startLevel, loudLevel],
  );

  React.useEffect(() => {
    finishRef.current = finishRecording;
  }, [finishRecording]);

  // Live endpointing over the module's level events while recording.
  React.useEffect(() => {
    const sub = SherpaSpeech.addListener('onRecordingLevel', ({ level: l, elapsedMs }) => {
      setLevel(l);
      if (!recordingRef.current) return;
      const d = endpointStep(epRef.current, { level: l, elapsedMs }, cfgRef.current);
      epRef.current = d.state;
      setEp(d.state);
      if (d.stop) void finishRef.current(d.stop.reason, d.stop.speechMs);
    });
    return () => sub.remove();
  }, []);

  const toggleRecord = React.useCallback(async () => {
    if (recordingRef.current) {
      const d = endpointManualStop(epRef.current, epRef.current.elapsedMs);
      epRef.current = d.state;
      setEp(d.state);
      await finishRecording('manual', d.stop?.speechMs ?? 0);
      return;
    }
    if (!isAsrInstalled()) {
      log({ op: 'error', message: 'ASR model not installed' });
      return;
    }
    let perm = await getMicPermission();
    if (perm !== 'granted') perm = await requestMicPermission();
    if (perm !== 'granted') {
      log({ op: 'error', message: 'mic permission not granted' });
      return;
    }
    epRef.current = INITIAL_ENDPOINT;
    setEp(INITIAL_ENDPOINT);
    await startAttemptRecording();
    recordingRef.current = true;
    setRecording(true);
  }, [finishRecording, log]);

  const onTalk = React.useCallback(() => {
    void toggleRecord();
  }, [toggleRecord]);
  const onJudgeTyped = React.useCallback(() => {
    void analyze(typed, lastWavRef.current);
  }, [analyze, typed]);

  const onStopAudio = React.useCallback(() => {
    void stopPrompter();
  }, []);

  const playClip = React.useCallback(() => {
    const sid = last?.clipSentenceId;
    if (!sid || !detail) return;
    const line = detail.lines[sid];
    const uri = line?.audio?.localUri;
    if (uri && fileExists(uri)) {
      const player = createAudioPlayer({ uri });
      player.addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish) player.release();
      });
      player.play();
      log({
        op: 'play',
        sentenceId: sid,
        rendered: true,
        durationMs: line?.audio?.durationMs ?? null,
      });
    } else if (line?.sentence?.ru) {
      void speakRu(line.sentence.ru);
      log({ op: 'play', sentenceId: sid, rendered: false });
    }
  }, [detail, last, log]);

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      className={
        active
          ? 'rounded-full bg-accent px-3 py-1.5'
          : 'rounded-full border border-border bg-surface px-3 py-1.5 active:bg-surface-2'
      }
    >
      <Text className={active ? 'font-ui-medium text-bg' : 'font-ui-medium'}>{label}</Text>
    </Pressable>
  );
  const rungs = (families.data ?? []).flatMap((f) => f.rungs);

  // Deep-link driver (see the params note above). Selection changes are
  // deferred to a microtask so the effects never set state synchronously.
  const firedRef = React.useRef<string | null>(null);
  const first = rungs[0];
  React.useEffect(() => {
    if (picked || !first) return;
    const t = setTimeout(() => setPicked({ packId: first.packId, scenarioId: first.id }), 0);
    return () => clearTimeout(t);
  }, [picked, first]);
  React.useEffect(() => {
    if (!params.turn || !detail) return;
    const id = turns.find((t) => t.id === params.turn || t.id.endsWith(`-${params.turn}`))?.id;
    if (!id || id === turnId) return;
    const t = setTimeout(() => setTurnId(id), 0);
    return () => clearTimeout(t);
  }, [params.turn, detail, turns, turnId]);
  React.useEffect(() => {
    const key = `${params.turn ?? ''}|${params.say ?? ''}|${params.wav ?? ''}|${params.n ?? ''}`;
    if (!turn || busy || firedRef.current === key) return;
    if (params.turn && !turn.id.endsWith(`-${params.turn}`) && turn.id !== params.turn) return;
    if (!params.say && !params.wav) return;
    firedRef.current = key;
    void (async () => {
      if (params.wav) {
        const wavPath = params.wav.startsWith('file://') ? params.wav : `file://${params.wav}`;
        lastWavRef.current = wavPath;
        try {
          const r = await transcribeWav(wavPath);
          log({
            op: 'asr',
            file: params.wav.split('/').pop(),
            text: r.text,
            decodeMs: r.decodeMs,
            audioMs: r.audioMs,
          });
          setTyped(r.text);
          await analyze(r.text, wavPath);
        } catch (err) {
          log({ op: 'asr', error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      setTyped(params.say!);
      await analyze(params.say!, null);
    })();
  }, [params.turn, params.say, params.wav, params.n, turn, busy, analyze, log]);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-6"
      keyboardShouldPersistTaps="handled"
    >
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Scenario
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {rungs.length === 0 ? (
          <Text variant="caption">None installed — import a1-scenario-fixture in DB Debug.</Text>
        ) : null}
        {rungs.map((r) =>
          chip(`${r.id} · ${r.level}`, picked?.scenarioId === r.id, () => {
            setPicked({ packId: r.packId, scenarioId: r.id });
            setTurnId(null);
            setLast(null);
          }),
        )}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Turn (expecting only)
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {turns.map((t) =>
          chip(t.id.replace(`${detail?.scenario.id ?? ''}-`, ''), turn?.id === t.id, () =>
            setTurnId(t.id),
          ),
        )}
      </View>
      {turn ? (
        <Text variant="caption" className="mt-2">
          «{promptText(turn)}» · slots{' '}
          {turn.expect!.slots.map((s) => `${s.id}:${s.kind}${s.required ? '!' : ''}`).join(' ')} ·
          accept[0] «{turn.expect!.accept[0]}»
          {turn.expect!.branchOn ? ` · branchOn ${turn.expect!.branchOn}` : ''}
        </Text>
      ) : null}

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Endpointing · preset / start / loud
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {PRESETS.map((p) => chip(p, preset === p, () => setPreset(p)))}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {START_LEVELS.map((v) => chip(`S ${v}`, startLevel === v, () => setStartLevel(v)))}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {LOUD_LEVELS.map((v) => chip(`L ${v}`, loudLevel === v, () => setLoudLevel(v)))}
      </View>
      <View className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
        <View
          style={{
            width: `${Math.min(100, Math.round(level * 100))}%`,
            height: '100%',
            backgroundColor: level >= startLevel ? theme.accent : theme.textMuted,
          }}
        />
      </View>
      <Text variant="caption" className="mt-1" accessibilityLabel="endpoint-readout">
        level {level.toFixed(3)} · {ep.phase} · peak {ep.peak.toFixed(3)} · speechStart{' '}
        {ep.speechStartMs ?? '—'} · elapsed {ep.elapsedMs}
        {ep.reason ? ` · stop ${ep.reason}` : ''}
      </Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        <LabButton
          label={recording ? 'Stop' : 'Tap to talk'}
          onPress={onTalk}
          tone="primary"
          disabled={!turn || busy}
        />
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Or type a transcript
      </Text>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        accessibilityLabel="transcript-input"
        className="rounded-xl border border-border bg-surface px-4 py-3 font-reading text-lg text-text"
        placeholder="меня зовут митч"
        placeholderTextColor={theme.textMuted}
      />
      <View className="mt-2 flex-row flex-wrap gap-2">
        <LabButton
          label="Judge typed"
          onPress={onJudgeTyped}
          disabled={!turn || busy || typed.trim() === ''}
        />
        <LabButton label="Play clip" onPress={playClip} disabled={!last?.clipSentenceId} />
        <LabButton label="Stop audio" onPress={onStopAudio} />
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Result {busy ? '· working…' : ''}
      </Text>
      <View
        className="rounded-xl border border-border bg-surface px-3 py-2"
        accessibilityLabel="judge-result"
      >
        {!last ? (
          <Text variant="caption">Nothing yet.</Text>
        ) : last.meta ? (
          <>
            <Text className="font-ui-medium">
              meta · {last.meta.detection.intent} · «{last.meta.detection.query || '—'}»
            </Text>
            <Text variant="caption" className="mt-1">
              source {'source' in last.meta.resolution ? last.meta.resolution.source : '—'}
              {'entryId' in last.meta.resolution ? ` · hit ${last.meta.resolution.entryId}` : ''}
              {'ru' in last.meta.resolution ? ` · «${last.meta.resolution.ru}»` : ''}
              {'en' in last.meta.resolution ? ` — ${last.meta.resolution.en}` : ''}
            </Text>
            {last.whisperText !== null && (
              <Text variant="caption" className="mt-1">
                whisper heard «{last.whisperText}»
                {last.clipSentenceId ? ' · tap Play clip for the host’s answer' : ''}
              </Text>
            )}
          </>
        ) : last.judge ? (
          <>
            <Text className="font-ui-medium">
              {last.judge.verdict}
              {last.judge.matchedBy ? ` (${last.judge.matchedBy})` : ''} · score {last.judge.score}{' '}
              · branch {last.judge.branchKey ?? '—'}
            </Text>
            <Text variant="caption" className="mt-1">
              slots{' '}
              {Object.entries(last.judge.slots)
                .map(([k, v]) => `${k}=${v ?? '∅'}`)
                .join(' ')}{' '}
              · nearMiss {String(last.judge.nearMiss)} · reject {last.judge.rejectIndex ?? '—'} ·
              target «{last.judge.target}»
            </Text>
            <Text variant="caption" className="mt-1">
              words {last.judge.words.map((w) => `${w.matched ? '✓' : '✗'}${w.display}`).join(' ')}
            </Text>
            <Text variant="caption" className="mt-1">
              rescue{' '}
              {last.rescue === 'gated'
                ? 'gated (offline / matched / no key / < 2 tokens)'
                : last.rescue === null
                  ? 'pending…'
                  : `${last.rescue.verdict} · ${last.rescue.ms} ms · ${last.rescue.model ?? '—'}${'branchKey' in last.rescue ? ` · key ${last.rescue.branchKey ?? '—'}` : ''}${'code' in last.rescue ? ` · ${last.rescue.code}` : ''}`}
            </Text>
          </>
        ) : null}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Log
      </Text>
      <View className="rounded-xl border border-border bg-surface px-3 py-2">
        {lines.length === 0 ? (
          <Text variant="caption">Nothing yet.</Text>
        ) : (
          lines.map((l) => (
            <Text key={l.at + l.text.slice(0, 12)} variant="caption" className="mt-1">
              {l.text}
            </Text>
          ))
        )}
      </View>
      <Text variant="caption" className="mt-3">
        ASR {isAsrInstalled() ? '✓' : '—'} · Whisper {isAssistInstalled() ? '✓' : '—'}
      </Text>
    </ScrollView>
  );
}
