import * as React from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { createAudioPlayer } from 'expo-audio';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import SherpaSpeech from '../../modules/sherpa-speech';
import { transcriptResultSchema } from '@/features/pronunciation/asr-catalog';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { ASSIST_CANDIDATES, type AssistModel } from '@/features/pronunciation/assist-catalog';
import {
  assistModelPaths,
  assistRootDir,
  isAssistInstalled,
} from '@/features/pronunciation/assist-manager';
import { encodeWavToOpus } from '@/features/pronunciation/opus-encoder';
import {
  attemptWavPath,
  getMicPermission,
  requestMicPermission,
  startAttemptRecording,
  stopAttemptRecording,
} from '@/features/pronunciation/recorder';
import { formatBytes } from '@/features/tts/catalog';
import { track } from '@/services/analytics';

/**
 * Dev bench for the T59 native additions (dev builds only, like dev-tts):
 * record a clip (or use WAVs pushed under `bench/`), run every Whisper
 * candidate on it beside the Russian Zipformer, transcode it to Opus and
 * play the result. Every run is logged as `[assist-bench]` JSON lines so an
 * adb session can drive it and read the numbers off logcat/Metro.
 */

interface RunLine {
  at: number;
  text: string;
}

function benchDir(): Directory {
  return new Directory(Paths.document, 'bench');
}

export default function DevAssistScreen() {
  const [lines, setLines] = React.useState<RunLine[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [wavPath, setWavPath] = React.useState<string>(attemptWavPath());

  const log = React.useCallback((text: string) => {
    console.log(`[assist-bench] ${text}`);
    setLines((prev) => [{ at: Date.now(), text }, ...prev].slice(0, 60));
  }, []);

  const guard = React.useCallback(
    (label: string, fn: () => Promise<void>) => {
      setBusy(true);
      void fn()
        .catch((err) =>
          log(
            JSON.stringify({
              op: label,
              error: err instanceof Error ? err.message : String(err),
              code: (err as { code?: string })?.code ?? null,
            }),
          ),
        )
        .finally(() => setBusy(false));
    },
    [log],
  );

  const toggleRecord = React.useCallback(() => {
    guard('record', async () => {
      if (recording) {
        const res = await stopAttemptRecording();
        setRecording(false);
        setWavPath(res.path);
        log(JSON.stringify({ op: 'recorded', durationMs: res.durationMs }));
        return;
      }
      let perm = await getMicPermission();
      if (perm !== 'granted') perm = await requestMicPermission();
      if (perm !== 'granted') throw new Error('mic permission not granted');
      await startAttemptRecording();
      setRecording(true);
    });
  }, [guard, log, recording]);

  const runCandidate = React.useCallback(
    async (
      candidate: AssistModel,
      path: string,
      language: 'en' | 'ru' | 'auto',
      fileLabel?: string,
    ) => {
      const paths = assistModelPaths(candidate);
      const load = await SherpaSpeech.loadWhisper(
        candidate.id,
        paths.encoderPath,
        paths.decoderPath,
        paths.tokensPath,
      );
      const raw = await SherpaSpeech.transcribeWhisper(path, language);
      const r = transcriptResultSchema.parse(raw);
      const mem = SherpaSpeech.getLoadedAsrId();
      const line = {
        op: 'whisper',
        model: candidate.id,
        language,
        file: fileLabel ?? path.split('/').pop(),
        loadMs: load.alreadyLoaded ? 0 : load.loadMs,
        decodeMs: r.decodeMs,
        audioMs: r.audioMs,
        text: r.text,
        asrResident: mem,
      };
      log(JSON.stringify(line));
      track('dev_assist_bench', {
        model: candidate.id,
        language,
        decodeMs: r.decodeMs,
        audioMs: r.audioMs,
      });
      return r;
    },
    [log],
  );

  const runAll = React.useCallback(
    (path: string) => {
      guard('runAll', async () => {
        const f = new File(path);
        if (!f.exists) throw new Error(`no clip at ${path.split('/').pop()}`);
        try {
          const ru = await transcribeWav(path);
          log(
            JSON.stringify({
              op: 'zipformer',
              file: path.split('/').pop(),
              decodeMs: ru.decodeMs,
              audioMs: ru.audioMs,
              text: ru.text,
            }),
          );
        } catch (err) {
          log(JSON.stringify({ op: 'zipformer', error: (err as Error).message }));
        }
        for (const candidate of ASSIST_CANDIDATES) {
          if (!isAssistInstalled(candidate)) {
            log(JSON.stringify({ op: 'whisper', model: candidate.id, skipped: 'not installed' }));
            continue;
          }
          await runCandidate(candidate, path, 'en');
        }
      });
    },
    [guard, log, runCandidate],
  );

  const runFolder = React.useCallback(() => {
    guard('runFolder', async () => {
      const dir = benchDir();
      if (!dir.exists) throw new Error('no bench/ dir');
      // bench/ itself + one level of sub-folders (clip sets), each set in order.
      const sets: Directory[] = [
        dir,
        ...dir
          .list()
          .filter((e): e is Directory => e instanceof Directory)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ];
      for (const set of sets) {
        const wavs = set
          .list()
          .filter((e): e is File => e instanceof File && e.name.endsWith('.wav'))
          .sort((a, b) => a.name.localeCompare(b.name));
        const setName = set === dir ? '.' : set.name;
        log(JSON.stringify({ op: 'folder', set: setName, count: wavs.length }));
        for (const wav of wavs) {
          const file = `${setName}/${wav.name}`;
          try {
            const ru = await transcribeWav(wav.uri);
            log(JSON.stringify({ op: 'zipformer', file, decodeMs: ru.decodeMs, text: ru.text }));
          } catch (err) {
            log(JSON.stringify({ op: 'zipformer', file, error: (err as Error).message }));
          }
          for (const candidate of ASSIST_CANDIDATES) {
            if (!isAssistInstalled(candidate)) continue;
            await runCandidate(candidate, wav.uri, 'en', file);
          }
        }
      }
      log(JSON.stringify({ op: 'folder-done' }));
    });
  }, [guard, log, runCandidate]);

  const encode = React.useCallback(() => {
    guard('opus', async () => {
      const src = new File(wavPath);
      if (!src.exists) throw new Error('no clip recorded');
      const out = new File(Paths.cache, 'bench-attempt.ogg');
      const res = await encodeWavToOpus(src.uri, out.uri, { inBytes: src.size ?? 0 });
      log(JSON.stringify({ op: 'opus', inBytes: src.size, ...res, out: out.name }));
    });
  }, [guard, log, wavPath]);

  const playOgg = React.useCallback(() => {
    guard('play', async () => {
      const out = new File(Paths.cache, 'bench-attempt.ogg');
      if (!out.exists) throw new Error('encode first');
      const player = createAudioPlayer({ uri: out.uri });
      player.play();
      log(JSON.stringify({ op: 'play', file: out.name, bytes: out.size }));
      setTimeout(() => {
        try {
          player.remove();
        } catch {
          // already gone
        }
      }, 15_000);
    });
  }, [guard, log]);

  const loadOnly = React.useCallback(
    (candidate: AssistModel) => {
      guard('load', async () => {
        const paths = assistModelPaths(candidate);
        const res = await SherpaSpeech.loadWhisper(
          candidate.id,
          paths.encoderPath,
          paths.decoderPath,
          paths.tokensPath,
        );
        log(JSON.stringify({ op: 'loaded', model: candidate.id, ...res }));
      });
    },
    [guard, log],
  );

  const unloadAll = React.useCallback(() => {
    guard('unload', async () => {
      await SherpaSpeech.unloadWhisper();
      log(JSON.stringify({ op: 'unloaded', whisper: SherpaSpeech.getLoadedWhisperId() }));
    });
  }, [guard, log]);

  const button = (label: string, onPress: () => void, tone: 'primary' | 'plain' = 'plain') => (
    <Pressable
      key={label}
      onPress={busy && label !== 'Stop' ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={
        tone === 'primary'
          ? 'rounded-full bg-accent px-4 py-2.5 active:opacity-80'
          : 'rounded-full border border-border bg-surface px-4 py-2.5 active:bg-surface-2'
      }
    >
      <Text className={tone === 'primary' ? 'font-ui-medium text-bg' : 'font-ui-medium'}>
        {label}
      </Text>
    </Pressable>
  );

  const installedList = ASSIST_CANDIDATES.map((c) => `${c.id}:${isAssistInstalled(c) ? '✓' : '—'}`);

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="px-4 pb-12 pt-6">
      <Text variant="caption" className="mb-2 uppercase tracking-wider">
        Candidates on disk
      </Text>
      <Text variant="caption">{installedList.join(' · ')}</Text>
      <Text variant="caption" className="mt-1">
        bench/: {benchDir().exists ? 'present' : 'absent'} · root{' '}
        {assistRootDir().uri.split('/').slice(-2).join('/')}
      </Text>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Clip
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {button(recording ? 'Stop' : 'Record', toggleRecord, 'primary')}
        {button('Run all on clip', () => runAll(wavPath))}
        {button('Run bench/ folder', runFolder)}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Opus
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {button('Encode clip → .ogg', encode)}
        {button('Play .ogg', playOgg)}
        {button('Unload Whisper', unloadAll)}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Load only (RAM probe)
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {ASSIST_CANDIDATES.map((c) => button(`Load ${c.size}`, () => loadOnly(c)))}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Log {busy ? '· working…' : ''}
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
        Models:{' '}
        {ASSIST_CANDIDATES.map((c) => `${c.size} ${formatBytes(c.archiveBytes)}`).join(' · ')}
      </Text>
    </ScrollView>
  );
}
