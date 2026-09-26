import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { safeParsePack, scenarioLines, type Pack } from '@sumrak/schema';
import { planAudioRun, runAudition, runFinalize, runMouthOnly } from '../src/audio.ts';
import { annotateDrafts } from '../src/annotate.ts';
import { ElevenLabsClient } from '../src/elevenlabs.ts';
import { packFileList, runPublish, sceneFiles } from '../src/publish.ts';
import {
  auditionRepresentatives,
  DEFAULT_CUES,
  HINT_SPEED,
  planScenarioItems,
  SCENARIO_BASE_SETTINGS,
  steerVariant,
} from '../src/scenario-audio.ts';

/**
 * T57 tests: per-line scenario rendering — plan shapes (every line kind +
 * coach behind playerAudio), v2 variant steering on the wire, per-character
 * seed groups, stamps + mouth tracks in the merged pack (schema-valid, all-
 * or-nothing), the cost-gate dry run, --mouth-only idempotence, and publish
 * shipping audio/ + scene/**. Fake provider, real ffmpeg (T26 pattern).
 */

const FIXTURE_DRAFT = join(import.meta.dirname, '..', 'fixtures', 'radio-check.scenario.md');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sumrak-t57-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function fixturePack(): Pack {
  const source = readFileSync(FIXTURE_DRAFT, 'utf8');
  return annotateDrafts([{ path: FIXTURE_DRAFT, source }]);
}

interface Captured {
  text: string;
  seed?: number;
  model_id?: string;
  previous_text?: string;
  voice_settings?: Record<string, number | boolean>;
}

/** Fake ElevenLabs backend with the fixture's voice roster (Maxim host, Ivan coach). */
function fakeFetch(mp3: Buffer, captured: Captured[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voices')) {
      return Response.json({
        voices: [
          { voice_id: 'x'.repeat(20), name: 'Maxim - Radio Host' },
          { voice_id: 'i'.repeat(20), name: 'Ivan - Neutral Reader' },
        ],
      });
    }
    if (u.includes('/with-timestamps')) {
      const body = JSON.parse(String(init!.body)) as Captured;
      captured.push(body);
      const characters = Array.from(body.text);
      return Response.json({
        audio_base64: mp3.toString('base64'),
        alignment: {
          characters,
          character_start_times_seconds: characters.map((_, i) => (i * 30) / 1000),
          character_end_times_seconds: characters.map((_, i) => ((i + 1) * 30) / 1000),
        },
      });
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
}

/** A 3 s MP3: 1 s silence, 1.4 s tone, 0.6 s silence — so the mouth track has shape. */
function makeToneMp3(dir: string): Buffer {
  const file = join(dir, 'tone.mp3');
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'aevalsrc=0.5*sin(2*PI*220*t)*between(t\\,1.0\\,2.4):s=44100:d=3',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    file,
  ]);
  return readFileSync(file);
}

// The fixture: 6 turns / 15 say lines, 2 prompting turns (2 confused + 2 hint
// + 1 second), 1 react, 15 glossary entries (30 clips), 3 nudges = 51 lines.
const FIXTURE_LINES = 54;

describe('planScenarioItems', () => {
  it('plans one render per line of every kind, host-voiced, without playerAudio', () => {
    const items = planScenarioItems(fixturePack());
    expect(items).toHaveLength(FIXTURE_LINES);
    expect(items.every((i) => i.character.id === 'host')).toBe(true);
    expect(new Set(items.map((i) => i.group))).toEqual(new Set(['radio-a1/host']));
    const kinds = items.reduce<Record<string, number>>((acc, i) => {
      acc[i.variant] = (acc[i.variant] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds).toEqual({
      say: 15,
      confused: 2,
      hint: 2,
      second: 1,
      react: 1,
      explain: 15,
      howtosay: 15,
      nudge: 3,
    });
    expect(items[0]!.file).toBe('audio/radio-a1/radio-a1-t01-a.opus');
    expect(items.find((i) => i.variant === 'nudge')!.label).toBe('nudge/silence');
  });

  it('adds one coach render per expectation (accept[0], player voice) with playerAudio', () => {
    const items = planScenarioItems(fixturePack(), { playerAudio: true });
    const coach = items.filter((i) => i.variant === 'coach');
    expect(items).toHaveLength(FIXTURE_LINES + 2);
    expect(coach.map((c) => c.label)).toEqual(['radio-a1-t02', 'radio-a1-t03']);
    expect(coach.map((c) => c.text)).toEqual(['Меня зовут Митч.', 'Хорошо, спасибо.']);
    expect(coach.every((c) => c.character.id === 'player' && c.group === 'radio-a1/player')).toBe(
      true,
    );
    expect(coach[0]!.file).toBe('audio/radio-a1/radio-a1-t02-coach.opus');
  });

  it('respects the scenarios filter', () => {
    expect(planScenarioItems(fixturePack(), { scenarios: ['other'] })).toHaveLength(0);
  });

  it('audition representatives = longest line per group + longest confused line per group', () => {
    const reps = auditionRepresentatives(planScenarioItems(fixturePack(), { playerAudio: true }));
    expect(reps.map((r) => `${r.group}#${r.variant}`).sort()).toEqual([
      'radio-a1/host#confused',
      'radio-a1/host#howtosay',
      'radio-a1/player#coach',
    ]);
    const confused = reps.find((r) => r.variant === 'confused')!;
    expect(confused.sentence!.ru).toBe('Как дела? Не понял.');
  });
});

describe('steerVariant (SCENARIOS §3)', () => {
  const cues = { confused: 'Что? Повтори.', hint: 'Мягче.' };

  it('confused: cue as previous_text, stability −0.1, style +0.1', () => {
    const s = steerVariant('confused', cues);
    expect(s.previousText).toBe('Что? Повтори.');
    expect(s.voiceSettings.stability).toBeCloseTo(SCENARIO_BASE_SETTINGS.stability - 0.1);
    expect(s.voiceSettings.style).toBeCloseTo(SCENARIO_BASE_SETTINGS.style + 0.1);
    expect(s.voiceSettings.speed).toBe(1);
  });

  it('hint: cue as previous_text, speed 0.95, other knobs base', () => {
    const s = steerVariant('hint', cues);
    expect(s.previousText).toBe('Мягче.');
    expect(s.voiceSettings).toEqual({ ...SCENARIO_BASE_SETTINGS, speed: HINT_SPEED });
  });

  it('falls back to the default cues when the draft names none', () => {
    expect(steerVariant('confused', undefined).previousText).toBe(DEFAULT_CUES.confused);
    expect(steerVariant('hint', {}).previousText).toBe(DEFAULT_CUES.hint);
  });

  it('every other variant: no previous_text, base settings', () => {
    for (const v of ['say', 'second', 'react', 'explain', 'howtosay', 'nudge', 'coach'] as const) {
      const s = steerVariant(v, cues);
      expect(s.previousText).toBeUndefined();
      expect(s.voiceSettings).toEqual(SCENARIO_BASE_SETTINGS);
    }
  });
});

describe('planAudioRun (cost gate dry run)', () => {
  it('counts finalize requests for every line + coach without any network', () => {
    const plan = planAudioRun([FIXTURE_DRAFT], { playerAudio: true });
    expect(plan.storyTracks).toBe(0);
    expect(plan.dialogueNodes).toBe(0);
    expect(plan.scenarioLines).toBe(FIXTURE_LINES);
    expect(plan.scenarioCoach).toBe(2);
    expect(plan.requests).toBe(FIXTURE_LINES + 2);
    expect(plan.chars).toBeGreaterThan(0);
  });

  it('audition counts the representatives × takes', () => {
    const plan = planAudioRun([FIXTURE_DRAFT], { audition: true, takes: 2 });
    // host longest + host confused (no playerAudio) × 2 takes.
    expect(plan.requests).toBe(4);
  });
});

describe('scenario audition (fake provider, real ffmpeg)', () => {
  it('renders takes per representative, steers the confused take, never writes pack.json', async () => {
    const work = tempDir();
    const mp3 = makeToneMp3(work);
    const captured: Captured[] = [];
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3, captured) });
    const outDir = join(work, 'pack');

    const result = await runAudition([FIXTURE_DRAFT], outDir, client, {
      takes: 2,
      playerAudio: true,
    });
    expect(result.story).toHaveLength(0);
    expect(result.dialogue).toHaveLength(0);
    expect(result.scenario).toHaveLength(6); // 3 representatives × 2 takes
    for (const take of result.scenario) expect(existsSync(take.file)).toBe(true);
    const confusedTakes = result.scenario.filter((t) => t.variant === 'confused');
    expect(confusedTakes).toHaveLength(2);
    expect(confusedTakes[0]!.file).toMatch(/radio-a1--host--confused--take1--seed\d+\.mp3$/);
    // The fixture's confused cue rode along as previous_text on the confused takes only.
    const confusedReqs = captured.filter((r) => r.text === 'Как дела? Не понял.');
    expect(confusedReqs).toHaveLength(2);
    for (const r of confusedReqs) {
      expect(r.previous_text).toBe('Извини, я не совсем понял. Ты можешь повторить?');
      expect(r.voice_settings).toMatchObject({ stability: 0.4, style: 0.1 });
    }
    expect(captured.filter((r) => r.previous_text === undefined)).toHaveLength(4);
    expect(existsSync(join(outDir, 'pack.json'))).toBe(false);
  }, 60_000);
});

describe('scenario finalize (fake provider, real ffmpeg)', () => {
  it('renders every line + coach with stamps and mouth tracks into a schema-valid pack', async () => {
    const work = tempDir();
    const mp3 = makeToneMp3(work);
    const captured: Captured[] = [];
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3, captured) });
    const outDir = join(work, 'pack');

    const summary = await runFinalize([FIXTURE_DRAFT], outDir, client, {
      playerAudio: true,
      seeds: { 'radio-a1/host': 11, 'radio-a1/player': 33 },
    });
    expect(summary.reports).toHaveLength(0);
    expect(summary.dialogueReports).toHaveLength(0);
    expect(summary.scenarioReports).toHaveLength(FIXTURE_LINES + 2);

    // Seeds follow the per-character groups; every request is v2 + ru.
    for (const r of summary.scenarioReports) {
      expect(r.seed).toBe(r.characterId === 'host' ? 11 : 33);
      if (r.variant !== 'coach') {
        expect(r.stampResult.trusted).toBe(true);
        expect(r.stampResult.coverage).toBeGreaterThanOrEqual(0.95);
      }
      expect(r.mouthLength).toBe(Math.ceil(r.durationMs / 40));
    }
    expect(captured).toHaveLength(FIXTURE_LINES + 2);
    for (const req of captured) expect(req.model_id).toBe('eleven_multilingual_v2');
    // Steering on the wire: hint lines slow down, confused lines carry the cue.
    const hintReqs = captured.filter((r) => r.voice_settings?.speed === HINT_SPEED);
    expect(hintReqs.map((r) => r.text).sort()).toEqual(
      ['Скажите «хорошо» или «плохо».', 'Скажите: «Меня зовут…».'].sort(),
    );
    expect(hintReqs.every((r) => r.previous_text !== undefined)).toBe(true);
    // Coach lines: free text, player voice, no stamps but a mouth track.
    const coachReqs = captured.filter((r) => r.text === 'Меня зовут Митч.');
    expect(coachReqs).toHaveLength(1);

    const raw = JSON.parse(readFileSync(join(outDir, 'pack.json'), 'utf8')) as unknown;
    const parsed = safeParsePack(raw);
    expect(parsed.success).toBe(true);
    const pack = (parsed as { success: true; data: Pack }).data;
    const scenario = pack.scenarios![0]!;
    const lines = scenarioLines(scenario);
    expect(lines).toHaveLength(FIXTURE_LINES);
    for (const ref of lines) {
      const audio = ref.line.audio!;
      expect(audio).toBeDefined();
      expect(existsSync(join(outDir, audio.file))).toBe(true);
      expect(audio.timestamps!.length).toBeGreaterThan(0);
      for (const stamp of audio.timestamps!) {
        expect(stamp.sentenceId).toBe(ref.line.sentence.id);
        expect(stamp.endMs).toBeLessThanOrEqual(audio.durationMs);
      }
      expect(audio.mouth).toMatch(/^[0-4]+$/);
      expect(Math.abs(audio.mouth!.length - Math.ceil(audio.durationMs / 40))).toBeLessThanOrEqual(
        1,
      );
    }
    // The tone MP3 is loud from 1.0 s to 2.4 s; the fake alignment stamps
    // words at 30 ms/char from 0 — so gating forces 0 after the last stamp
    // and the loud region inside the stamps opens the mouth.
    const first = lines[0]!.line.audio!; // «Проверка связи.» — 15 chars → stamps end ≈ 0.42 s
    expect(first.mouth!.slice(25)).toMatch(/^0+$/); // ≥ 1.0 s: loud audio, but outside every stamp
    const longest = scenario.glossary
      .flatMap((g) => [g.explain, g.howToSay])
      .sort((a, b) => b.sentence.ru.length - a.sentence.ru.length)[0]!;
    // «Name — по-русски «зовут»: «Меня зовут…».» — 41 chars → stamps run to ≈ 1.23 s,
    // so windows 25..30 (1.0–1.23 s) are loud AND inside a stamp.
    expect(longest.audio!.mouth!.slice(25, 30)).toMatch(/[1-4]/);
    // Coach audio landed on the expectations: free text ⇒ no stamps, mouth present.
    const prompting = scenario.turns.filter((t) => t.expect);
    expect(prompting).toHaveLength(2);
    for (const turn of prompting) {
      const coach = turn.expect!.coachAudio!;
      expect(coach.file).toBe(`audio/radio-a1/${turn.id}-coach.opus`);
      expect(coach.timestamps).toBeUndefined();
      expect(coach.mouth).toMatch(/^[0-4]+$/);
      expect(existsSync(join(outDir, coach.file))).toBe(true);
    }
    // Sidecars next to every render.
    expect(existsSync(join(outDir, 'render', 'radio-a1--radio-a1-t01-a.mp3.stamps.json'))).toBe(
      true,
    );

    // --mouth-only reproduces identical tracks (idempotent) and touches nothing else.
    const before = readFileSync(join(outDir, 'pack.json'), 'utf8');
    const mouthOnly = runMouthOnly(outDir);
    expect(mouthOnly.reports).toHaveLength(FIXTURE_LINES + 2);
    expect(mouthOnly.reports.every((r) => !r.changed)).toBe(true);
    expect(readFileSync(join(outDir, 'pack.json'), 'utf8')).toBe(before);

    // A second finalize with a filter carries every other line over untouched.
    captured.length = 0;
    const again = await runFinalize([FIXTURE_DRAFT], outDir, client, {
      scenarios: ['radio-a1'],
      seeds: { 'radio-a1/host': 11 },
    });
    expect(captured).toHaveLength(FIXTURE_LINES); // no coach this time…
    const t02 = again.pack.scenarios![0]!.turns.find((t) => t.id === 'radio-a1-t02')!;
    expect(t02.expect!.coachAudio).toBeDefined(); // …but the coach audio was carried over
  }, 120_000);

  it('omits coach audio entirely without playerAudio; the pack still validates (all-or-nothing)', async () => {
    const work = tempDir();
    const mp3 = makeToneMp3(work);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3) });
    const outDir = join(work, 'pack');
    const summary = await runFinalize([FIXTURE_DRAFT], outDir, client, { defaultSeed: 5 });
    expect(summary.scenarioReports).toHaveLength(FIXTURE_LINES);
    for (const turn of summary.pack.scenarios![0]!.turns) {
      expect(turn.expect?.coachAudio).toBeUndefined();
    }
    expect(existsSync(join(outDir, 'audio', 'radio-a1', 'radio-a1-t02-coach.opus'))).toBe(false);
  }, 120_000);
});

describe('publish: audio/<scenarioId>/*.opus + scene/**', () => {
  function makeContentRepo(): string {
    const dir = tempDir();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't57@test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T57 Test'], { cwd: dir });
    writeFileSync(
      join(dir, 'manifest.json'),
      `${JSON.stringify({ schemaVersion: 1, packs: [] }, null, 2)}\n`,
    );
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    return dir;
  }

  /** A voiced fixture pack dir with fake opus bytes for every referenced file. */
  function makeVoicedPackDir(): { dir: string; pack: Pack } {
    const dir = tempDir();
    const pack = fixturePack();
    const scenario = pack.scenarios![0]!;
    const audioFor = (sentenceId: string) => ({
      file: `audio/radio-a1/${sentenceId}.opus`,
      durationMs: 2000,
      mouth: '0'.repeat(50),
    });
    for (const ref of scenarioLines(scenario)) ref.line.audio = audioFor(ref.line.sentence.id);
    for (const turn of scenario.turns) {
      if (turn.expect) turn.expect.coachAudio = audioFor(`${turn.id}-coach`);
    }
    writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
    for (const rel of packFileList(pack).slice(1)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), `OPUS:${rel}`);
    }
    return { dir, pack };
  }

  it('packFileList lists every line + coach file; scene/** only with a pack dir that has one', () => {
    const { dir, pack } = makeVoicedPackDir();
    const files = packFileList(pack);
    expect(files[0]).toBe('pack.json');
    expect(files).toHaveLength(1 + FIXTURE_LINES + 2);
    expect(files).toContain('audio/radio-a1/radio-a1-t01-a.opus');
    expect(files).toContain('audio/radio-a1/radio-a1-t02-coach.opus');
    expect(files).toContain('audio/radio-a1/radio-a1-gl-check-ex.opus');
    expect(files).toContain('audio/radio-a1/radio-a1-nudge-silence.opus');
    expect(files.filter((f) => f.startsWith('scene/'))).toHaveLength(0);
    expect(packFileList(pack, dir)).toEqual(files); // no scene/ dir yet
    expect(sceneFiles(dir)).toEqual([]);
  });

  it('ships audio + a planted scene/ PNG, reports scene bytes separately; unchanged without it', () => {
    const content = makeContentRepo();
    const { dir } = makeVoicedPackDir();
    const plain = runPublish(dir, content);
    expect(plain.outcome).toBe('published');
    expect(plain.files.filter((f) => f.path.startsWith('audio/radio-a1/'))).toHaveLength(
      FIXTURE_LINES + 2,
    );
    expect(plain.sceneBytes).toBe(0);

    // Plant PNG layers at two depths, bump the version, publish again.
    mkdirSync(join(dir, 'scene', 'host'), { recursive: true });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1020)]);
    writeFileSync(join(dir, 'scene', 'backdrop.png'), png);
    writeFileSync(join(dir, 'scene', 'host', 'body.png'), png);
    writeFileSync(join(dir, 'scene', '.DS_Store'), 'junk'); // dotfiles never ship
    const packJson = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Pack;
    packJson.version = 2;
    writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(packJson, null, 2)}\n`);

    const withScene = runPublish(dir, content);
    expect(withScene.outcome).toBe('published');
    const scene = withScene.files.filter((f) => f.path.startsWith('scene/')).map((f) => f.path);
    expect(scene).toEqual(['scene/backdrop.png', 'scene/host/body.png']);
    expect(withScene.sceneBytes).toBe(2 * png.byteLength);
    expect(
      existsSync(join(content, 'packs', 'a1-scenario-fixture', 'scene', 'host', 'body.png')),
    ).toBe(true);
    expect(existsSync(join(content, 'packs', 'a1-scenario-fixture', 'scene', '.DS_Store'))).toBe(
      false,
    );
    const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8')) as {
      packs: { id: string; version: number; files: { path: string }[] }[];
    };
    const entry = manifest.packs.find((p) => p.id === 'a1-scenario-fixture')!;
    expect(entry.version).toBe(2);
    expect(entry.files.map((f) => f.path)).toContain('scene/host/body.png');
    // Re-publishing the same content at the same version is a no-op.
    expect(runPublish(dir, content).outcome).toBe('unchanged');
  });
});
