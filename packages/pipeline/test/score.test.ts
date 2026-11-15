import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { measureLoudness, probeDurationMs } from '../src/opus.ts';
import { packFileList, runPublish } from '../src/publish.ts';
import {
  CROSSFADE_MS,
  MAX_STRETCH,
  loadScoreSheet,
  pieceMs,
  planScore,
  runScore,
  scoreFileIssues,
  scoreLine,
} from '../src/score.ts';

/** T115: `pipeline score` — the pure plan, the real ffmpeg assembly, validate + publish. */

const FIXTURE = join(__dirname, '..', '..', 'schema', 'fixtures', 'packs', 'a1-listen-fixture');
const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

const tempDirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sumrak-t115-'));
  tempDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const cue = (file: string, startMs: number, endMs: number, sourceMs: number) => ({
  file,
  startMs,
  endMs,
  sourceMs,
});
const sumTimeline = (plan: ReturnType<typeof planScore>) =>
  plan.timeline.reduce((n, p) => n + pieceMs(plan, p), 0);

describe('planScore (pure)', () => {
  it('chains abutting cues with a 2 s crossfade tail and sums to the exact duration', () => {
    const plan = planScore(
      [cue('a', 0, 60_000, 63_000), cue('b', 60_000, 100_000, 41_000)],
      100_000,
    );
    expect(plan.cues[0]).toMatchObject({ fitMs: 62_000, crossfadeOutMs: CROSSFADE_MS, tempo: 1 });
    expect(plan.cues[1]).toMatchObject({ fitMs: 40_000, crossfadeOutMs: 0, gapFadeOutMs: 0 });
    expect(plan.timeline).toEqual([{ kind: 'chain', cues: [0, 1] }]);
    expect(sumTimeline(plan)).toBe(100_000);
    expect(plan.fadeInMs).toBe(1000);
    expect(plan.fadeOutMs).toBe(2500);
  });

  it('places a late cue after silence and fades it in/out around gaps', () => {
    const plan = planScore([cue('a', 5_000, 20_000, 15_000)], 30_000);
    expect(plan.timeline).toEqual([
      { kind: 'silence', ms: 5_000 },
      { kind: 'chain', cues: [0] },
      { kind: 'silence', ms: 10_000 },
    ]);
    expect(plan.cues[0]).toMatchObject({ gapFadeInMs: CROSSFADE_MS, gapFadeOutMs: CROSSFADE_MS });
    expect(sumTimeline(plan)).toBe(30_000);
  });

  it('stretches a short cue up to 4 % and refuses beyond', () => {
    const ok = planScore([cue('a', 0, 100_000, 96_200)], 100_000);
    expect(ok.cues[0]!.stretchPct).toBeCloseTo((100_000 / 96_200 - 1) * 100, 6);
    expect(ok.cues[0]!.stretchPct).toBeLessThanOrEqual(MAX_STRETCH * 100);
    expect(ok.cues[0]!.tempo).toBeCloseTo(0.962, 6);
    expect(() => planScore([cue('a', 0, 100_000, 96_000)], 100_000)).toThrow(
      /4\.17% stretch exceeds 4%/,
    );
  });

  it('counts the crossfade tail in the stretch budget', () => {
    // slot 50 s + 2 s tail = 52 s fit; a 50.5 s source is a 2.97 % stretch.
    const plan = planScore([cue('a', 0, 50_000, 50_500), cue('b', 50_000, 80_000, 30_000)], 80_000);
    expect(plan.cues[0]!.stretchPct).toBeCloseTo((52_000 / 50_500 - 1) * 100, 6);
  });

  it('trims a long cue without stretching', () => {
    const plan = planScore([cue('a', 0, 10_000, 30_000)], 10_000);
    expect(plan.cues[0]).toMatchObject({ tempo: 1, stretchPct: 0, fitMs: 10_000 });
  });

  it('snaps 0.1 s table rounding at joins and at the track end', () => {
    const plan = planScore([cue('a', 0, 20_000, 23_000), cue('b', 20_030, 43_400, 23_500)], 43_446);
    expect(plan.cues[1]!.startMs).toBe(20_000);
    expect(plan.cues[1]!.endMs).toBe(43_446);
    expect(plan.timeline).toEqual([{ kind: 'chain', cues: [0, 1] }]);
    expect(sumTimeline(plan)).toBe(43_446);
  });

  it('clamps a cue that overhangs the narration by < 1 s, refuses more', () => {
    expect(planScore([cue('a', 0, 10_500, 11_000)], 10_000).cues[0]!.endMs).toBe(10_000);
    expect(() => planScore([cue('a', 0, 11_500, 12_000)], 10_000)).toThrow(/past the narration/);
  });

  it('refuses overlapping cues, empty cue lists and slots shorter than two crossfades', () => {
    expect(() =>
      planScore([cue('a', 0, 30_000, 33_000), cue('b', 25_000, 50_000, 30_000)], 50_000),
    ).toThrow(/after cue 2/);
    expect(() => planScore([], 10_000)).toThrow(/no cues/);
    expect(() => planScore([cue('a', 0, 3_000, 4_000)], 3_000)).toThrow(/slot 3000ms/);
  });

  it('sorts cues by start', () => {
    const plan = planScore([cue('b', 30_000, 60_000, 31_000), cue('a', 0, 30_000, 33_000)], 60_000);
    expect(plan.cues.map((c) => c.file)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// Real ffmpeg path
// ---------------------------------------------------------------------------

function tone(path: string, freq: number, seconds: number): void {
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
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
    path,
  ]);
}

/** Fixture copy with long part tracks (12 s / 9 s / 1.4 s) so scores have room. */
function scoredFixture(): { packDir: string; cueDir: string } {
  const root = tempDir();
  const packDir = join(root, 'p');
  cpSync(FIXTURE, packDir, { recursive: true });
  const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
  pack.stories[0].audio[0].durationMs = 12_000;
  pack.stories[1].audio[0].durationMs = 9_000;
  delete pack.fullStory;
  writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  rmSync(join(packDir, 'audio', 'a1-listen-fixture-full.opus'));
  const cueDir = join(root, 'suno');
  mkdirSync(cueDir);
  tone(join(cueDir, 'p1-A.mp3'), 220, 8.1); // slot 0–6 s + 2 s tail: trim
  tone(join(cueDir, 'p1-B.mp3'), 330, 5.9); // slot 6–12 s: +1.7 % stretch
  tone(join(cueDir, 'p2-A.mp3'), 440, 6); // slot 4–9 s after 4 s silence
  return { packDir, cueDir };
}

function writeSheet(dir: string, cueDir: string, extra: object[] = []): string {
  const file = join(dir, 'score-sheet.json');
  writeFileSync(
    file,
    JSON.stringify({
      packId: 'a1-listen-fixture',
      cueDir,
      stories: [
        {
          storyId: 'part-1',
          cues: [
            { file: 'p1-A.mp3', startMs: 0, endMs: 6000 },
            { file: 'p1-B.mp3', startMs: 6000, endMs: 12000 },
          ],
        },
        { storyId: 'part-2', cues: [{ file: 'p2-A.mp3', startMs: 4000, endMs: 9000 }] },
        { storyId: 'part-3', cues: [] },
        ...extra,
      ],
    }),
  );
  return file;
}

/** Mean level of [fromS, toS) of a file. */
function levelOf(path: string, fromS: number, toS: number): number {
  const out = join(tempDir(), 'slice.wav');
  execFileSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-ss',
    String(fromS),
    '-to',
    String(toS),
    out,
  ]);
  return measureLoudness(out).meanDb;
}

describe.skipIf(!hasFfmpeg)('runScore (real ffmpeg)', () => {
  it('builds exact-length stereo scores, writes story.score, leaves cue-less parts unscored', () => {
    const { packDir, cueDir } = scoredFixture();
    const sheet = writeSheet(join(packDir, '..'), cueDir);
    const result = runScore(packDir, sheet);
    expect(result.built.map((b) => b.storyId)).toEqual(['part-1', 'part-2']);
    expect(result.unscored).toEqual(['part-3']);
    expect(result.version).toBe(1); // never bumped

    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    expect(pack.version).toBe(1);
    expect(pack.stories[0].score).toEqual({
      id: 'lf-p1-score',
      file: 'audio/lf-p1-score.opus',
      durationMs: expect.any(Number),
      trackId: 'lf-p1',
    });
    expect(pack.stories[2].score).toBeUndefined();
    for (const [i, want] of [
      [0, 12_000],
      [1, 9_000],
    ] as const) {
      const f = join(packDir, pack.stories[i].score.file);
      expect(Math.abs(probeDurationMs(f) - want)).toBeLessThanOrEqual(50);
      const ch = execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=channels,codec_name',
          '-of',
          'csv=p=0',
          f,
        ],
        { encoding: 'utf8' },
      );
      expect(ch.trim()).toBe('opus,2');
    }
    // Loudness normalised to the beds' target.
    for (const b of result.built) expect(b.lufsAfter).toBeGreaterThan(-27.5);
    for (const b of result.built) expect(b.lufsAfter).toBeLessThan(-24.5);
    // Narration untouched; the full track never touched.
    expect(existsSync(join(packDir, 'audio', 'a1-listen-fixture-full.opus'))).toBe(false);

    // Placement: part-2 is silent before its cue at 4 s, loud inside it.
    const p2 = join(packDir, pack.stories[1].score.file);
    expect(levelOf(p2, 0.2, 3.5)).toBeLessThan(-60);
    expect(levelOf(p2, 5, 7)).toBeGreaterThan(-45);

    // Validate: files exist with matching lengths; a wrong length is reported.
    expect(scoreFileIssues(pack, packDir)).toEqual([]);
    expect(scoreLine(pack)).toBe('  Scores: 2/3 parts scored');
    pack.stories[0].score.durationMs += 500;
    expect(scoreFileIssues(pack, packDir)[0]).toMatch(/part-1\.score\.durationMs/);
    rmSync(join(packDir, 'audio', 'lf-p2-score.opus'));
    expect(
      scoreFileIssues(pack, packDir).some((i) => /lf-p2-score\.opus does not exist/.test(i)),
    ).toBe(true);
  });

  it('--dry-run writes nothing to the pack dir', () => {
    const { packDir, cueDir } = scoredFixture();
    const before = readFileSync(join(packDir, 'pack.json'), 'utf8');
    const result = runScore(packDir, writeSheet(join(packDir, '..'), cueDir), { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.built[0]!.bytes).toBeGreaterThan(0);
    expect(readFileSync(join(packDir, 'pack.json'), 'utf8')).toBe(before);
    expect(existsSync(join(packDir, 'audio', 'lf-p1-score.opus'))).toBe(false);
  });

  it('removes a stale score when the sheet no longer has cues for that part', () => {
    const { packDir, cueDir } = scoredFixture();
    runScore(packDir, writeSheet(join(packDir, '..'), cueDir));
    const sheet = join(packDir, '..', 'only-p1.json');
    writeFileSync(
      sheet,
      JSON.stringify({
        cueDir,
        stories: [
          { storyId: 'part-1', cues: [{ file: 'p1-B.mp3', startMs: 0, endMs: 6000 }] },
          { storyId: 'part-2', cues: [] },
        ],
      }),
    );
    // part-1 is 12 s; a 5.9 s cue for 0–6 s then silence.
    const r = runScore(packDir, sheet);
    expect(r.removed).toEqual(['part-2']);
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    expect(pack.stories[1].score).toBeUndefined();
  });

  it('fails loudly on a too-short cue, a wrong pack id, an unknown story, a missing file', () => {
    const { packDir, cueDir } = scoredFixture();
    const dir = join(packDir, '..');
    const bad = (stories: object[], extra: object = {}) => {
      const f = join(dir, 'bad.json');
      writeFileSync(f, JSON.stringify({ cueDir, stories, ...extra }));
      return f;
    };
    expect(() =>
      runScore(
        packDir,
        bad([{ storyId: 'part-1', cues: [{ file: 'p2-A.mp3', startMs: 0, endMs: 12000 }] }]),
      ),
    ).toThrow(/stretch exceeds 4%/);
    expect(() =>
      runScore(packDir, bad([{ storyId: 'part-1', cues: [] }], { packId: 'other' })),
    ).toThrow(/is for "other"/);
    expect(() => runScore(packDir, bad([{ storyId: 'part-9', cues: [] }]))).toThrow(
      /not in a1-listen-fixture/,
    );
    expect(() =>
      runScore(
        packDir,
        bad([{ storyId: 'part-1', cues: [{ file: 'nope.mp3', startMs: 0, endMs: 6000 }] }]),
      ),
    ).toThrow(/cue file missing/);
    expect(() =>
      loadScoreSheet(bad([{ storyId: 'part-1', cues: [{ file: 'x', startMs: 0 }] }])),
    ).toThrow(/score sheet .* is invalid/);
  });
});

// ---------------------------------------------------------------------------
// Publish: file list + --audio-unchanged
// ---------------------------------------------------------------------------

function makeContentRepo(): string {
  const dir = tempDir();
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't115@test');
  git('config', 'user.name', 'T115 Test');
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, packs: [] })}\n`);
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

describe('packFileList (T115)', () => {
  it('includes every story score file', () => {
    const pack = JSON.parse(readFileSync(join(FIXTURE, 'pack.json'), 'utf8'));
    pack.stories[1].score = {
      id: 'lf-p2-score',
      file: 'audio/lf-p2-score.opus',
      durationMs: 906,
      trackId: 'lf-p2',
    };
    const list = packFileList(pack);
    expect(list).toContain('audio/lf-p2-score.opus');
    expect(list.filter((f) => f.endsWith('-score.opus'))).toHaveLength(1);
  });
});

describe.skipIf(!hasFfmpeg)('runPublish --audio-unchanged (T115)', () => {
  function publishedThenScored(): { content: string; packDir: string } {
    const { packDir, cueDir } = scoredFixture();
    const content = makeContentRepo();
    runPublish(packDir, content); // v1, no scores
    runScore(packDir, writeSheet(join(packDir, '..'), cueDir));
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    pack.version = 2;
    writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
    return { content, packDir };
  }

  it('passes when only scores + version changed and ships the score files', () => {
    const { content, packDir } = publishedThenScored();
    const summary = runPublish(packDir, content, { audioUnchanged: true });
    expect(summary.outcome).toBe('published');
    expect(summary.stitchOnlyNote).toBe(
      'audio-unchanged: 3 tracks byte-identical, stamp-audit skipped',
    );
    expect(summary.scoreBytes).toBeGreaterThan(0);
    const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8'));
    const paths = manifest.packs[0].files.map((f: { path: string }) => f.path);
    expect(paths).toContain('audio/lf-p1-score.opus');
    expect(paths).toContain('audio/lf-p2-score.opus');
    expect(
      existsSync(join(content, 'packs', 'a1-listen-fixture', 'audio', 'lf-p1-score.opus')),
    ).toBe(true);
  });

  it('the --stitch-only alias accepts score-only changes too', () => {
    const { content, packDir } = publishedThenScored();
    expect(runPublish(packDir, content, { stitchOnly: true }).outcome).toBe('published');
  });

  it('allows a changed score file on a later bump', () => {
    const { content, packDir } = publishedThenScored();
    runPublish(packDir, content, { audioUnchanged: true });
    const f = join(packDir, 'audio', 'lf-p1-score.opus');
    const buf = readFileSync(f);
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    writeFileSync(f, buf);
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    pack.version = 3;
    writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
    expect(runPublish(packDir, content, { audioUnchanged: true }).version).toBe(3);
  });

  it('refuses when a narration track changed', () => {
    const { content, packDir } = publishedThenScored();
    const f = join(packDir, 'audio', 'lf-p1.opus');
    const buf = readFileSync(f);
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    writeFileSync(f, buf);
    expect(() => runPublish(packDir, content, { audioUnchanged: true })).toThrow(
      /lf-p1\.opus differs from the published audio/,
    );
  });

  it('refuses any other pack change', () => {
    const { content, packDir } = publishedThenScored();
    const pack = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
    pack.stories[0].title.en = 'changed';
    writeFileSync(join(packDir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
    expect(() => runPublish(packDir, content, { audioUnchanged: true })).toThrow(
      /differs from the published .* at \$\.stories\[0\]\.title\.en/,
    );
  });

  it('refuses to combine with the stamp-audit override', () => {
    const { content, packDir } = publishedThenScored();
    expect(() =>
      runPublish(packDir, content, { audioUnchanged: true, allowStampRisk: true }),
    ).toThrow(/cannot be combined/);
  });
});
