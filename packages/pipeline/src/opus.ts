import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

/**
 * Opus encoding + duration probing via ffmpeg/ffprobe (T09, design §8 step 3:
 * "~24–32 kbps voice = small files"). Both binaries must be on PATH; the
 * pipeline is a desktop tool, never app code.
 */

/** Voice-quality bitrate within the design §3.3 range. */
export const OPUS_BITRATE = '32k';

export function run(cmd: string, args: string[]): string {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${cmd} not found on PATH — install ffmpeg (brew install ffmpeg)`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status}):\n${res.stderr.slice(-800)}`);
  }
  return res.stdout;
}

/** Encode an audio file to mono Opus at voice bitrate. Overwrites `outPath`. */
export function encodeOpus(inPath: string, outPath: string): void {
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    '-c:a',
    'libopus',
    '-b:a',
    OPUS_BITRATE,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-application',
    'voip',
    outPath,
  ]);
}

/** Duration of an audio file in integer milliseconds (rounded down). */
export function probeDurationMs(path: string): number {
  const out = run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  const seconds = Number.parseFloat(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${path} (got "${out.trim()}")`);
  }
  return Math.floor(seconds * 1000);
}

/** Decode any audio file to mono 44.1 kHz 16-bit PCM WAV (exact, gap-free durations). */
export function decodeToWav(inPath: string, outPath: string): void {
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
    '44100',
    '-c:a',
    'pcm_s16le',
    outPath,
  ]);
}

export interface LoudnessStats {
  meanDb: number;
  maxDb: number;
}

/** Mean/peak level of a file via ffmpeg's volumedetect (dBFS). Digital silence → -91/-91. */
export function measureLoudness(path: string): LoudnessStats {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) throw res.error;
  const grab = (key: string): number => {
    const m = new RegExp(`${key}:\\s*(-?[\\d.]+|-inf)\\s*dB`).exec(res.stderr);
    if (!m) throw new Error(`volumedetect reported no ${key} for ${path}`);
    return m[1] === '-inf' ? -91 : Number.parseFloat(m[1]!);
  };
  return { meanDb: grab('mean_volume'), maxDb: grab('max_volume') };
}

/**
 * Concatenate audio runs (any decodable inputs, WAV preferred) into one MP3
 * at the provider's 44.1 kHz / 128 kbps shape, applying a per-run gain in dB
 * first. One ffmpeg invocation; sample-accurate joins.
 */
export function concatRunsToMp3(
  runs: readonly { file: string; gainDb: number }[],
  outPath: string,
): void {
  if (runs.length === 0) throw new Error('concatRunsToMp3: no runs');
  const inputs = runs.flatMap((r) => ['-i', r.file]);
  const gains = runs.map((r, i) => `[${i}:a]volume=${r.gainDb.toFixed(2)}dB[g${i}]`).join(';');
  const concat = `${runs.map((_, i) => `[g${i}]`).join('')}concat=n=${runs.length}:v=0:a=1[out]`;
  if (existsSync(outPath)) unlinkSync(outPath);
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${gains};${concat}`,
    '-map',
    '[out]',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    outPath,
  ]);
}

/** Fade length at every excision joint — long enough to kill clicks, too short to hear. */
const EXCISE_FADE_S = 0.006;

/**
 * Remove `[startMs, endMs)` ranges from a WAV (context narration that was
 * rendered for prosody and must never be heard), keeping the complementary
 * segments in order with a tiny fade at each joint. One ffmpeg invocation;
 * sample-accurate.
 */
export function exciseWav(
  inPath: string,
  outPath: string,
  cuts: readonly { startMs: number; endMs: number }[],
): void {
  const totalMs = probeDurationMs(inPath);
  const sorted = [...cuts].sort((a, b) => a.startMs - b.startMs);
  const keep: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.startMs > cursor) keep.push({ start: cursor, end: c.startMs });
    cursor = Math.max(cursor, c.endMs);
  }
  if (cursor < totalMs) keep.push({ start: cursor, end: totalMs });
  if (keep.length === 0) throw new Error('exciseWav: cuts cover the whole file');
  const seg = keep.map((k, i) => {
    const len = (k.end - k.start) / 1000;
    const fades = [
      i > 0 ? `afade=t=in:st=0:d=${EXCISE_FADE_S}` : null,
      i < keep.length - 1
        ? `afade=t=out:st=${Math.max(0, len - EXCISE_FADE_S).toFixed(4)}:d=${EXCISE_FADE_S}`
        : null,
    ]
      .filter((f): f is string => f !== null)
      .join(',');
    return `[0:a]atrim=start=${(k.start / 1000).toFixed(4)}:end=${(k.end / 1000).toFixed(4)},asetpts=PTS-STARTPTS${fades ? `,${fades}` : ''}[k${i}]`;
  });
  const concat = `${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[out]`;
  if (existsSync(outPath)) unlinkSync(outPath);
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    '-filter_complex',
    `${seg.join(';')};${concat}`,
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    outPath,
  ]);
}

/**
 * T115 score encode spec (AMBIENT_SOUNDTRACKS §11): the beds' loudness targets
 * (§4: I −26 LUFS, TP −2 dBTP, LRA 11) so the one ambient slider means the same
 * level for a bed and a score; 64 k stereo instead of the beds' 96 k because a
 * score ships per part over sync, not once in the APK.
 */
export const SCORE_BITRATE = '64k';
export const SCORE_TARGET_LUFS = -26;
export const SCORE_TARGET_TP = -2;
export const SCORE_TARGET_LRA = 11;

export interface LoudnormMeasure {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  offset: number;
}

/** Last `{...}` block in ffmpeg stderr — loudnorm prints its JSON after the progress lines. */
function lastJsonBlock(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`no loudnorm JSON in ffmpeg output:\n${stderr.slice(-800)}`);
  }
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

function ffmpegStderr(args: string[]): string {
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`ffmpeg ${args.join(' ')} failed (${res.status}):\n${res.stderr.slice(-800)}`);
  }
  return res.stderr;
}

/** loudnorm pass 1 against the score targets. */
export function measureLoudnorm(path: string): LoudnormMeasure {
  const stderr = ffmpegStderr([
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-af',
    `loudnorm=I=${SCORE_TARGET_LUFS}:TP=${SCORE_TARGET_TP}:LRA=${SCORE_TARGET_LRA}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  const m = lastJsonBlock(stderr);
  const num = (key: string): number => {
    const value = Number.parseFloat(m[key] ?? '');
    if (!Number.isFinite(value)) throw new Error(`loudnorm reported no ${key} for ${path}`);
    return value;
  };
  return {
    inputI: num('input_i'),
    inputTp: num('input_tp'),
    inputLra: num('input_lra'),
    inputThresh: num('input_thresh'),
    offset: num('target_offset'),
  };
}

/** Integrated loudness (LUFS) + true peak (dBTP) of a finished file via ebur128. */
export function measureEbur128(path: string): { lufs: number; truePeakDb: number } {
  const stderr = ffmpegStderr([
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const grab = (label: string): number => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)\\s*(?:LUFS|dBFS)`).exec(summary);
    if (!m) throw new Error(`ebur128 reported no ${label} for ${path}`);
    return m[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number.parseFloat(m[1]!);
  };
  return { lufs: grab('I'), truePeakDb: grab('Peak') };
}

/**
 * Encode a part-length score to Ogg Opus stereo 48 kHz 64 k VBR
 * (`-application audio`, 20 ms frames) with a two-pass linear `loudnorm` to
 * −26 LUFS / −2 dBTP. Overwrites `outPath`. Returns the pass-1 measurement.
 */
export function encodeScoreOpus(inPath: string, outPath: string): LoudnormMeasure {
  const m = measureLoudnorm(inPath);
  const loudnorm = [
    `I=${SCORE_TARGET_LUFS}`,
    `TP=${SCORE_TARGET_TP}`,
    `LRA=${SCORE_TARGET_LRA}`,
    `measured_I=${m.inputI}`,
    `measured_TP=${m.inputTp}`,
    `measured_LRA=${m.inputLra}`,
    `measured_thresh=${m.inputThresh}`,
    `offset=${m.offset}`,
    'linear=true',
  ].join(':');
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inPath,
    // loudnorm upsamples to 192 kHz internally; resample back before libopus.
    '-af',
    `loudnorm=${loudnorm},aresample=48000`,
    '-c:a',
    'libopus',
    '-b:a',
    SCORE_BITRATE,
    '-vbr',
    'on',
    '-application',
    'audio',
    '-frame_duration',
    '20',
    '-ac',
    '2',
    '-ar',
    '48000',
    outPath,
  ]);
  return m;
}
