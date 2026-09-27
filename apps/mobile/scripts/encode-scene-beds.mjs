/**
 * Encodes the scenario room-tone masters into the app's bundled scene beds
 * (M17 / T61, design SPEAKING_SCENARIOS §8.4) — the M15 encoder's twin with
 * a quieter target (beds sit UNDER speech):
 *
 *   pnpm --filter sumrak-mobile encode:scene [--src <dir>] [--out <dir>]
 *        [--bitrate 64k] [--target-lufs -32] [--force]
 *
 * Per bed: measure (loudnorm pass 1) → normalise + encode (loudnorm pass 2,
 * linear, then aresample=48000 → libopus VBR stereo) → re-measure (ebur128)
 * → ledger row in `<out>/beds.json`. A bed whose source sha256 already sits
 * in the ledger is skipped unless `--force`.
 *
 * Masters are Mitch's CC0 room tones under the workspace-root
 * `assets/audio/scene/<slug>.<ext>` (one file per slug of the table below;
 * a missing master is SKIPPED with a note — the registry ships whatever
 * exists, `none` only when nothing does). `features/scenario/scene/beds.ts`
 * + `bed-sources.ts` (hand-written, literal `require()`s) are reconciled
 * against the ledger by `scene-beds.test.ts`. ffmpeg/ffprobe from PATH.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Slug → title; the master is `<slug>.(wav|flac|mp3|ogg|opus)` in `--src`. */
const BEDS = [
  ['studio', 'Studio'],
  ['clinic', 'Clinic'],
  ['bank', 'Bank'],
  ['forecourt', 'Forecourt'],
  ['station', 'Station'],
  ['night-shop', 'Night Shop'],
];

const MASTER_EXTS = ['.wav', '.flac', '.mp3', '.ogg', '.opus', '.m4a'];
/** Loopable room tones: 45–90 s (§8.4). */
const MIN_DURATION_MS = 45_000;
const MAX_DURATION_MS = 90_000;

const LOUDNORM_TP = -2;
const LOUDNORM_LRA = 11;
const SAMPLE_RATE = 48000;

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    src: resolve(mobileRoot, '../../../assets/audio/scene'),
    out: resolve(mobileRoot, 'assets/audio/scene'),
    bitrate: '64k',
    targetLufs: -32,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--src') opts.src = resolve(next());
    else if (arg === '--out') opts.out = resolve(next());
    else if (arg === '--bitrate') opts.bitrate = next();
    else if (arg === '--target-lufs') opts.targetLufs = Number.parseFloat(next());
    else if (arg === '--force') opts.force = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isFinite(opts.targetLufs)) throw new Error('--target-lufs must be a number');
  return opts;
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      throw new Error(`${cmd} not found on PATH — install ffmpeg (brew install ffmpeg)`);
    }
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${res.status}):\n${res.stderr.slice(-800)}`);
  }
  return res;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Last `{...}` block in stderr — ffmpeg prints loudnorm's JSON after the progress lines. */
function lastJsonBlock(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start)
    throw new Error(`no loudnorm JSON in ffmpeg output:\n${stderr.slice(-800)}`);
  return JSON.parse(stderr.slice(start, end + 1));
}

function measure(path, targetLufs) {
  const res = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-af',
    `loudnorm=I=${targetLufs}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  const m = lastJsonBlock(res.stderr);
  const num = (key) => {
    const value = Number.parseFloat(m[key]);
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

function encode(src, out, measured, opts) {
  const loudnorm = [
    `I=${opts.targetLufs}`,
    `TP=${LOUDNORM_TP}`,
    `LRA=${LOUDNORM_LRA}`,
    `measured_I=${measured.inputI}`,
    `measured_TP=${measured.inputTp}`,
    `measured_LRA=${measured.inputLra}`,
    `measured_thresh=${measured.inputThresh}`,
    `offset=${measured.offset}`,
    'linear=true',
  ].join(':');
  run('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    src,
    // loudnorm upsamples to 192 kHz internally; resample back before libopus.
    '-af',
    `loudnorm=${loudnorm},aresample=${SAMPLE_RATE}`,
    '-c:a',
    'libopus',
    '-b:a',
    opts.bitrate,
    '-vbr',
    'on',
    '-application',
    'audio',
    '-frame_duration',
    '20',
    '-ac',
    '2',
    '-ar',
    String(SAMPLE_RATE),
    out,
  ]);
}

/** Integrated loudness (LUFS) + true peak (dBTP) of a finished file via ebur128. */
function remeasure(path) {
  const res = run('ffmpeg', [
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
  const summary = res.stderr.slice(res.stderr.lastIndexOf('Summary:'));
  const grab = (label) => {
    const m = new RegExp(`${label}:\\s*(-?[\\d.]+|-inf)\\s*(?:LUFS|dBFS)`).exec(summary);
    if (!m) throw new Error(`ebur128 reported no ${label} for ${path}`);
    return m[1] === '-inf' ? -Infinity : Number.parseFloat(m[1]);
  };
  return { lufs: grab('I'), truePeakDb: grab('Peak') };
}

function probe(path) {
  const out = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels:format=duration',
    '-of',
    'json',
    path,
  ]).stdout;
  const parsed = JSON.parse(out);
  const stream = parsed.streams?.[0] ?? {};
  const seconds = Number.parseFloat(parsed.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${path}`);
  }
  return {
    durationMs: Math.round(seconds * 1000),
    codec: stream.codec_name,
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
  };
}

function loadLedger(path) {
  if (!existsSync(path)) return [];
  const rows = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(rows)) throw new Error(`${path} is not a JSON array — delete it and rerun`);
  return rows;
}

function findMaster(dir, slug) {
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  for (const ext of MASTER_EXTS) {
    const hit = names.find((n) => n.toLowerCase() === `${slug}${ext}`);
    if (hit) return join(dir, hit);
  }
  return null;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  run('ffmpeg', ['-version']);
  run('ffprobe', ['-version']);
  mkdirSync(opts.out, { recursive: true });

  const ledgerPath = join(opts.out, 'beds.json');
  const previous = new Map(loadLedger(ledgerPath).map((row) => [row.slug, row]));
  const rows = [];
  const report = [];
  const missing = [];

  for (const [slug, title] of BEDS) {
    const src = findMaster(opts.src, slug);
    if (!src) {
      missing.push(slug);
      continue;
    }
    const sourceFile = basename(src);
    const file = `${slug}.opus`;
    const outPath = join(opts.out, file);
    const sourceSha256 = sha256(src);
    const old = previous.get(slug);
    const reusable =
      !opts.force &&
      old !== undefined &&
      old.sourceSha256 === sourceSha256 &&
      old.file === file &&
      existsSync(outPath);
    if (reusable) {
      rows.push({ ...old, title });
      report.push({
        bed: file,
        status: 'skipped',
        durationMs: old.durationMs,
        bytes: old.bytes,
        inLufs: old.sourceLufs,
        outLufs: old.lufs,
        truePeakDb: old.truePeakDb,
      });
      continue;
    }

    process.stdout.write(`encoding ${file} …\n`);
    const measured = measure(src, opts.targetLufs);
    encode(src, outPath, measured, opts);
    const probed = probe(outPath);
    const level = remeasure(outPath);
    if (probed.codec !== 'opus' || probed.sampleRate !== SAMPLE_RATE || probed.channels !== 2) {
      throw new Error(
        `${file}: expected opus/48000/2ch, got ${probed.codec}/${probed.sampleRate}/${probed.channels}ch`,
      );
    }
    if (Math.abs(level.lufs - opts.targetLufs) > 1) {
      throw new Error(
        `${file}: integrated loudness ${level.lufs} LUFS is not within ±1 of ${opts.targetLufs}`,
      );
    }
    if (level.truePeakDb > LOUDNORM_TP + 0.1) {
      throw new Error(`${file}: true peak ${level.truePeakDb} dBTP exceeds ${LOUDNORM_TP}`);
    }
    if (probed.durationMs < MIN_DURATION_MS || probed.durationMs > MAX_DURATION_MS) {
      throw new Error(
        `${file}: ${probed.durationMs} ms is outside the loopable 45–90 s band (§8.4) — trim the master`,
      );
    }
    const sourceDurationMs = probe(src).durationMs;
    if (Math.abs(sourceDurationMs - probed.durationMs) > 50) {
      throw new Error(
        `${file}: duration ${probed.durationMs} ms differs from master ${sourceDurationMs} ms by > 50 ms`,
      );
    }
    const bytes = statSync(outPath).size;
    rows.push({
      slug,
      title,
      file,
      sourceFile,
      sourceSha256,
      sourceLufs: measured.inputI,
      durationMs: probed.durationMs,
      bytes,
      lufs: level.lufs,
      truePeakDb: level.truePeakDb,
    });
    report.push({
      bed: file,
      status: 'encoded',
      durationMs: probed.durationMs,
      bytes,
      inLufs: measured.inputI,
      outLufs: level.lufs,
      truePeakDb: level.truePeakDb,
    });
  }

  writeFileSync(ledgerPath, `${JSON.stringify(rows, null, 2)}\n`);

  const mmss = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const mb = (b) => `${(b / 1_000_000).toFixed(2)} MB`;
  const lu = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');
  if (report.length > 0) {
    console.table(
      report.map((r) => ({
        bed: r.bed,
        status: r.status,
        duration: mmss(r.durationMs),
        size: mb(r.bytes),
        'in LUFS': lu(r.inLufs),
        'out LUFS': lu(r.outLufs),
        'TP dBTP': lu(r.truePeakDb),
      })),
    );
  }
  const total = report.reduce((sum, r) => sum + r.bytes, 0);
  const encoded = report.filter((r) => r.status === 'encoded').length;
  console.log(
    `${report.length} beds (${encoded} encoded, ${report.length - encoded} skipped) · ${mb(total)} total · ledger ${ledgerPath}`,
  );
  if (missing.length > 0) {
    console.log(
      `no master for: ${missing.join(', ')} — drop \`<slug>.wav\` into ${opts.src} and rerun; the app plays silence for these slugs.`,
    );
  }
}

try {
  main();
} catch (error) {
  console.error(`encode-scene-beds: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
