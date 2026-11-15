// T115 fixture generator: `a1-score-fixture` — the device-verification pack for
// per-part story scores. Three parts (12 s / 8 s / 12 s) of quiet synthetic
// "narration" (mono 32 k voip, like encodeOpus), parts 1 and 3 scored through
// the REAL `pipeline score` from synthetic stereo cue tones (part 1 = two cues
// with a crossfade, part 3 = one cue), part 2 deliberately unscored (the bed
// fallback cell), then `pipeline stitch` for the listen-mode cells.
// Deterministic; output is committed. Dev import only (device data hygiene).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const out = join(here, '..', 'fixtures', 'packs', 'a1-score-fixture');
const ID = 'a1-score-fixture';
const PARTS = [
  { id: 'part-1', track: 'sf-p1', seconds: 12, ru: 'Часть 1. Музыка', en: 'Part 1. Music' },
  { id: 'part-2', track: 'sf-p2', seconds: 8, ru: 'Часть 2. Тишина', en: 'Part 2. Silence' },
  { id: 'part-3', track: 'sf-p3', seconds: 12, ru: 'Часть 3. Финал', en: 'Part 3. Finale' },
];

const ff = (...args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const probeMs = (f) =>
  Math.floor(
    Number(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
        {
          encoding: 'utf8',
        },
      ).trim(),
    ) * 1000,
  );

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'audio'), { recursive: true });

// 1. Narration: a quiet 200 Hz tone, 32 k mono Opus (voip) — never real speech.
for (const p of PARTS) {
  ff(
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=200:sample_rate=48000:duration=${p.seconds}`,
    '-af',
    'volume=-30dB',
    '-c:a',
    'libopus',
    '-b:a',
    '32k',
    '-ac',
    '1',
    '-ar',
    '48000',
    '-application',
    'voip',
    join(out, 'audio', `${p.track}.opus`),
  );
}

const word = (text) => ({
  text,
  lemma: text.toLowerCase(),
  translation: 'test',
  pos: 'noun',
  level: 'A1',
});
const pack = {
  id: ID,
  version: 1,
  type: 'stories',
  title: { ru: 'Тест музыки', en: 'Score fixture' },
  level: 'A1',
  tags: ['fixture', 'score'],
  stories: PARTS.map((p, i) => ({
    id: p.id,
    title: { ru: p.ru, en: p.en },
    level: 'A1',
    sentences: [
      {
        id: `sf${i + 1}-s01`,
        ru: 'Тест.',
        en: 'Test.',
        tokens: [word('Тест'), { text: '.', isPunct: true }],
      },
    ],
    audio: [
      {
        id: p.track,
        voice: 'elevenlabs:Fixture',
        style: 'neutral',
        file: `audio/${p.track}.opus`,
        durationMs: probeMs(join(out, 'audio', `${p.track}.opus`)),
        timestamps: [],
      },
    ],
  })),
};
writeFileSync(join(out, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);

// 2. Cue tones (stereo mp3, like Suno downloads) + the score sheet, in a temp dir.
const work = mkdtempSync(join(tmpdir(), 'sumrak-score-fixture-'));
try {
  const cue = (name, freq, seconds) =>
    ff(
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`,
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      join(work, name),
    );
  cue('p1-A.mp3', 220, 8.2); // 0–6 s + 2 s crossfade tail (trim)
  cue('p1-B.mp3', 330, 6.1); // 6–12 s (trim)
  cue('p3-A.mp3', 262, 11.8); // 0–12 s (+1.7 % stretch)
  const sheet = join(work, 'sheet.json');
  writeFileSync(
    sheet,
    JSON.stringify({
      packId: ID,
      stories: [
        {
          storyId: 'part-1',
          cues: [
            { file: 'p1-A.mp3', startMs: 0, endMs: 6000 },
            { file: 'p1-B.mp3', startMs: 6000, endMs: 12000 },
          ],
        },
        { storyId: 'part-2', cues: [] },
        { storyId: 'part-3', cues: [{ file: 'p3-A.mp3', startMs: 0, endMs: 12000 }] },
      ],
    }),
  );
  const cli = join(repo, 'packages', 'pipeline', 'src', 'cli.ts');
  const pipeline = (...args) =>
    execFileSync('pnpm', ['-s', 'exec', 'tsx', cli, ...args], { stdio: 'inherit', cwd: repo });
  pipeline('score', out, '--sheet', sheet);
  pipeline('stitch', out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
