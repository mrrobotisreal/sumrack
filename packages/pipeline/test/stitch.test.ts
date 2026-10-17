import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { probeDurationMs } from '../src/opus.ts';
import { chooseTrack, runStitch, segmentsFrom } from '../src/stitch.ts';
import { fullTrackLine } from '../src/validate.ts';

/** T94: stitch helpers (pure) + the real ffmpeg path on the a1-listen-fixture. */

const FIXTURE = join(__dirname, '..', '..', 'schema', 'fixtures', 'packs', 'a1-listen-fixture');
const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});
function fixtureCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sumrak-t94-'));
  tempDirs.push(dir);
  cpSync(FIXTURE, join(dir, 'p'), { recursive: true });
  return join(dir, 'p');
}

const track = (id: string, style: string) => ({
  id,
  voice: 'elevenlabs:X',
  style,
  file: `audio/${id}.opus`,
  durationMs: 1000,
  timestamps: [],
});

describe('chooseTrack', () => {
  it('takes the first track by default', () => {
    const story = { id: 's', audio: [track('a', 'neutral'), track('b', 'whisper')] };
    expect(chooseTrack(story).id).toBe('a');
  });
  it('takes the first track of the requested style', () => {
    const story = { id: 's', audio: [track('a', 'neutral'), track('b', 'whisper')] };
    expect(chooseTrack(story, 'whisper').id).toBe('b');
  });
  it('names the story when nothing matches or there is no audio', () => {
    expect(() => chooseTrack({ id: 'part-9', audio: [track('a', 'neutral')] }, 'x')).toThrow(
      /part-9/,
    );
    expect(() => chooseTrack({ id: 'part-8', audio: [] })).toThrow(/part-8/);
  });
});

describe('segmentsFrom', () => {
  it('lays parts end to start with the gap between them', () => {
    expect(segmentsFrom([1000, 500, 2000], 1200)).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 2200, endMs: 2700 },
      { startMs: 3900, endMs: 5900 },
    ]);
  });
  it('handles one part and a zero gap', () => {
    expect(segmentsFrom([700], 1200)).toEqual([{ startMs: 0, endMs: 700 }]);
    expect(segmentsFrom([100, 100], 0)[1]).toEqual({ startMs: 100, endMs: 200 });
  });
});

describe('fullTrackLine', () => {
  it('reports absent and present', () => {
    expect(fullTrackLine({})).toContain('absent');
    const line = fullTrackLine({
      cover: 'cover/cover.jpg',
      fullStory: {
        id: 'x-full',
        voice: 'elevenlabs:X',
        style: 'full',
        file: 'audio/x-full.opus',
        durationMs: 5900,
        gapMs: 1200,
        segments: [{ storyId: 'a', trackId: 't', startMs: 0, endMs: 1000 }],
      },
    });
    expect(line).toContain('1 parts');
    expect(line).toContain('5.9s');
    expect(line).toContain('gap 1200 ms');
    expect(line).toContain('cover/cover.jpg');
  });
});

describe.skipIf(!hasFfmpeg)('runStitch (real ffmpeg, fixture audio)', () => {
  it('--dry-run writes nothing', () => {
    const dir = fixtureCopy();
    const before = readFileSync(join(dir, 'pack.json'), 'utf8');
    const r = runStitch(dir, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(readFileSync(join(dir, 'pack.json'), 'utf8')).toBe(before);
  });

  it('stitches: segment arithmetic matches the real file within 20 ms; idempotent pack.json', () => {
    const dir = fixtureCopy();
    const r = runStitch(dir, { gapMs: 1000 });
    const f = r.fullStory;
    const sum = r.lengthsMs.reduce((a, b) => a + b, 0) + (r.lengthsMs.length - 1) * 1000;
    const real = probeDurationMs(join(dir, f.file));
    expect(f.durationMs).toBe(real);
    expect(Math.abs(real - sum)).toBeLessThanOrEqual(20);
    expect(f.segments[f.segments.length - 1]!.endMs).toBeLessThanOrEqual(real + 20);
    expect(f.gapMs).toBe(1000);
    expect(f.id).toBe('a1-listen-fixture-full');
    expect(statSync(join(dir, f.file)).size).toBeGreaterThan(0);
    const once = readFileSync(join(dir, 'pack.json'), 'utf8');
    runStitch(dir, { gapMs: 1000 });
    expect(readFileSync(join(dir, 'pack.json'), 'utf8')).toBe(once);
  });

  it('--bump increments the version once per run', () => {
    const dir = fixtureCopy();
    expect(runStitch(dir, { bump: true }).version).toBe(2);
  });

  it('names the story when no track has the requested style', () => {
    const dir = fixtureCopy();
    expect(() => runStitch(dir, { trackStyle: 'nope' })).toThrow(/part-1/);
  });
});
