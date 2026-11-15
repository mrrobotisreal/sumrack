import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import {
  SCORE_DURATION_SLACK_MS,
  StableIdSchema,
  safeParsePack,
  type Pack,
  type StoryScore,
} from '@sumrak/schema';
import { encodeScoreOpus, measureEbur128, probeDurationMs, run } from './opus.ts';

/**
 * `pipeline score` (T115, AMBIENT_SOUNDTRACKS §11): assemble each story
 * part's composed score from its Suno cues, in that part's narration-track
 * time, and write it as a SEPARATE stereo music file + `story.score`. The
 * score is never mixed into narration and never enters the stitched full
 * track — the app plays it through the ambient system in place of the bed.
 *
 * Assembly per story (all at 48 kHz stereo, sample-accurate):
 * 1. each cue is fitted to its slot — trimmed when long, slowed with `atempo`
 *    when short (≤ MAX_STRETCH, else a loud failure). A cue followed directly
 *    by another (end = next start) is fitted to its slot + CROSSFADE_MS: that
 *    tail is the fade-out half of an equal-power (qsin) crossfade that runs
 *    from the boundary for CROSSFADE_MS, so cue N+1's music time 0 sits exactly
 *    on its `startMs`;
 * 2. silence fills before the first cue and in any gap between cues (a cue
 *    next to a gap fades out / in over CROSSFADE_MS inside its own slot);
 * 3. FADE_IN_MS fade-in at 0, FADE_OUT_MS fade-out at the part end, padded or
 *    cut to exactly the narration track's `durationMs`;
 * 4. one two-pass loudnorm over the whole part (`encodeScoreOpus`) →
 *    `audio/<trackId>-score.opus`.
 */

export const CROSSFADE_MS = 2000;
export const FADE_IN_MS = 1000;
export const FADE_OUT_MS = 2500;
/** A short cue may be slowed by at most 4 %. */
export const MAX_STRETCH = 0.04;
/** Cue ends/starts this close are "the same boundary" (cue tables are 0.1 s). */
export const JOIN_TOLERANCE_MS = 50;
/** A cue's endMs may sit this far past the track end (table rounding); it is clamped. */
export const END_OVERHANG_MS = 1000;
/** Every slot must hold a full crossfade on each side. */
export const MIN_SLOT_MS = 2 * CROSSFADE_MS;
const RATE = 48000;

// ---------------------------------------------------------------------------
// The score sheet
// ---------------------------------------------------------------------------

export const ScoreCueSchema = z.strictObject({
  /** Cue audio (mp3/wav/…), relative to the sheet's `cueDir` (else the sheet's folder). */
  file: z.string().min(1),
  /** Slot start in the story's narration-track time, ms. */
  startMs: z.number().int().nonnegative(),
  /** Slot end in the narration-track time, ms (> startMs). */
  endMs: z.number().int().positive(),
});
export type ScoreCue = z.infer<typeof ScoreCueSchema>;

export const ScoreSheetSchema = z.strictObject({
  /** Must equal the pack's id when present (a guard against the wrong sheet). */
  packId: StableIdSchema.optional(),
  /** Folder holding the cue files, relative to the sheet file. Default: the sheet's folder. */
  cueDir: z.string().min(1).optional(),
  stories: z
    .array(
      z.strictObject({
        storyId: StableIdSchema,
        /** The narration track the cue times refer to. Default: the story's first track. */
        trackId: StableIdSchema.optional(),
        cues: z.array(ScoreCueSchema),
      }),
    )
    .min(1),
});
export type ScoreSheet = z.infer<typeof ScoreSheetSchema>;

export function loadScoreSheet(path: string): ScoreSheet {
  if (!existsSync(path)) throw new Error(`score sheet ${path} does not exist`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`score sheet ${path} is not JSON: ${e instanceof Error ? e.message : e}`);
  }
  const parsed = ScoreSheetSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`score sheet ${path} is invalid:\n${details}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// The pure plan
// ---------------------------------------------------------------------------

export interface PlannedCue {
  file: string;
  /** Slot in narration time (endMs clamped to the track end). */
  startMs: number;
  endMs: number;
  /** Source length, ms. */
  sourceMs: number;
  /** Length the cue is fitted to: slot + crossfade tail when chained into the next cue. */
  fitMs: number;
  /** atempo factor applied (1 = untouched; < 1 = slowed). */
  tempo: number;
  /** +% the cue was stretched (0 when trimmed). */
  stretchPct: number;
  /** Equal-power crossfade into the next cue (ms), 0 when not chained. */
  crossfadeOutMs: number;
  /** Fade-out inside the slot before a silent gap (ms), 0 otherwise. */
  gapFadeOutMs: number;
  /** Fade-in at the slot start after a silent gap (ms), 0 otherwise. */
  gapFadeInMs: number;
}

export type TimelinePiece = { kind: 'silence'; ms: number } | { kind: 'chain'; cues: number[] };

export interface ScorePlan {
  durationMs: number;
  cues: PlannedCue[];
  /** In order; their lengths sum to `durationMs` (crossfade overlaps already netted out). */
  timeline: TimelinePiece[];
  fadeInMs: number;
  fadeOutMs: number;
}

/**
 * Lay a story's cues against its narration (pure, throws on a bad sheet):
 * slots ordered, non-overlapping, ≥ MIN_SLOT_MS, inside the track; every
 * short cue within MAX_STRETCH.
 */
export function planScore(
  cues: readonly (ScoreCue & { sourceMs: number })[],
  durationMs: number,
  label = 'story',
): ScorePlan {
  if (cues.length === 0) throw new Error(`${label}: no cues`);
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  const slots = sorted.map((c, i) => {
    if (c.endMs <= c.startMs) {
      throw new Error(`${label} cue ${i + 1} (${c.file}): endMs ${c.endMs} ≤ startMs ${c.startMs}`);
    }
    if (c.endMs > durationMs + END_OVERHANG_MS) {
      throw new Error(
        `${label} cue ${i + 1} (${c.file}) ends at ${c.endMs}ms, past the narration's ${durationMs}ms`,
      );
    }
    if (c.startMs >= durationMs) {
      throw new Error(`${label} cue ${i + 1} (${c.file}) starts after the narration ends`);
    }
    return { ...c, endMs: Math.min(c.endMs, durationMs) };
  });
  // Snap near-equal boundaries together, refuse overlaps.
  for (let i = 0; i + 1 < slots.length; i++) {
    const a = slots[i]!;
    const b = slots[i + 1]!;
    if (Math.abs(a.endMs - b.startMs) <= JOIN_TOLERANCE_MS) b.startMs = a.endMs;
    else if (a.endMs > b.startMs) {
      throw new Error(
        `${label}: cue ${i + 1} (${a.file}) ends at ${a.endMs}ms, after cue ${i + 2} (${b.file}) starts at ${b.startMs}ms`,
      );
    }
  }
  // A slot running to within the tolerance of the track end owns the end.
  const last = slots[slots.length - 1]!;
  if (durationMs - last.endMs <= JOIN_TOLERANCE_MS) last.endMs = durationMs;

  const planned: PlannedCue[] = slots.map((s, i) => {
    const slotMs = s.endMs - s.startMs;
    if (slotMs < MIN_SLOT_MS) {
      throw new Error(`${label} cue ${i + 1} (${s.file}): slot ${slotMs}ms < ${MIN_SLOT_MS}ms`);
    }
    const next = slots[i + 1];
    const prev = slots[i - 1];
    const chainedOut = next !== undefined && next.startMs === s.endMs;
    const gapBefore = i === 0 ? s.startMs > 0 : prev!.endMs < s.startMs;
    const gapAfter = next === undefined ? s.endMs < durationMs : !chainedOut;
    const fitMs = slotMs + (chainedOut ? CROSSFADE_MS : 0);
    let tempo = 1;
    if (s.sourceMs < fitMs) {
      tempo = s.sourceMs / fitMs;
      const stretch = fitMs / s.sourceMs - 1;
      if (stretch > MAX_STRETCH + 1e-9) {
        throw new Error(
          `${label} cue ${i + 1} (${s.file}) is ${s.sourceMs}ms for a ${fitMs}ms fit (slot ${slotMs}ms${chainedOut ? ` + ${CROSSFADE_MS}ms crossfade` : ''}) — ` +
            `${(stretch * 100).toFixed(2)}% stretch exceeds ${MAX_STRETCH * 100}%; regenerate or re-cut the cue`,
        );
      }
    }
    return {
      file: s.file,
      startMs: s.startMs,
      endMs: s.endMs,
      sourceMs: s.sourceMs,
      fitMs,
      tempo,
      stretchPct: tempo < 1 ? (1 / tempo - 1) * 100 : 0,
      crossfadeOutMs: chainedOut ? CROSSFADE_MS : 0,
      gapFadeOutMs: gapAfter ? CROSSFADE_MS : 0,
      gapFadeInMs: gapBefore ? CROSSFADE_MS : 0,
    };
  });

  const timeline: TimelinePiece[] = [];
  let cursor = 0;
  let chain: number[] = [];
  planned.forEach((c, i) => {
    if (chain.length === 0) {
      if (c.startMs > cursor) timeline.push({ kind: 'silence', ms: c.startMs - cursor });
    }
    chain.push(i);
    if (c.crossfadeOutMs === 0) {
      timeline.push({ kind: 'chain', cues: chain });
      chain = [];
      cursor = c.endMs;
    }
  });
  if (cursor < durationMs) timeline.push({ kind: 'silence', ms: durationMs - cursor });

  return {
    durationMs,
    cues: planned,
    timeline,
    fadeInMs: Math.min(FADE_IN_MS, Math.floor(durationMs / 4)),
    fadeOutMs: Math.min(FADE_OUT_MS, Math.floor(durationMs / 4)),
  };
}

/** Length a timeline piece contributes (a chain nets out its crossfade overlaps). */
export function pieceMs(plan: ScorePlan, piece: TimelinePiece): number {
  if (piece.kind === 'silence') return piece.ms;
  return piece.cues.reduce((n, i) => n + plan.cues[i]!.fitMs - plan.cues[i]!.crossfadeOutMs, 0);
}

// ---------------------------------------------------------------------------
// ffmpeg assembly
// ---------------------------------------------------------------------------

const samples = (ms: number): number => Math.round((ms * RATE) / 1000);
const FMT = `aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=stereo`;

/** Decode one cue, fitted (atempo + trim/pad) to exactly `fitMs`, with its gap fades. */
function renderCue(src: string, c: PlannedCue, out: string): void {
  const n = samples(c.fitMs);
  const filters = [`aresample=${RATE}`, 'aformat=channel_layouts=stereo'];
  if (c.tempo < 1) filters.push(`atempo=${c.tempo.toFixed(6)}`);
  filters.push(`atrim=end_sample=${n}`, `apad=whole_len=${n}`, 'asetpts=PTS-STARTPTS');
  if (c.gapFadeInMs > 0) filters.push(`afade=t=in:st=0:d=${(c.gapFadeInMs / 1000).toFixed(3)}`);
  if (c.gapFadeOutMs > 0) {
    const st = (c.fitMs - c.gapFadeOutMs) / 1000;
    filters.push(`afade=t=out:st=${st.toFixed(3)}:d=${(c.gapFadeOutMs / 1000).toFixed(3)}`);
  }
  filters.push(FMT);
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    src,
    '-af',
    filters.join(','),
    '-c:a',
    'pcm_f32le',
    out,
  ]);
}

/** Assemble the whole part: silences + crossfaded chains, fades, exact length. */
function assemble(plan: ScorePlan, cueWavs: readonly string[], out: string): void {
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  let inputIdx = 0;
  plan.timeline.forEach((piece, p) => {
    if (piece.kind === 'silence') {
      chains.push(
        `anullsrc=r=${RATE}:cl=stereo,atrim=end_sample=${samples(piece.ms)},asetpts=PTS-STARTPTS,${FMT}[s${p}]`,
      );
      labels.push(`[s${p}]`);
      return;
    }
    let acc: string | undefined;
    piece.cues.forEach((ci, k) => {
      inputs.push('-i', cueWavs[ci]!);
      const lbl = `[i${inputIdx}]`;
      chains.push(`[${inputIdx}:a]${FMT}${lbl}`);
      inputIdx++;
      if (acc === undefined) acc = lbl;
      else {
        const prev = plan.cues[piece.cues[k - 1]!]!;
        const merged = `[x${p}_${k}]`;
        chains.push(
          `${acc}${lbl}acrossfade=ns=${samples(prev.crossfadeOutMs)}:c1=qsin:c2=qsin${merged}`,
        );
        acc = merged;
      }
    });
    labels.push(acc!);
  });
  const n = samples(plan.durationMs);
  const outSt = (plan.durationMs - plan.fadeOutMs) / 1000;
  const tail = [
    `${labels.join('')}concat=n=${labels.length}:v=0:a=1`,
    `atrim=end_sample=${n}`,
    `apad=whole_len=${n}`,
    `afade=t=in:st=0:d=${(plan.fadeInMs / 1000).toFixed(3)}`,
    `afade=t=out:st=${outSt.toFixed(3)}:d=${(plan.fadeOutMs / 1000).toFixed(3)}`,
  ].join(',');
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${[...chains, `${tail}[out]`].join(';')}`,
    '-map',
    '[out]',
    '-c:a',
    'pcm_f32le',
    out,
  ]);
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export interface ScoreOptions {
  /** Compute everything in a temp dir; write nothing to the pack dir. */
  dryRun?: boolean;
  /** Only (re)build these story ids; other stories keep whatever score they have. */
  stories?: string[];
}

export interface ScoreStoryResult {
  storyId: string;
  trackId: string;
  plan: ScorePlan;
  score: StoryScore;
  lufsBefore: number;
  lufsAfter: number;
  truePeakDb: number;
  bytes: number;
}

export interface ScoreResult {
  packId: string;
  version: number;
  dryRun: boolean;
  built: ScoreStoryResult[];
  /** Stories whose existing score was dropped because the sheet has no cues for them. */
  removed: string[];
  /** Stories left without a score (no cues). */
  unscored: string[];
}

export function runScore(packDir: string, sheetPath: string, opts: ScoreOptions = {}): ScoreResult {
  const packFile = join(packDir, 'pack.json');
  if (!existsSync(packFile)) throw new Error(`${packFile} does not exist`);
  const raw = JSON.parse(readFileSync(packFile, 'utf8')) as Record<string, unknown> & {
    stories: Record<string, unknown>[];
  };
  const parsed = safeParsePack(raw);
  if (!parsed.success) {
    const details = parsed.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`${packFile} is not a valid pack:\n${details}`);
  }
  const pack: Pack = parsed.data;
  const sheet = loadScoreSheet(sheetPath);
  if (sheet.packId !== undefined && sheet.packId !== pack.id) {
    throw new Error(`score sheet is for "${sheet.packId}", the pack is "${pack.id}"`);
  }
  const sheetDir = dirname(resolve(sheetPath));
  const cueRoot = sheet.cueDir
    ? isAbsolute(sheet.cueDir)
      ? sheet.cueDir
      : join(sheetDir, sheet.cueDir)
    : sheetDir;
  const cueAbs = (f: string) => (isAbsolute(f) ? f : join(cueRoot, f));

  const seen = new Set<string>();
  for (const s of sheet.stories) {
    if (seen.has(s.storyId)) throw new Error(`score sheet lists story "${s.storyId}" twice`);
    seen.add(s.storyId);
    if (!pack.stories.some((p) => p.id === s.storyId)) {
      throw new Error(`score sheet names story "${s.storyId}", which is not in ${pack.id}`);
    }
  }
  const only = opts.stories ? new Set(opts.stories) : undefined;
  if (only) {
    for (const id of only) {
      if (!pack.stories.some((p) => p.id === id)) throw new Error(`--stories: no story "${id}"`);
    }
  }

  // Resolve + plan every story first (cheap: ffprobe only) so a bad sheet fails before encoding.
  const jobs = sheet.stories
    .filter((s) => s.cues.length > 0 && (!only || only.has(s.storyId)))
    .map((s) => {
      const story = pack.stories.find((p) => p.id === s.storyId)!;
      const track = s.trackId ? story.audio.find((t) => t.id === s.trackId) : story.audio[0];
      if (!track) {
        throw new Error(
          s.trackId
            ? `story "${story.id}" has no track "${s.trackId}"`
            : `story "${story.id}" has no audio track — render narration before scoring`,
        );
      }
      const cues = s.cues.map((c) => {
        const abs = cueAbs(c.file);
        if (!existsSync(abs)) throw new Error(`story "${story.id}": cue file missing: ${abs}`);
        return { ...c, abs, sourceMs: probeDurationMs(abs) };
      });
      const plan = planScore(cues, track.durationMs, `story "${story.id}"`);
      const absByFile = new Map(cues.map((c) => [c.file, c.abs]));
      return { story, track, plan, absByFile };
    });

  const work = mkdtempSync(join(tmpdir(), 'sumrak-score-'));
  try {
    const built: ScoreStoryResult[] = [];
    for (const { story, track, plan, absByFile } of jobs) {
      const cueWavs = plan.cues.map((c, i) => {
        const wav = join(work, `${story.id}-cue-${i}.wav`);
        renderCue(absByFile.get(c.file)!, c, wav);
        return wav;
      });
      const partWav = join(work, `${story.id}-part.wav`);
      assemble(plan, cueWavs, partWav);
      const rel = `audio/${track.id}-score.opus`;
      const outPath = opts.dryRun ? join(work, `${track.id}-score.opus`) : join(packDir, rel);
      if (!opts.dryRun) mkdirSync(join(packDir, 'audio'), { recursive: true });
      const measured = encodeScoreOpus(partWav, outPath);
      const after = measureEbur128(outPath);
      const durationMs = probeDurationMs(outPath);
      if (Math.abs(durationMs - track.durationMs) > SCORE_DURATION_SLACK_MS) {
        throw new Error(
          `story "${story.id}": encoded score is ${durationMs}ms, narration is ${track.durationMs}ms (> ${SCORE_DURATION_SLACK_MS}ms apart)`,
        );
      }
      built.push({
        storyId: story.id,
        trackId: track.id,
        plan,
        score: { id: `${track.id}-score`, file: rel, durationMs, trackId: track.id },
        lufsBefore: measured.inputI,
        lufsAfter: after.lufs,
        truePeakDb: after.truePeakDb,
        bytes: statSync(outPath).size,
      });
      for (const w of [...cueWavs, partWav]) rmSync(w, { force: true });
    }

    const byId = new Map(built.map((b) => [b.storyId, b.score]));
    const sheetWithCues = new Set(
      sheet.stories.filter((s) => s.cues.length > 0).map((s) => s.storyId),
    );
    const removed: string[] = [];
    const unscored: string[] = [];
    const stories = raw.stories.map((s) => {
      const id = s.id as string;
      const fresh = byId.get(id);
      if (fresh) return { ...s, score: fresh };
      if (only && !only.has(id)) {
        if (s.score === undefined) unscored.push(id);
        return s;
      }
      if (!sheetWithCues.has(id)) {
        unscored.push(id);
        if (s.score !== undefined) {
          removed.push(id);
          const { score: _drop, ...rest } = s;
          return rest;
        }
      }
      return s;
    });
    const next = { ...raw, stories };
    const recheck = safeParsePack(next);
    if (!recheck.success) {
      const details = recheck.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
      throw new Error(`scored pack.json would be invalid:\n${details}`);
    }
    if (!opts.dryRun) writeFileSync(packFile, `${JSON.stringify(next, null, 2)}\n`);
    return {
      packId: pack.id,
      version: pack.version,
      dryRun: opts.dryRun === true,
      built,
      removed,
      unscored,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Human-readable per-story table for the CLI. */
export function formatScoreTable(r: ScoreResult): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const lines = [
    `${r.dryRun ? 'plan (dry run, nothing written)' : 'scored'} ${r.packId} v${r.version} (version not bumped): ${r.built.length} part score(s)`,
    `  story          cues  narration  stretch max  LUFS in → out   TP     bytes      kB/min`,
  ];
  let totalBytes = 0;
  let totalMs = 0;
  for (const b of r.built) {
    const maxStretch = Math.max(...b.plan.cues.map((c) => c.stretchPct));
    const kbMin = b.bytes / 1024 / (b.score.durationMs / 60000);
    totalBytes += b.bytes;
    totalMs += b.score.durationMs;
    lines.push(
      `  ${b.storyId.padEnd(14)} ${String(b.plan.cues.length).padStart(4)}  ${s(b.score.durationMs).padStart(9)}  ${`${maxStretch.toFixed(2)}%`.padStart(11)}  ${b.lufsBefore.toFixed(1).padStart(6)} → ${b.lufsAfter.toFixed(1).padStart(5)}  ${b.truePeakDb.toFixed(1).padStart(5)}  ${String(b.bytes).padStart(9)}  ${kbMin.toFixed(0).padStart(6)}`,
    );
    for (const c of b.plan.cues) {
      lines.push(
        `      ${c.file.padEnd(28)} ${s(c.startMs).padStart(7)} → ${s(c.endMs).padStart(7)}  src ${s(c.sourceMs).padStart(7)}  fit ${s(c.fitMs).padStart(7)}  ${c.stretchPct > 0 ? `+${c.stretchPct.toFixed(2)}%` : 'trim'}${c.crossfadeOutMs ? `  ×${c.crossfadeOutMs / 1000}s` : ''}`,
      );
    }
  }
  if (r.built.length > 0) {
    lines.push(
      `  total ${(totalBytes / (1024 * 1024)).toFixed(2)} MB for ${(totalMs / 60000).toFixed(1)} min = ${(totalBytes / 1024 / (totalMs / 60000)).toFixed(0)} kB/min`,
    );
  }
  if (r.unscored.length > 0) lines.push(`  unscored: ${r.unscored.join(', ')}`);
  if (r.removed.length > 0)
    lines.push(`  score REMOVED (no cues in the sheet): ${r.removed.join(', ')}`);
  return lines.join('\n');
}

/**
 * `pipeline validate` score check: every `story.score.file` exists next to
 * the pack and its probed length is within SCORE_DURATION_SLACK_MS of
 * `score.durationMs`. Returns issue strings (empty = fine).
 */
export function scoreFileIssues(pack: Pick<Pack, 'stories'>, packDir: string): string[] {
  const issues: string[] = [];
  for (const story of pack.stories) {
    const score = story.score;
    if (!score) continue;
    const abs = join(packDir, score.file);
    if (!existsSync(abs)) {
      issues.push(`stories.${story.id}.score.file: ${score.file} does not exist`);
      continue;
    }
    const probed = probeDurationMs(abs);
    if (Math.abs(probed - score.durationMs) > SCORE_DURATION_SLACK_MS) {
      issues.push(
        `stories.${story.id}.score.durationMs: file probes ${probed}ms, pack says ${score.durationMs}ms`,
      );
    }
  }
  return issues;
}

/** `pipeline validate`'s «Scores» line: N of M parts scored. */
export function scoreLine(pack: Pick<Pack, 'stories'>): string {
  const scored = pack.stories.filter((s) => s.score).length;
  return `  Scores: ${scored}/${pack.stories.length} parts scored`;
}
