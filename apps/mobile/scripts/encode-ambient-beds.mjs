/**
 * Encodes the themed study-soundtrack masters into the app's bundled,
 * loudness-matched Opus beds (M15 / T47, design AMBIENT_SOUNDTRACKS §4):
 *
 *   pnpm --filter sumrak-mobile encode:ambient [--src <dir>] [--out <dir>]
 *        [--bitrate 96k] [--target-lufs -26] [--force]
 *
 * Per bed: measure (loudnorm pass 1) → normalise + encode (loudnorm pass 2,
 * linear, then aresample=48000 → libopus 96 k stereo VBR) → re-measure
 * (ebur128) → ledger row in `<out>/beds.json`. A bed whose source sha256
 * already sits in the ledger is skipped unless `--force`.
 *
 * The theme → source table below mirrors AMBIENT_SOUNDTRACKS §3.3 and is
 * the only place the masters are named; `features/ambient-audio/beds.ts`
 * (hand-written, literal `require()`s) is reconciled against the ledger by
 * a unit test. Masters live outside the repo (workspace-root `assets/audio`).
 * ffmpeg/ffprobe come from PATH — `brew install ffmpeg`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Theme order = `AMBIENT_THEME_ORDER`; file order within a theme = rotation
 * order. An entry is a master file name, or `{ file, slug, title }` when the
 * slug (the persisted cursor key, design §5) should not follow the file name.
 */
const SOURCES = [
  [
    'horror',
    [{ file: 'creepy-bg-music-no-vocals.mp3', slug: 'creepy-bg-music', title: 'Creepy Bg Music' }],
  ],
  ['news', ['GlobalAffairsBriefing1.wav', 'GlobalAffairsBriefing2.wav']],
  ['comedy', ['ReturnToTheMotif1.wav', 'ReturnToTheMotif2.wav']],
  ['action', ['TacticalBreach1.wav', 'TacticalBreach2.wav']],
  [
    'education',
    [
      'MechanicalFocus1.wav',
      'MechanicalFocus2.wav',
      'LaboratoryGroove1.wav',
      'LaboratoryGroove2.wav',
    ],
  ],
];

const LOUDNORM_TP = -2;
const LOUDNORM_LRA = 11;
const SAMPLE_RATE = 48000;

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    src: resolve(mobileRoot, '../../../assets/audio'),
    out: resolve(mobileRoot, 'assets/audio/ambient'),
    bitrate: '96k',
    targetLufs: -26,
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

/** `GlobalAffairsBriefing1` → `global-affairs-briefing-1`. */
function slugOf(stem) {
  return stem
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** `GlobalAffairsBriefing1` → `Global Affairs Briefing 1`; `creepy-bg-music` → `Creepy Bg Music`. */
function titleOf(stem) {
  return slugOf(stem)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  run('ffmpeg', ['-version']);
  run('ffprobe', ['-version']);
  if (!existsSync(opts.src)) throw new Error(`masters directory not found: ${opts.src}`);

  const ledgerPath = join(opts.out, 'beds.json');
  const previous = new Map(loadLedger(ledgerPath).map((row) => [`${row.theme}/${row.slug}`, row]));
  const rows = [];
  const report = [];

  for (const [theme, files] of SOURCES) {
    mkdirSync(join(opts.out, theme), { recursive: true });
    files.forEach((entry, i) => {
      const sourceFile = typeof entry === 'string' ? entry : entry.file;
      const src = join(opts.src, sourceFile);
      if (!existsSync(src)) throw new Error(`missing master: ${src}`);
      const stem = basename(sourceFile, extname(sourceFile));
      const slug = typeof entry === 'string' ? slugOf(stem) : entry.slug;
      const title = typeof entry === 'string' ? titleOf(stem) : entry.title;
      const index = i + 1;
      const file = `${theme}/${String(index).padStart(2, '0')}-${slug}.opus`;
      const outPath = join(opts.out, file);
      const sourceSha256 = sha256(src);
      const old = previous.get(`${theme}/${slug}`);
      const reusable =
        !opts.force &&
        old !== undefined &&
        old.sourceSha256 === sourceSha256 &&
        old.file === file &&
        existsSync(outPath);
      if (reusable) {
        rows.push({ ...old, index, title });
        report.push({
          bed: file,
          status: 'skipped',
          durationMs: old.durationMs,
          bytes: old.bytes,
          inLufs: old.sourceLufs,
          outLufs: old.lufs,
          truePeakDb: old.truePeakDb,
        });
        return;
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
      const sourceDurationMs = probe(src).durationMs;
      if (Math.abs(sourceDurationMs - probed.durationMs) > 50) {
        throw new Error(
          `${file}: duration ${probed.durationMs} ms differs from master ${sourceDurationMs} ms by > 50 ms`,
        );
      }
      const bytes = statSync(outPath).size;
      rows.push({
        theme,
        index,
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
    });
  }

  writeFileSync(ledgerPath, `${JSON.stringify(rows, null, 2)}\n`);

  const mmss = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const mb = (b) => `${(b / 1_000_000).toFixed(2)} MB`;
  const lu = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');
  const table = report.map((r) => ({
    bed: r.bed,
    status: r.status,
    duration: mmss(r.durationMs),
    size: mb(r.bytes),
    'in LUFS': lu(r.inLufs),
    'out LUFS': lu(r.outLufs),
    'TP dBTP': lu(r.truePeakDb),
  }));
  console.table(table);
  const total = report.reduce((sum, r) => sum + r.bytes, 0);
  const encoded = report.filter((r) => r.status === 'encoded').length;
  console.log(
    `${report.length} beds (${encoded} encoded, ${report.length - encoded} skipped) · ${mb(total)} total · ledger ${ledgerPath}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`encode-ambient-beds: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
