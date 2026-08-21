// Fixture generator (authoring-time tool, not part of the published API).
// 1. Injects the fabricated silent AudioTrack + monotonic WordStamps into
//    the a1-creepypasta-001 fixture (karaoke test data for T10 — real audio
//    arrives with the pipeline in T09).
// 2. Renders the matching silent Opus file with ffmpeg.
// 3. Regenerates fixtures/manifest.json with real byte sizes and sha256 hashes.
// Deterministic: safe to re-run; output is committed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const packsDir = join(fixturesDir, 'packs');

// --- 1. fabricate word stamps for pack 001 ---------------------------------
const WORD_MS = 420; // fabricated per-word speaking time
const GAP_MS = 60; // fabricated gap between words
const SENTENCE_GAP_MS = 550; // fabricated pause between sentences
const LEAD_IN_MS = 500;
const TAIL_MS = 800;

const pack1Path = join(packsDir, 'a1-creepypasta-001', 'pack.json');
const pack1 = JSON.parse(readFileSync(pack1Path, 'utf8'));
const story = pack1.stories[0];

const timestamps = [];
let cursor = LEAD_IN_MS;
for (const sentence of story.sentences) {
  sentence.tokens.forEach((token, tokenIndex) => {
    if (token.isPunct) return; // punctuation is never spoken
    timestamps.push({
      sentenceId: sentence.id,
      tokenIndex,
      startMs: cursor,
      endMs: cursor + WORD_MS,
    });
    cursor += WORD_MS + GAP_MS;
  });
  cursor += SENTENCE_GAP_MS;
}
const durationMs = cursor - SENTENCE_GAP_MS - GAP_MS + TAIL_MS;

const audioFile = 'audio/knock-in-the-wall-anton-creepy.opus';
story.audio = [
  {
    id: 'knock-anton-creepy',
    voice: 'elevenlabs:Anton',
    style: 'creepy-whisper',
    file: audioFile,
    durationMs,
    timestamps,
  },
];
writeFileSync(pack1Path, JSON.stringify(pack1, null, 2) + '\n');
console.log(`pack 001: ${timestamps.length} word stamps, durationMs=${durationMs}`);

// --- 2. silent opus of matching duration -----------------------------------
const opusPath = join(packsDir, 'a1-creepypasta-001', audioFile);
mkdirSync(dirname(opusPath), { recursive: true });
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=mono',
    '-t',
    (durationMs / 1000).toFixed(3),
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    opusPath,
  ],
  { stdio: 'pipe' },
);
console.log(`wrote silent opus: ${relative(fixturesDir, opusPath)}`);

// --- 3. manifest with real hashes ------------------------------------------
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const packs = readdirSync(packsDir)
  .sort()
  .map((packId) => {
    const packDir = join(packsDir, packId);
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    const files = walk(packDir)
      .sort()
      .map((file) => ({
        path: relative(packDir, file).split('\\').join('/'),
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      }));
    const bytes = walk(packDir).reduce((sum, file) => sum + statSync(file).size, 0);
    return {
      id: pack.id,
      version: pack.version,
      type: pack.type,
      level: pack.level,
      title: pack.title,
      bytes,
      files,
    };
  });

const manifest = { schemaVersion: 1, generatedAt: '2026-08-21T00:00:00Z', packs };
writeFileSync(join(fixturesDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest: ${packs.length} packs, ${packs.map((p) => p.files.length).join('+')} files`);
