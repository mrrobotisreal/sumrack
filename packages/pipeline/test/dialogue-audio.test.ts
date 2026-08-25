import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { safeParsePack, type Pack } from '@sumrak/schema';
import { planAudioRun, runAudition, runFinalize } from '../src/audio.ts';
import { planDialogueItems } from '../src/dialogue-audio.ts';
import { annotateDrafts } from '../src/annotate.ts';
import { ElevenLabsClient } from '../src/elevenlabs.ts';

/**
 * T26 tests: per-node dialogue rendering — plan shapes, coach audio behind
 * playerAudio, per-character seed groups, per-node stamp mapping, the merged
 * pack validating against the schema (audio all-or-nothing), and the cost-
 * control dry run. Fake provider, real ffmpeg (T09 pattern).
 */

const FIXTURE_DRAFT = join(import.meta.dirname, '..', 'fixtures', 'the-dinner.dialogue.md');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sumrak-t26-'));
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

/** Fake ElevenLabs backend with the fixture's voice roster. */
function fakeFetch(mp3: Buffer, captured: { text: string; seed?: number }[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voices')) {
      return Response.json({
        voices: [
          { voice_id: 'm'.repeat(20), name: 'Mariia - Warm Narrator' },
          { voice_id: 'k'.repeat(20), name: 'Kate - Calm & Wise' },
          { voice_id: 'i'.repeat(20), name: 'Ivan - Neutral Reader' },
        ],
      });
    }
    if (u.includes('/with-timestamps')) {
      const body = JSON.parse(String(init!.body)) as { text: string; seed?: number };
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

function makeSilentMp3(dir: string, seconds: number): Buffer {
  const file = join(dir, 'silence.mp3');
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    String(seconds),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '128k',
    file,
  ]);
  return readFileSync(file);
}

describe('planDialogueItems', () => {
  it('plans one render per non-player node without playerAudio', () => {
    const items = planDialogueItems(fixturePack());
    // The fixture's 11 nodes are all NPC-spoken; no coach items.
    expect(items).toHaveLength(11);
    expect(items.every((i) => i.kind === 'node')).toBe(true);
    expect(new Set(items.map((i) => i.group))).toEqual(
      new Set(['dinner-mini/mama', 'dinner-mini/babushka']),
    );
    expect(items[0]!.file).toBe('audio/dinner-mini/din-n01.opus');
  });

  it('adds coach renders for every choice with playerAudio', () => {
    const items = planDialogueItems(fixturePack(), { playerAudio: true });
    const choices = items.filter((i) => i.kind === 'choice');
    expect(items).toHaveLength(17); // 11 nodes + 6 choices
    expect(choices).toHaveLength(6);
    expect(choices.every((i) => i.group === 'dinner-mini/player')).toBe(true);
    expect(choices.map((i) => i.file)).toContain('audio/dinner-mini/din-n02-c1.opus');
  });

  it('respects the dialogues filter', () => {
    expect(planDialogueItems(fixturePack(), { dialogues: ['other'] })).toHaveLength(0);
  });
});

describe('planAudioRun (cost gate dry run)', () => {
  it('counts finalize requests without any network', () => {
    const plan = planAudioRun([FIXTURE_DRAFT], { playerAudio: true });
    expect(plan.storyTracks).toBe(0);
    expect(plan.dialogueNodes).toBe(11);
    expect(plan.dialogueChoices).toBe(6);
    expect(plan.requests).toBe(17);
    expect(plan.chars).toBeGreaterThan(0);
  });

  it('audition counts one representative per character group × takes', () => {
    const plan = planAudioRun([FIXTURE_DRAFT], { audition: true, takes: 3 });
    // mama + babushka groups (no playerAudio) × 3 takes.
    expect(plan.requests).toBe(6);
  });
});

describe('dialogue audition (fake provider, real ffmpeg)', () => {
  it('renders takes per character group and never writes pack.json', async () => {
    const work = tempDir();
    const mp3 = makeSilentMp3(work, 3);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3) });
    const outDir = join(work, 'pack');

    const result = await runAudition([FIXTURE_DRAFT], outDir, client, {
      takes: 2,
      playerAudio: true,
    });
    expect(result.story).toHaveLength(0);
    // 3 groups (mama, babushka, player) × 2 takes.
    expect(result.dialogue).toHaveLength(6);
    for (const take of result.dialogue) expect(existsSync(take.file)).toBe(true);
    const mamaTakes = result.dialogue.filter((t) => t.characterId === 'mama');
    // Representative node = mama's longest line (din-n04, 26 chars).
    expect(new Set(mamaTakes.map((t) => t.nodeId))).toEqual(new Set(['din-n04']));
    expect(existsSync(join(outDir, 'pack.json'))).toBe(false);
  }, 30_000);
});

describe('dialogue finalize (fake provider, real ffmpeg)', () => {
  it('renders per-node opus + stamps and writes a schema-valid pack', async () => {
    const work = tempDir();
    const mp3 = makeSilentMp3(work, 4);
    const captured: { text: string; seed?: number }[] = [];
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3, captured) });
    const outDir = join(work, 'pack');

    const summary = await runFinalize([FIXTURE_DRAFT], outDir, client, {
      playerAudio: true,
      seeds: { 'dinner-mini/mama': 11, 'dinner-mini/babushka': 22, 'dinner-mini/player': 33 },
    });

    expect(summary.reports).toHaveLength(0);
    expect(summary.dialogueReports).toHaveLength(17);
    for (const report of summary.dialogueReports) {
      expect(report.stampResult.trusted).toBe(true);
      expect(report.stampResult.coverage).toBeGreaterThanOrEqual(0.95);
    }
    // Seeds follow the per-character groups.
    const byCharacter = new Map<string, Set<number>>();
    for (const r of summary.dialogueReports) {
      const set = byCharacter.get(r.characterId) ?? new Set<number>();
      set.add(r.seed);
      byCharacter.set(r.characterId, set);
    }
    expect(byCharacter.get('mama')).toEqual(new Set([11]));
    expect(byCharacter.get('babushka')).toEqual(new Set([22]));
    expect(byCharacter.get('player')).toEqual(new Set([33]));

    // The v3 audioTag rides ahead of the mama/babushka texts.
    const tagged = captured.filter(
      (r) => r.text.startsWith('[warm] ') || r.text.startsWith('[gentle] '),
    );
    expect(tagged.length).toBe(11); // all NPC node lines carry their character tag

    const raw = JSON.parse(readFileSync(join(outDir, 'pack.json'), 'utf8')) as unknown;
    const parsed = safeParsePack(raw);
    expect(parsed.success).toBe(true);
    const pack = (parsed as { success: true; data: Pack }).data;
    const dialogue = pack.dialogues![0]!;
    for (const node of dialogue.nodes) {
      expect(node.audio).toBeDefined();
      expect(existsSync(join(outDir, node.audio!.file))).toBe(true);
      expect(node.audio!.timestamps!.length).toBeGreaterThan(0);
      // Every stamp references the node's own sentence and stays in range.
      for (const stamp of node.audio!.timestamps!) {
        expect(stamp.sentenceId).toBe(node.sentence.id);
        expect(stamp.endMs).toBeLessThanOrEqual(node.audio!.durationMs);
      }
      for (const choice of node.choices ?? []) {
        expect(choice.audio).toBeDefined();
        expect(existsSync(join(outDir, choice.audio!.file))).toBe(true);
        expect(choice.audio!.timestamps!.every((s) => s.sentenceId === choice.sentence.id)).toBe(
          true,
        );
      }
    }
  }, 60_000);

  it('omits coach audio entirely without playerAudio', async () => {
    const work = tempDir();
    const mp3 = makeSilentMp3(work, 4);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(mp3) });
    const outDir = join(work, 'pack');

    const summary = await runFinalize([FIXTURE_DRAFT], outDir, client, {});
    expect(summary.dialogueReports).toHaveLength(11);
    const pack = summary.pack;
    for (const node of pack.dialogues![0]!.nodes) {
      for (const choice of node.choices ?? []) expect(choice.audio).toBeUndefined();
    }
  }, 60_000);
});
