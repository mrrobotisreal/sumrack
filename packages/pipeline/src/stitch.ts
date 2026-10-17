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
import { join } from 'node:path';
import {
  safeParsePack,
  type AudioTrack,
  type FullStory,
  type Pack,
  type Story,
} from '@sumrak/schema';
import { encodeOpus, probeDurationMs, run } from './opus.ts';

/**
 * `pipeline stitch` (T94, FULL_STORY_LISTEN §6): build the pack-level
 * continuous narration of a `stories` pack — every part's chosen track
 * decoded to 48 kHz mono PCM, joined with a fixed silence between parts, and
 * encoded once through the shared `encodeOpus` — plus the segment map the app
 * needs to know which part is playing. Idempotent: re-running overwrites the
 * file and the `fullStory` field.
 */

/** Silence between parts: one breath; the parts already end/start in silence. */
export const DEFAULT_GAP_MS = 1200;
/** The decode/gap sample rate — the parts are 48 kHz Opus; never resample twice. */
const SAMPLE_RATE = 48000;
/** The segment map may end this far past the encoded file (encoder padding), no further. */
const DURATION_SLACK_MS = 20;
/** Cover budget (app downloads it over mobile data) and the JPEG quality ladder. */
export const COVER_MAX_BYTES = 400_000;
const COVER_QUALITIES = [4, 5, 6, 7, 8];

export interface StitchOptions {
  gapMs?: number;
  /** Prefer tracks of this `style`; default the first track of each story. */
  trackStyle?: string;
  /** Source image (PNG/JPEG, any size) to squeeze into `cover/cover.jpg`. */
  coverSource?: string;
  /** Increment `pack.version` by 1. */
  bump?: boolean;
  /** Print-only: compute everything in a temp dir, write nothing to the pack dir. */
  dryRun?: boolean;
}

export interface StitchSegment {
  storyId: string;
  trackId: string;
  startMs: number;
  endMs: number;
}

export interface StitchResult {
  packId: string;
  fullStory: FullStory;
  /** The exact per-part lengths (ms) behind the segment map. */
  lengthsMs: number[];
  coverBytes?: number;
  version: number;
  dryRun: boolean;
}

/** The track to stitch for a story: first one, or the first whose style matches. */
export function chooseTrack(story: Pick<Story, 'id' | 'audio'>, style?: string): AudioTrack {
  if (story.audio.length === 0) {
    throw new Error(`story "${story.id}" has no audio track — render it before stitching`);
  }
  if (style === undefined) return story.audio[0]!;
  const hit = story.audio.find((t) => t.style === style);
  if (!hit) {
    const have = story.audio.map((t) => t.style).join(', ');
    throw new Error(`story "${story.id}" has no track with style "${style}" (has: ${have})`);
  }
  return hit;
}

/** `start_i = Σ_{j<i}(len_j + gap)`, `end_i = start_i + len_i`. */
export function segmentsFrom(
  lengthsMs: readonly number[],
  gapMs: number,
): { startMs: number; endMs: number }[] {
  let cursor = 0;
  return lengthsMs.map((len) => {
    const seg = { startMs: cursor, endMs: cursor + len };
    cursor = seg.endMs + gapMs;
    return seg;
  });
}

/** Exact length of a PCM WAV in ms (samples ÷ rate, floored). */
export function wavLengthMs(wavPath: string): number {
  const out = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=duration_ts,sample_rate',
    '-of',
    'json',
    wavPath,
  ]);
  const stream = (JSON.parse(out) as { streams?: { duration_ts?: number; sample_rate?: string }[] })
    .streams?.[0];
  const samples = Number(stream?.duration_ts);
  const rate = Number(stream?.sample_rate);
  if (!Number.isFinite(samples) || !Number.isFinite(rate) || samples <= 0 || rate <= 0) {
    throw new Error(`ffprobe reported no sample count for ${wavPath}`);
  }
  return Math.floor((samples * 1000) / rate);
}

/** Decode any audio to 48 kHz mono s16 WAV (same shape as `decodeToWav`, at the parts' own rate). */
function decodeTo48kWav(inPath: string, outPath: string): void {
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    outPath,
  ]);
}

/** Join WAV parts with `gapMs` of silence between each, into one WAV (sample-accurate). */
function concatWithGaps(wavs: readonly string[], gapMs: number, outPath: string): void {
  const fmt = `aformat=sample_fmts=s16:sample_rates=${SAMPLE_RATE}:channel_layouts=mono`;
  const gapS = (gapMs / 1000).toFixed(6);
  const chains: string[] = [];
  const labels: string[] = [];
  wavs.forEach((_, i) => {
    chains.push(`[${i}:a]${fmt}[p${i}]`);
    labels.push(`[p${i}]`);
    if (i < wavs.length - 1) {
      chains.push(
        `anullsrc=r=${SAMPLE_RATE}:cl=mono,atrim=0:${gapS},asetpts=PTS-STARTPTS,${fmt}[g${i}]`,
      );
      labels.push(`[g${i}]`);
    }
  });
  const concat = `${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`;
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...wavs.flatMap((w) => ['-i', w]),
    '-filter_complex',
    `${chains.join(';')};${concat}`,
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    outPath,
  ]);
}

/** Squeeze any image into a 1024² JPEG ≤ COVER_MAX_BYTES, stepping quality down. Returns the byte size. */
export function buildCover(source: string, outPath: string): number {
  mkdirSync(join(outPath, '..'), { recursive: true });
  for (const q of COVER_QUALITIES) {
    run('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      source,
      '-vf',
      'scale=1024:1024:flags=lanczos',
      '-frames:v',
      '1',
      '-q:v',
      String(q),
      outPath,
    ]);
    const size = statSync(outPath).size;
    if (size <= COVER_MAX_BYTES) return size;
  }
  rmSync(outPath, { force: true });
  throw new Error(
    `cover ${source} stays above ${COVER_MAX_BYTES} bytes even at -q:v ${COVER_QUALITIES.at(-1)} — use a simpler image`,
  );
}

export function runStitch(packDir: string, opts: StitchOptions = {}): StitchResult {
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
  if (!Number.isInteger(gapMs) || gapMs < 0) throw new Error(`--gap-ms must be a whole number ≥ 0`);
  const packFile = join(packDir, 'pack.json');
  if (!existsSync(packFile)) throw new Error(`${packFile} does not exist`);
  const raw = JSON.parse(readFileSync(packFile, 'utf8')) as Record<string, unknown>;
  const parsed = safeParsePack(raw);
  if (!parsed.success) {
    const details = parsed.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`${packFile} is not a valid pack:\n${details}`);
  }
  const pack: Pack = parsed.data;
  if (pack.type !== 'stories') {
    throw new Error(`stitch needs a "stories" pack, ${pack.id} is "${pack.type}"`);
  }
  const chosen = pack.stories.map((s) => ({ story: s, track: chooseTrack(s, opts.trackStyle) }));
  for (const { track } of chosen) {
    if (!existsSync(join(packDir, track.file))) {
      throw new Error(`audio file missing: ${track.file}`);
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'sumrak-stitch-'));
  try {
    const wavs = chosen.map(({ track }, i) => {
      const wav = join(work, `part-${i}.wav`);
      decodeTo48kWav(join(packDir, track.file), wav);
      return wav;
    });
    const lengthsMs = wavs.map(wavLengthMs);
    const joined = join(work, 'full.wav');
    concatWithGaps(wavs, gapMs, joined);
    const fullRel = `audio/${pack.id}-full.opus`;
    const opusOut = opts.dryRun ? join(work, 'full.opus') : join(packDir, fullRel);
    if (!opts.dryRun) mkdirSync(join(packDir, 'audio'), { recursive: true });
    encodeOpus(joined, opusOut);
    const durationMs = probeDurationMs(opusOut);

    const segs = segmentsFrom(lengthsMs, gapMs);
    const last = segs[segs.length - 1]!;
    if (last.endMs > durationMs + DURATION_SLACK_MS) {
      throw new Error(
        `segment map ends at ${last.endMs}ms but the stitched file is ${durationMs}ms — a part decoded wrong`,
      );
    }
    const fullStory: FullStory = {
      id: `${pack.id}-full`,
      voice: chosen[0]!.track.voice,
      style: 'full',
      file: fullRel,
      durationMs,
      gapMs,
      segments: segs.map((s, i) => ({
        storyId: chosen[i]!.story.id,
        trackId: chosen[i]!.track.id,
        ...s,
      })),
    };

    const next: Record<string, unknown> = { ...raw, fullStory };
    let coverBytes: number | undefined;
    if (opts.coverSource !== undefined) {
      const coverOut = opts.dryRun ? join(work, 'cover.jpg') : join(packDir, 'cover', 'cover.jpg');
      coverBytes = buildCover(opts.coverSource, coverOut);
      next.cover = 'cover/cover.jpg';
    }
    if (opts.bump) next.version = pack.version + 1;

    const recheck = safeParsePack(next);
    if (!recheck.success) {
      const details = recheck.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
      throw new Error(`stitched pack.json would be invalid:\n${details}`);
    }
    if (!opts.dryRun) writeFileSync(packFile, `${JSON.stringify(next, null, 2)}\n`);
    return {
      packId: pack.id,
      fullStory,
      lengthsMs,
      ...(coverBytes !== undefined ? { coverBytes } : {}),
      version: recheck.data.version,
      dryRun: opts.dryRun === true,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Human-readable plan/result table for the CLI. */
export function formatStitchTable(r: StitchResult): string {
  const f = r.fullStory;
  const fmt = (ms: number) => `${(ms / 1000).toFixed(3)}s`;
  const rows = f.segments.map(
    (s, i) =>
      `  ${String(i + 1).padStart(2)}  ${s.storyId.padEnd(24)} ${s.trackId.padEnd(28)} ${fmt(s.startMs).padStart(10)} → ${fmt(s.endMs).padStart(10)}  (${fmt(r.lengthsMs[i]!)})`,
  );
  return [
    `${r.dryRun ? 'plan' : 'stitched'} ${r.packId} v${r.version}: ${f.segments.length} parts, gap ${f.gapMs} ms, ${fmt(f.durationMs)} → ${f.file} (voice ${f.voice})`,
    ...rows,
    ...(r.coverBytes !== undefined ? [`  cover/cover.jpg ${r.coverBytes} bytes`] : []),
  ].join('\n');
}
