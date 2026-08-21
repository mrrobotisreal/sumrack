import { spawnSync } from 'node:child_process';

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
