/** Read-only source audit; pass the existing content packs directory. Never downloads media. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[2];
if (!root)
  throw new Error('Usage: node validate-published.mjs /absolute/path/to/sumrak-content/packs');
const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
assert.equal(catalog.segments.length, 20);
const packs = new Map();
for (const s of catalog.segments) {
  const r = s.source;
  assert.ok(
    ['a1-torfl-listening-001', 'a2-torfl-listening-001'].includes(r.packId),
    'Only explicitly allowed practice packs',
  );
  if (!packs.has(r.packId))
    packs.set(r.packId, JSON.parse(readFileSync(resolve(root, r.packId, 'pack.json'), 'utf8')));
  const pack = packs.get(r.packId);
  assert.equal(pack.version, r.packVersion);
  assert.ok(
    pack.exams.every((e) => e.mode !== 'mock'),
    'No mock exam source',
  );
  const story = pack.stories.find((x) => x.id === r.storyId);
  const sentence = story.sentences.find((x) => x.id === r.sentenceId);
  const track = story.audio.find((x) => x.id === r.trackId);
  assert.equal(sentence.ru, s.transcript);
  assert.equal(sentence.en, s.translation);
  assert.equal(track.file, r.file);
  assert.equal(track.durationMs, r.durationMs);
  assert.ok(existsSync(resolve(root, r.packId, track.file)), 'Source audio exists');
  const stamps = track.timestamps.filter((w) => w.sentenceId === r.sentenceId);
  assert.deepEqual(stamps, r.stamps);
  const spoken = sentence.tokens.flatMap((t, i) => (t.isPunct ? [] : [i]));
  assert.deepEqual(
    [...new Set(stamps.map((w) => w.tokenIndex))].sort((a, b) => a - b),
    spoken,
    'Every spoken token has a stamp',
  );
  assert.ok(stamps.every((w) => w.startMs >= r.startMs && w.endMs <= r.endMs));
  assert.ok(
    !track.timestamps.some(
      (w) => w.sentenceId !== r.sentenceId && w.startMs < r.endMs && w.endMs > r.startMs,
    ),
    'No neighbour word crosses boundary',
  );
  assert.equal(s.review.earCheck, 'pending-T111');
}
console.log(
  `Validated ${catalog.segments.length} exact sentence/text/track/stamp references in ${packs.size} published practice packs. Ear checks remain pending T111.`,
);
