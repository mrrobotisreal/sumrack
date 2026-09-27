import { Asset } from 'expo-asset';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { useScenario, useScenarios, useScenarioStamps } from '@/db/hooks';
import type { ScenarioDetail } from '@/db/repositories/scenarios';
import {
  anchorFromRect,
  clampAnchor,
  containRect,
  EMPTY_SCENE_SPEC,
  mouthLineFor,
  mouthRect,
  PLACEHOLDER_KINDS,
  SCENE_BED_SLUGS,
  SCENE_BEDS,
  SCENE_POSES,
  ScenarioScene,
  SceneBox,
  sceneSpecFor,
  useMouthTrack,
  useSceneBed,
  type MouthAnchor,
  type MouthStyle,
  type PlaceholderKind,
  type Rect,
  type SceneLayout,
  type ScenePose,
  type SceneSpec,
} from '@/features/scenario/scene';
import { useMotionPrefs, useReduceMotion } from '@/store/motion-prefs';
import { useAppTheme } from '@/theme/use-app-theme';

/**
 * Scene gallery + anchor picker (T61 ticket item 2, dev builds only — the
 * judge-lab pattern): pick an installed scenario → its host renders in the
 * `ScenarioScene`; play any line (1.0× / 0.8×) with the mouth following the
 * track; toggle poses / reduce-motion / placeholder kind + hue / missing-PNG
 * simulation / layout preset; bed on-off with a duck toggle; **PNG mode**
 * on the committed `assets/dev/scenario/podcast/` trio; and the **anchor
 * picker** — drag / resize / rotate a box over any PNG (the trio or a file
 * from the device picker) and read the `anchors.json` fragment. Every
 * action logs `[scene-lab]` JSON so an adb session can drive and read it.
 *
 * Deep-link driver: `sumrak://dev-scene?line=<sentenceId|index>&rate=0.8
 * &pose=speaking&png=1&layout=desk&n=<nonce>`.
 */

const PODCAST_TRIO = {
  body: require('../../assets/dev/scenario/podcast/body.png') as number,
  eyelids: require('../../assets/dev/scenario/podcast/eyelids.png') as number,
  backdrop: require('../../assets/dev/scenario/podcast/backdrop.png') as number,
};

/** Starting guess for the podcast host (measured on-device — see the T61 status row). */
const PODCAST_ANCHOR_SEED: MouthAnchor = { x: 0.49, y: 0.257, w: 0.12, h: 0.032, rotate: 10 };

const RATES = [1, 0.8] as const;
const HUES = [25, 175, 225, 45, 210, 285] as const;
const LAYOUTS: SceneLayout[] = ['center', 'left', 'desk'];
const STYLES: MouthStyle[] = ['default', 'wide', 'small', 'beard'];

interface RunLine {
  at: number;
  text: string;
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
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
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Text variant="caption" className="mb-2 mt-5 uppercase tracking-wider">
        {title}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">{children}</View>
    </>
  );
}

/** Resolve the trio's Metro assets to file URIs once (expo-image wants a uri for the same code path packs use). */
function useTrioUris(): { body: string; eyelids: string; backdrop: string } | null {
  const [uris, setUris] = React.useState<{
    body: string;
    eyelids: string;
    backdrop: string;
  } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const load = async (id: number) => {
        const asset = Asset.fromModule(id);
        await asset.downloadAsync();
        return asset.localUri ?? asset.uri;
      };
      const [body, eyelids, backdrop] = await Promise.all([
        load(PODCAST_TRIO.body),
        load(PODCAST_TRIO.eyelids),
        load(PODCAST_TRIO.backdrop),
      ]);
      if (!cancelled) setUris({ body, eyelids, backdrop });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return uris;
}

export default function DevSceneScreen() {
  const { tokens: theme } = useAppTheme();
  const params = useLocalSearchParams<{
    line?: string;
    rate?: string;
    pose?: string;
    png?: string;
    layout?: string;
    n?: string;
  }>();
  const families = useScenarios();
  const rungs = React.useMemo(() => (families.data ?? []).flatMap((f) => f.rungs), [families.data]);
  const [picked, setPicked] = React.useState<{ packId: string; scenarioId: string } | null>(null);
  const detailQ = useScenario(picked?.packId, picked?.scenarioId);
  const detail: ScenarioDetail | null = detailQ.data ?? null;
  const trio = useTrioUris();

  // Overrides on top of the pack's spec.
  const [pose, setPose] = React.useState<ScenePose>('idle');
  const [pngMode, setPngMode] = React.useState(false);
  const [missingPng, setMissingPng] = React.useState(false);
  const [layout, setLayout] = React.useState<SceneLayout | null>(null);
  const [kind, setKind] = React.useState<PlaceholderKind | null>(null);
  const [hue, setHue] = React.useState<number | null>(null);
  const [mouthStyle, setMouthStyle] = React.useState<MouthStyle | null>(null);
  const [anchor, setAnchor] = React.useState<MouthAnchor>(PODCAST_ANCHOR_SEED);
  const [bedOn, setBedOn] = React.useState(false);
  const [bedSlug, setBedSlug] = React.useState<string>('studio');
  const [duck, setDuck] = React.useState(false);
  const [rate, setRate] = React.useState<number>(1);
  const [lines, setLines] = React.useState<RunLine[]>([]);
  const [renders, setRenders] = React.useState(0);
  const reduceMotion = useReduceMotion();
  const setReduceMotion = useMotionPrefs((s) => s.setReduceMotion);

  const log = React.useCallback((obj: Record<string, unknown>) => {
    const text = JSON.stringify(obj);
    console.log(`[scene-lab] ${text}`);
    setLines((prev) => [{ at: Date.now(), text }, ...prev].slice(0, 30));
  }, []);

  // First installed scenario auto-picks (deferred — never a sync set in an effect).
  const first = rungs[0];
  React.useEffect(() => {
    if (picked || !first) return;
    const t = setTimeout(() => setPicked({ packId: first.packId, scenarioId: first.id }), 0);
    return () => clearTimeout(t);
  }, [picked, first]);

  const baseSpec: SceneSpec = React.useMemo(
    () => (detail ? sceneSpecFor(detail) : EMPTY_SCENE_SPEC),
    [detail],
  );
  const spec: SceneSpec = React.useMemo(() => {
    const s: SceneSpec = { ...baseSpec };
    if (layout) s.layout = layout;
    if (kind || hue != null) {
      s.placeholder = {
        kind: kind ?? s.placeholder?.kind ?? 'man',
        hue: hue ?? s.placeholder?.hue ?? 220,
      };
    }
    if (pngMode && trio) {
      s.bodyUri = missingPng ? 'file:///nonexistent/body.png' : trio.body;
      s.eyelidsUri = trio.eyelids;
      s.backdropUri = missingPng ? 'file:///nonexistent/backdrop.png' : trio.backdrop;
      s.mouthAnchor = anchor;
      s.mouthStyle = mouthStyle ?? 'default';
    } else if (missingPng) {
      s.bodyUri = 'file:///nonexistent/body.png';
      s.backdropUri = 'file:///nonexistent/backdrop.png';
    }
    return s;
  }, [baseSpec, layout, kind, hue, pngMode, trio, missingPng, anchor, mouthStyle]);

  // --- Line playback ------------------------------------------------------
  const sentenceIds = React.useMemo(
    () => (detail ? detail.turns.flatMap((t) => t.say) : []),
    [detail],
  );
  const [playing, setPlaying] = React.useState<{ sentenceId: string; key: number } | null>(null);
  const [player, setPlayer] = React.useState<AudioPlayer | null>(null);
  const stampsQ = useScenarioStamps(picked?.packId, playing?.sentenceId);
  const line = React.useMemo(() => {
    if (!detail || !playing) return null;
    const l = detail.lines[playing.sentenceId];
    return mouthLineFor(l?.audio ?? null, l?.sentence ?? null, stampsQ.data);
  }, [detail, playing, stampsQ.data]);

  React.useEffect(() => {
    if (!detail || !playing) return;
    const l = detail.lines[playing.sentenceId];
    const uri = l?.audio?.localUri;
    if (!uri || !fileExists(uri)) {
      // No staged audio: muppet mode for the track length (or 2 s).
      const ms = l?.audio?.durationMs ?? 2000;
      const t0 = setTimeout(
        () => log({ op: 'play', sentenceId: playing.sentenceId, rendered: false }),
        0,
      );
      const t = setTimeout(() => setPlaying(null), ms / rate);
      return () => {
        clearTimeout(t0);
        clearTimeout(t);
      };
    }
    let released = false;
    const p = createAudioPlayer({ uri }, { updateInterval: 100 });
    p.setPlaybackRate(rate, 'high');
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      if (released) return;
      if (s.didJustFinish) setPlaying(null);
    });
    p.play();
    const t = setTimeout(() => {
      setPlayer(p);
      log({
        op: 'play',
        sentenceId: playing.sentenceId,
        rendered: true,
        rate,
        durationMs: l?.audio?.durationMs ?? null,
        mouthSteps: l?.audio?.mouth?.length ?? null,
      });
    }, 0);
    return () => {
      released = true;
      clearTimeout(t);
      sub.remove();
      p.release();
      setPlayer(null);
    };
    // playing.key is the deliberate remount key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing?.key]);

  const speaking = playing != null;
  const shape = useMouthTrack({ player, line, speaking, rate });
  const effectivePose: ScenePose = speaking ? 'speaking' : pose;

  // Bed: the gallery is always "active" for the bed while open; duck = manual OR a line playing.
  const bed = useSceneBed(bedOn ? bedSlug : 'none', {
    active: true,
    ducked: duck || speaking,
  });

  // Deep-link driver.
  const firedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const key = `${params.line ?? ''}|${params.rate ?? ''}|${params.pose ?? ''}|${params.png ?? ''}|${params.layout ?? ''}|${params.n ?? ''}`;
    if (!detail || firedRef.current === key) return;
    firedRef.current = key;
    const t = setTimeout(() => {
      if (params.pose && (SCENE_POSES as readonly string[]).includes(params.pose)) {
        setPose(params.pose as ScenePose);
      }
      if (params.png === '1') setPngMode(true);
      if (params.png === '0') setPngMode(false);
      if (params.layout && (LAYOUTS as readonly string[]).includes(params.layout)) {
        setLayout(params.layout as SceneLayout);
      }
      const r = params.rate ? Number.parseFloat(params.rate) : NaN;
      if (Number.isFinite(r)) setRate(r);
      if (params.line) {
        const byIndex = sentenceIds[Number.parseInt(params.line, 10)];
        const sid = sentenceIds.includes(params.line) ? params.line : byIndex;
        if (sid) setPlaying({ sentenceId: sid, key: Date.now() });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [detail, params, sentenceIds]);

  // Render probe readout: count the gallery's own commits during a line
  // (a dependency-less effect runs once per commit — the T31 probe method).
  const renderRef = React.useRef(0);
  React.useEffect(() => {
    renderRef.current += 1;
  });
  React.useEffect(() => {
    if (!speaking) return;
    const start = renderRef.current;
    return () => {
      const n = renderRef.current - start;
      log({ op: 'line-done', galleryRenders: n });
      setRenders(n);
    };
  }, [speaking, log]);

  // --- Anchor picker ------------------------------------------------------
  const [pickerUri, setPickerUri] = React.useState<string | null>(null);
  const [pickerSize, setPickerSize] = React.useState<{ w: number; h: number } | null>(null);
  const pickerImage = pickerUri ?? trio?.body ?? null;

  const anchorJson = JSON.stringify(
    { mouthAnchor: anchor, mouthStyle: mouthStyle ?? 'default' },
    null,
    2,
  );

  const onPickFile = React.useCallback(async () => {
    try {
      const result = await File.pickFileAsync({ mimeTypes: 'image/png' });
      if (result.canceled || !result.result) return;
      setPickerUri(result.result.uri);
      setPickerSize(null);
      log({ op: 'pick', uri: result.result.uri });
    } catch (err) {
      log({ op: 'pick', error: err instanceof Error ? err.message : String(err) });
    }
  }, [log]);

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-4"
      keyboardShouldPersistTaps="handled"
    >
      <Section title="Scenario">
        {rungs.length === 0 ? (
          <Text variant="caption">None installed — import a1-scenario-fixture in DB Debug.</Text>
        ) : null}
        {rungs.map((r) => (
          <Chip
            key={`${r.packId}/${r.id}`}
            label={`${r.id} · ${r.level}`}
            active={picked?.scenarioId === r.id}
            onPress={() => {
              setPicked({ packId: r.packId, scenarioId: r.id });
              setPlaying(null);
            }}
          />
        ))}
      </Section>

      {/* The scene — a 3:4-ish box like the run screen's 62 % band. */}
      <View
        className="mt-3 overflow-hidden rounded-2xl border border-border"
        style={{ height: 420 }}
        accessibilityLabel="scene-box"
      >
        <ScenarioScene
          spec={spec}
          pose={effectivePose}
          shape={shape}
          active
          forcePlaceholder={!pngMode && spec.bodyUri == null}
        />
      </View>
      <Text variant="caption" className="mt-1" accessibilityLabel="scene-status">
        {pngMode ? 'PNG' : 'placeholder'} · {spec.layout} · pose {effectivePose}
        {reduceMotion ? ' · reduce-motion' : ''} ·{' '}
        {speaking ? `playing ${playing.sentenceId}` : 'idle'} ·{' '}
        {renders > 0 ? `${renders} gallery renders last line` : ''} · bed{' '}
        {bed.bed
          ? `${bed.bed.slug}${bed.playing ? ' ▶' : ''}`
          : `${bedOn ? bedSlug : 'off'} (silent)`}
      </Text>

      <Section title="Lines">
        {sentenceIds.map((sid, i) => (
          <Chip
            key={sid}
            label={`${i + 1}`}
            active={playing?.sentenceId === sid}
            onPress={() => setPlaying({ sentenceId: sid, key: Date.now() })}
          />
        ))}
        {RATES.map((r) => (
          <Chip key={r} label={`${r}×`} active={rate === r} onPress={() => setRate(r)} />
        ))}
        <Chip label="Stop" active={false} onPress={() => setPlaying(null)} />
      </Section>

      <Section title="Pose">
        {SCENE_POSES.map((p) => (
          <Chip key={p} label={p} active={pose === p} onPress={() => setPose(p)} />
        ))}
        <Chip
          label="reduce-motion"
          active={reduceMotion}
          onPress={() => setReduceMotion(!reduceMotion)}
        />
      </Section>

      <Section title="Art">
        <Chip label="PNG trio" active={pngMode} onPress={() => setPngMode((v) => !v)} />
        <Chip label="missing PNG" active={missingPng} onPress={() => setMissingPng((v) => !v)} />
        {LAYOUTS.map((l) => (
          <Chip
            key={l}
            label={l}
            active={(layout ?? baseSpec.layout) === l}
            onPress={() => setLayout(l)}
          />
        ))}
      </Section>

      <Section title="Placeholder">
        {PLACEHOLDER_KINDS.map((k) => (
          <Chip
            key={k}
            label={k}
            active={(kind ?? baseSpec.placeholder?.kind) === k}
            onPress={() => setKind(k)}
          />
        ))}
        {HUES.map((h) => (
          <Chip
            key={h}
            label={`hue ${h}`}
            active={(hue ?? baseSpec.placeholder?.hue) === h}
            onPress={() => setHue(h)}
          />
        ))}
      </Section>

      <Section title="Mouth style (PNG)">
        {STYLES.map((s) => (
          <Chip
            key={s}
            label={s}
            active={(mouthStyle ?? 'default') === s}
            onPress={() => setMouthStyle(s)}
          />
        ))}
      </Section>

      <Section title="Bed">
        <Chip
          label={bedOn ? 'bed on' : 'bed off'}
          active={bedOn}
          onPress={() => setBedOn((v) => !v)}
        />
        <Chip label="duck" active={duck} onPress={() => setDuck((v) => !v)} />
        {SCENE_BED_SLUGS.filter((s) => s !== 'none').map((s) => (
          <Chip key={s} label={s} active={bedSlug === s} onPress={() => setBedSlug(s)} />
        ))}
        <Chip
          label="unknown-slug"
          active={bedSlug === 'disco'}
          onPress={() => setBedSlug('disco')}
        />
        <Text variant="caption">
          registry:{' '}
          {SCENE_BEDS.length === 0 ? 'none only' : SCENE_BEDS.map((b) => b.slug).join(', ')}
        </Text>
      </Section>

      <Section title="Anchor picker">
        <Chip label="podcast body" active={pickerUri == null} onPress={() => setPickerUri(null)} />
        <Chip label="pick PNG…" active={pickerUri != null} onPress={() => void onPickFile()} />
        <Chip
          label="reset"
          active={false}
          onPress={() => {
            setAnchor(PODCAST_ANCHOR_SEED);
            log({ op: 'anchor-reset' });
          }}
        />
      </Section>
      <View
        className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface"
        style={{ height: 460 }}
        accessibilityLabel="anchor-picker"
      >
        {pickerImage ? (
          <AnchorPicker
            uri={pickerImage}
            imageSize={pickerSize}
            onImageSize={setPickerSize}
            anchor={anchor}
            onChange={(a) => {
              setAnchor(a);
            }}
            onCommit={(a) => log({ op: 'anchor', ...a })}
            accent={theme.accent}
          />
        ) : (
          <Text variant="caption" className="p-3">
            Loading the podcast body…
          </Text>
        )}
      </View>
      <Text variant="caption" className="mt-1">
        Drag inside the box to move · drag a corner to resize · drag the top handle to rotate
      </Text>
      <TextInput
        value={anchorJson}
        editable={false}
        multiline
        selectTextOnFocus
        accessibilityLabel="anchor-json"
        className="mt-2 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs text-text"
      />
      <View className="mt-2 flex-row flex-wrap gap-2">
        {(['x', 'y', 'w', 'h'] as const).flatMap((k) =>
          ([-0.005, 0.005] as const).map((d) => (
            <Chip
              key={`${k}${d}`}
              label={`${k} ${d > 0 ? '+' : '−'}`}
              active={false}
              onPress={() => {
                const next = clampAnchor({ ...anchor, [k]: (anchor[k] ?? 0) + d });
                setAnchor(next);
                log({ op: 'anchor', ...next });
              }}
            />
          )),
        )}
        {([-1, 1] as const).map((d) => (
          <Chip
            key={`rot${d}`}
            label={`rotate ${d > 0 ? '+' : '−'}1°`}
            active={false}
            onPress={() => {
              const next = { ...anchor, rotate: Math.round(((anchor.rotate ?? 0) + d) * 10) / 10 };
              setAnchor(next);
              log({ op: 'anchor', ...next });
            }}
          />
        ))}
      </View>

      <Text variant="caption" className="mb-2 mt-6 uppercase tracking-wider">
        Log
      </Text>
      <View
        className="rounded-xl border border-border bg-surface px-3 py-2"
        accessibilityLabel="scene-log"
      >
        {lines.length === 0 ? <Text variant="caption">Nothing yet.</Text> : null}
        {lines.map((l) => (
          <Text key={l.at + l.text} variant="caption" className="font-mono text-xs">
            {l.text}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * The picker: the PNG contain-fit into its box; a box in anchor fractions
 * over the painted image rect, moved by a pan on its body, resized by a pan
 * on the bottom-right handle, rotated by a pan on the top handle. Gesture
 * math runs on the UI thread; the anchor is committed to React on end.
 */
function AnchorPicker({
  uri,
  imageSize,
  onImageSize,
  anchor,
  onChange,
  onCommit,
  accent,
}: {
  uri: string;
  imageSize: { w: number; h: number } | null;
  onImageSize: (s: { w: number; h: number }) => void;
  anchor: MouthAnchor;
  onChange: (a: MouthAnchor) => void;
  onCommit: (a: Required<MouthAnchor>) => void;
  accent: string;
}) {
  return (
    <SceneBox style={{ flex: 1 }}>
      {(box) => {
        const outer: Rect = { x: 0, y: 0, w: box.w, h: box.h };
        const painted = imageSize ? containRect(outer, imageSize.w / imageSize.h) : outer;
        return (
          <PickerCanvas
            uri={uri}
            painted={painted}
            onImageSize={onImageSize}
            anchor={anchor}
            onChange={onChange}
            onCommit={onCommit}
            accent={accent}
          />
        );
      }}
    </SceneBox>
  );
}

function PickerCanvas({
  uri,
  painted,
  onImageSize,
  anchor,
  onChange,
  onCommit,
  accent,
}: {
  uri: string;
  painted: Rect;
  onImageSize: (s: { w: number; h: number }) => void;
  anchor: MouthAnchor;
  onChange: (a: MouthAnchor) => void;
  onCommit: (a: Required<MouthAnchor>) => void;
  accent: string;
}) {
  const r = mouthRect(anchor, painted);
  const x = useSharedValue(r.x);
  const y = useSharedValue(r.y);
  const w = useSharedValue(r.w);
  const h = useSharedValue(r.h);
  const rot = useSharedValue(anchor.rotate ?? 0);
  // Keep the shared values in step with the committed anchor (chips, reset, relayout).
  React.useEffect(() => {
    x.value = withTiming(r.x, { duration: 80 });
    y.value = withTiming(r.y, { duration: 80 });
    w.value = withTiming(r.w, { duration: 80 });
    h.value = withTiming(r.h, { duration: 80 });
    rot.value = anchor.rotate ?? 0;
  }, [r.x, r.y, r.w, r.h, anchor.rotate, x, y, w, h, rot]);

  const commit = React.useCallback(
    (nx: number, ny: number, nw: number, nh: number, nr: number) => {
      const a = clampAnchor(anchorFromRect({ x: nx, y: ny, w: nw, h: nh }, painted, nr));
      const full = { ...a, rotate: nr } as Required<MouthAnchor>;
      onChange(full);
      onCommit(full);
    },
    [painted, onChange, onCommit],
  );

  const commitRef = React.useRef(commit);
  React.useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  const commitNow = React.useCallback(
    (nx: number, ny: number, nw: number, nh: number, nr: number) =>
      commitRef.current(nx, ny, nw, nh, nr),
    [],
  );

  const start = useSharedValue({ x: 0, y: 0, w: 0, h: 0, rot: 0 });
  // Gesture's .onX() methods register UI-thread worklets — the shared values
  // are written on touch, never during render or an effect (the token-text
  // pattern); the refs rule cannot see through the worklet boundary.
  // eslint-disable-next-line react-hooks/refs
  const [gestures] = React.useState(() => {
    const snapshot = () => {
      'worklet';
      start.value = { x: x.value, y: y.value, w: w.value, h: h.value, rot: rot.value };
    };
    const move = Gesture.Pan()
      .onStart(snapshot)
      .onUpdate((e) => {
        x.value = start.value.x + e.translationX;
        y.value = start.value.y + e.translationY;
      })
      .onEnd(() => {
        runOnJS(commitNow)(x.value, y.value, w.value, h.value, rot.value);
      });
    const resize = Gesture.Pan()
      .onStart(snapshot)
      .onUpdate((e) => {
        w.value = Math.max(8, start.value.w + e.translationX);
        h.value = Math.max(4, start.value.h + e.translationY);
      })
      .onEnd(() => {
        runOnJS(commitNow)(x.value, y.value, w.value, h.value, rot.value);
      });
    const rotate = Gesture.Pan()
      .onStart(snapshot)
      .onUpdate((e) => {
        rot.value = Math.max(-45, Math.min(45, start.value.rot + e.translationX * 0.25));
      })
      .onEnd(() => {
        runOnJS(commitNow)(x.value, y.value, w.value, h.value, Math.round(rot.value * 10) / 10);
      });
    return { move, resize, rotate };
  });
  const { move, resize, rotate } = gestures;

  const boxStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  return (
    <View style={{ flex: 1 }}>
      <Image
        source={{ uri }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        contentFit="contain"
        contentPosition="bottom center"
        onLoad={(e) => onImageSize({ w: e.source.width, h: e.source.height })}
        accessibilityIgnoresInvertColors
      />
      {/* Painted-rect outline so the fractions have a visible reference. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: painted.x,
          top: painted.y,
          width: painted.w,
          height: painted.h,
          borderWidth: 1,
          borderColor: `${accent}55`,
        }}
      />
      <GestureDetector gesture={move}>
        <Animated.View
          accessibilityLabel="anchor-box"
          style={[
            {
              position: 'absolute',
              borderWidth: 2,
              borderColor: accent,
              backgroundColor: `${accent}22`,
            },
            boxStyle,
          ]}
        >
          <GestureDetector gesture={rotate}>
            <View
              accessibilityLabel="anchor-rotate"
              style={{
                position: 'absolute',
                left: '50%',
                top: -26,
                marginLeft: -11,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: accent,
              }}
            />
          </GestureDetector>
          <GestureDetector gesture={resize}>
            <View
              accessibilityLabel="anchor-resize"
              style={{
                position: 'absolute',
                right: -12,
                bottom: -12,
                width: 24,
                height: 24,
                borderRadius: 4,
                backgroundColor: accent,
              }}
            />
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
