/**
 * T64 Eleven v4 contract probe (untracked, like the scenario drivers). ≤ 10
 * cost-gated with-timestamps requests on one of Mitch's designed voices,
 * answering the ticket's (a)–(i). Every MP3 + a machine `metrics.json` land in
 * Stories/_build/_v4-probe/; the human verdict.json is written by the session
 * after the Whisper pass (/tmp/aud-scan.py). The key is loaded by the pipeline
 * and never printed.
 *
 * Usage (from packages/pipeline): env -u NODE_OPTIONS npx tsx _v4-probe.mts   (plan only)
 *                                 YES=1 env -u NODE_OPTIONS npx tsx _v4-probe.mts (spend)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ElevenLabsClient,
  ElevenLabsError,
  type RenderRequest,
  type RenderResult,
} from './src/elevenlabs.ts';
import { resolveEnvVar } from './src/env.ts';
import { RequestPacer } from './src/line-audio.ts';

const OUT = process.env.OUT ?? '/Users/mitchwintrow/Workspaces/Russian/Stories/_build/_v4-probe';
const VOICE = process.env.VOICE ?? 'Lietenant Gromov, Seasoned Russian Police Lieutenant';
const MODEL = 'eleven_v4';
const SEED = 20260928;
// One real host line (police A1 t02: the first question) — long enough to measure, short enough to be cheap.
const RU = 'Так. Слушаю вас. Что случилось? Говорите медленно и по порядку.';
const SHORT_TAG = '[serious, commanding, a low gravelly growl]';
const LONG_TAG =
  '[tired but alert after a long night shift, speaking slowly and deliberately, with a deep gravelly voice full of quiet authority]';

interface Probe {
  id: string;
  q: string;
  why: string;
  req: Omit<RenderRequest, 'voiceId'>;
}
const probes: Probe[] = [
  {
    id: '01-baseline',
    q: 'a,e',
    why: 'v4 accepted on with-timestamps? alignment returned? short tag span ≈ 0?',
    req: { text: `${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '02-seed-repeat',
    q: 'b',
    why: 'same request again — byte-identical / same duration ⇒ seed honoured',
    req: { text: `${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '03-lang-prev',
    q: 'c,d',
    why: 'language_code ru + previous_text on v4 — accepted or 4xx (the 422 detail names the field)',
    req: {
      text: `${SHORT_TAG} ${RU}`,
      modelId: MODEL,
      seed: SEED,
      languageCode: 'ru',
      previousText: 'Ночь. Дежурная часть. Лейтенант устал, но собран.',
    },
  },
  {
    id: '04-long-tag',
    q: 'f',
    why: '18-word tag — applied (span ≈ 0, transcript clean) or spoken aloud?',
    req: { text: `${LONG_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '05-sfx-door',
    q: 'g',
    why: 'in-tag sound effect before the line — rendered (tag span > 0, longer file)?',
    req: { text: `[a door slams] ${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '06-filter-old-radio',
    q: 'h',
    why: 'filter as a tag — spectral change vs baseline?',
    req: { text: `[old radio] ${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '07-space-small-room-near',
    q: 'h',
    why: 'space + distance as a tag',
    req: { text: `[small room, near] ${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '08-space-tunnel-far',
    q: 'h',
    why: 'reverberant space + far distance as a tag',
    req: { text: `[tunnel, far] ${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '09-noise-cafe',
    q: 'h',
    why: 'background noise as a tag — raised noise floor in the pauses?',
    req: { text: `[café noise] ${SHORT_TAG} ${RU}`, modelId: MODEL, seed: SEED },
  },
  {
    id: '10-voice-settings',
    q: 'i',
    why: 'stability/similarity/style/speed/speaker boost all sent — accepted?',
    req: {
      text: `${SHORT_TAG} ${RU}`,
      modelId: MODEL,
      seed: SEED,
      voiceSettings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0.2,
        speed: 0.95,
        useSpeakerBoost: true,
      },
    },
  },
];

const chars = probes.reduce((n, p) => n + p.req.text.length, 0);
console.log(
  `${probes.length} request(s) on ${MODEL}, voice «${VOICE}», ~${chars} chars, seed ${SEED} → ${OUT}`,
);
if (!process.env.YES) {
  console.log('dry run — set YES=1 to spend');
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const client = new ElevenLabsClient(
  resolveEnvVar('ELEVENLABS_API_KEY', '/Users/mitchwintrow/Workspaces/Russian/Sumrak')!,
);
const voiceId = await client.resolveVoiceId(VOICE);
const pacer = new RequestPacer();

function ff(args: string[]): string {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function stats(file: string) {
  let out = '';
  try {
    ff([
      '-i',
      file,
      '-af',
      'astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level+Noise_floor+RMS_trough,aspectralstats=measure=centroid+rolloff+flatness,ametadata=print:file=-',
      '-f',
      'null',
      '-',
    ]);
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? '');
  }
  // ametadata prints per-frame lines; average the spectral ones, read the overall astats from stderr
  const cent: number[] = [],
    roll: number[] = [],
    flat: number[] = [];
  for (const line of out.split('\n')) {
    const m = /lavfi\.aspectralstats\.1\.(centroid|rolloff|flatness)=([\d.eE+-]+)/.exec(line);
    if (m) (m[1] === 'centroid' ? cent : m[1] === 'rolloff' ? roll : flat).push(Number(m[2]));
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  let overall = '';
  try {
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-i',
        file,
        '-af',
        'astats=measure_perchannel=none:measure_overall=RMS_level+Peak_level+Noise_floor+RMS_trough',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    overall = String((e as { stderr?: string }).stderr ?? '');
  }
  const num = (k: string) => {
    const m = new RegExp(`${k}: ([\\-\\d.]+)`).exec(overall);
    return m ? Number(m[1]) : NaN;
  };
  const dur = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { encoding: 'utf8' },
    ).trim(),
  );
  return {
    durationS: +dur.toFixed(2),
    rmsDb: num('RMS level dB'),
    peakDb: num('Peak level dB'),
    noiseFloorDb: num('Noise floor dB'),
    rmsTroughDb: num('RMS trough dB'),
    centroidHz: Math.round(avg(cent)),
    rolloffHz: Math.round(avg(roll)),
    flatness: +avg(flat).toFixed(4),
  };
}
function tagSpans(text: string, al: RenderResult['alignment']) {
  if (!al) return null;
  const echoed = al.characters.join('');
  const spans: { tag: string; startS: number; endS: number; spanS: number }[] = [];
  const re = /\[[^\]]*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const i = echoed.indexOf(m[0]);
    if (i < 0) {
      spans.push({ tag: m[0], startS: NaN, endS: NaN, spanS: NaN });
      continue;
    }
    const s = al.startSeconds[i]!,
      e = al.endSeconds[i + m[0].length - 1]!;
    spans.push({
      tag: m[0],
      startS: +s.toFixed(3),
      endS: +e.toFixed(3),
      spanS: +(e - s).toFixed(3),
    });
  }
  const last = al.endSeconds[al.endSeconds.length - 1]!;
  const firstRu = echoed.indexOf('Так.');
  return {
    echoedEqualsInput: echoed === text,
    chars: al.characters.length,
    lastCharEndS: +last.toFixed(3),
    firstWordStartS: firstRu >= 0 ? +al.startSeconds[firstRu]!.toFixed(3) : NaN,
    spans,
  };
}

const results: Record<string, unknown>[] = [];
const bytes = new Map<string, Buffer>();
for (const p of probes) {
  await pacer.next();
  const t0 = Date.now();
  let row: Record<string, unknown> = {
    id: p.id,
    q: p.q,
    why: p.why,
    text: p.req.text,
    request: { ...p.req, text: undefined },
  };
  try {
    const r = await client.renderWithTimestamps({ voiceId, ...p.req });
    const f = join(OUT, `${p.id}.mp3`);
    writeFileSync(f, r.audio);
    bytes.set(p.id, r.audio);
    row = {
      ...row,
      ok: true,
      ms: Date.now() - t0,
      mp3Bytes: r.audio.byteLength,
      alignment: tagSpans(p.req.text, r.alignment),
      audio: stats(f),
    };
  } catch (e) {
    row = {
      ...row,
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof ElevenLabsError ? e.message : String(e),
    };
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
const a = bytes.get('01-baseline'),
  b = bytes.get('02-seed-repeat');
const seed =
  a && b ? { byteIdentical: a.equals(b), bytesA: a.byteLength, bytesB: b.byteLength } : null;
writeFileSync(
  join(OUT, 'metrics.json'),
  `${JSON.stringify({ model: MODEL, voice: VOICE, seed: SEED, ru: RU, seedCheck: seed, results }, null, 2)}\n`,
);
console.log('seed check', JSON.stringify(seed));
