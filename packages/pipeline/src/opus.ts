import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';

/**
 * Opus encoding + duration probing via ffmpeg/ffprobe (T09, design §8 step 3:
 * "~24–32 kbps voice = small files"). Both binaries must be on PATH; the
 * pipeline is a desktop tool, never app code.
 */

/** Voice-quality bitrate within the design §3.3 range. */
export const OPUS_BITRATE = '32k';

function run(cmd: string, args: string[]): string {
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
    '128k',
    '-ar',
    '44100',
    outPath,
  ]);
}
