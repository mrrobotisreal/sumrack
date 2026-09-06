import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Pack, WordStamp } from '@sumrak/schema';
import { runAudition, runFinalize, steerNarration } from '../src/audio.ts';
import { annotateDrafts } from '../src/annotate.ts';
import { ElevenLabsClient, ElevenLabsError } from '../src/elevenlabs.ts';
import { resolveEnvVar } from '../src/env.ts';
import { buildNarration, SENTENCE_SEPARATOR } from '../src/narration.ts';
import { runPublish } from '../src/publish.ts';
import { alignCharacters, mapAlignmentToStamps, type CharAlignment } from '../src/stamps.ts';

/**
 * T09 tests: narration spans, tolerant stamp mapping + hard invariants,
 * env resolution, ElevenLabs key hygiene, finalize (with a fake provider but
 * real ffmpeg/Opus), and publish (against throwaway git repos).
 */

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sumrak-t09-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const DRAFT = `---
pack:
  id: test-audio-pack
  version: 1
  type: stories
  title: { ru: 'Тест', en: 'Test' }
  level: A1
  tags: ['test']
story:
  id: test-story
  title: { ru: 'Тест', en: 'Test' }
  level: A1
voice:
  - id: test-track-anton
    voice: elevenlabs:Anton
    style: creepy-whisper
    stylePrompt: >-
      Slow and quiet.
    settings:
      stability: 0.4
---

## t-s01

RU: Ночь.
EN: Night.

| text | lemma | translation | pos  | grammar    | level | note |
| ---- | ----- | ----------- | ---- | ---------- | ----- | ---- |
| Ночь | ночь  | night       | noun | f.sg. nom. | A1    |      |
| .    |       |             |      |            |       |      |

## t-s02

RU: Дом молчит, но кто-то ходит наверху.
EN: The house is silent, but someone is walking upstairs.

| text    | lemma   | translation | pos  | grammar            | level | note |
| ------- | ------- | ----------- | ---- | ------------------ | ----- | ---- |
| Дом     | дом     | house       | noun | m.sg. nom.         | A1    |      |
| молчит  | молчать | is silent   | verb | 3sg. pres. (impf.) | A2    |      |
| ,       |         |             |      |                    |       |      |
| но      | но      | but         | conj |                    | A1    |      |
| кто-то  | кто-то  | someone     | pron | indefinite         | A1    |      |
| ходит   | ходить  | is walking  | verb | 3sg. pres. (impf.) | A1    |      |
| наверху | наверху | upstairs    | adv  |                    | A2    |      |
| .       |         |             |      |                    |       |      |
`;

function draftPack(): Pack {
  return annotateDrafts([{ path: 'test.draft.md', source: DRAFT }]);
}

/** Perfect character alignment for a narration text: 80ms per character. */
function perfectAlignment(text: string, msPerChar = 80): CharAlignment {
  const characters = Array.from(text);
  const startSeconds = characters.map((_, i) => (i * msPerChar) / 1000);
  const endSeconds = characters.map((_, i) => ((i + 1) * msPerChar) / 1000);
  return { characters, startSeconds, endSeconds };
}

describe('buildNarration', () => {
  it('spans reproduce each token and sentences join with the separator', () => {
    const pack = draftPack();
    const story = pack.stories[0]!;
    const narration = buildNarration(story);
    expect(narration.text).toBe(`Ночь.${SENTENCE_SEPARATOR}Дом молчит, но кто-то ходит наверху.`);
    for (const span of narration.spans) {
      const sentence = story.sentences.find((s) => s.id === span.sentenceId)!;
      expect(narration.text.slice(span.start, span.end)).toBe(
        sentence.tokens[span.tokenIndex]!.text,
      );
    }
    expect(narration.spans.filter((s) => !s.isPunct)).toHaveLength(7);
  });
});

describe('mapAlignmentToStamps', () => {
  const narrationOf = () => buildNarration(draftPack().stories[0]!);

  it('maps a perfect alignment to full-coverage monotonic stamps', () => {
    const narration = narrationOf();
    const alignment = perfectAlignment(narration.text);
    const duration = Array.from(narration.text).length * 80;
    const result = mapAlignmentToStamps(narration, alignment, duration);
    expect(result.trusted).toBe(true);
    expect(result.coverage).toBe(1);
    expect(result.matchedCharRatio).toBe(1);
    expect(result.stamps).toHaveLength(7); // word tokens only, no punctuation
    for (let i = 1; i < result.stamps.length; i++) {
      expect(result.stamps[i]!.startMs).toBeGreaterThanOrEqual(result.stamps[i - 1]!.endMs);
    }
    // Every stamp resolves to a real word token
    const story = draftPack().stories[0]!;
    for (const stamp of result.stamps) {
      const sentence = story.sentences.find((s) => s.id === stamp.sentenceId)!;
      expect(sentence.tokens[stamp.tokenIndex]!.isPunct).toBeUndefined();
    }
  });

  it('tolerates provider-side character drift (inserted/dropped chars)', () => {
    const narration = narrationOf();
    const alignment = perfectAlignment(narration.text);
    // Provider "normalized": inserted a char early and dropped one late.
    alignment.characters.splice(2, 0, ' ');
    alignment.startSeconds.splice(2, 0, alignment.startSeconds[2]!);
    alignment.endSeconds.splice(2, 0, alignment.endSeconds[2]!);
    const drop = alignment.characters.length - 3;
    alignment.characters.splice(drop, 1);
    alignment.startSeconds.splice(drop, 1);
    alignment.endSeconds.splice(drop, 1);

    const duration = alignment.characters.length * 80 + 200;
    const result = mapAlignmentToStamps(narration, alignment, duration);
    expect(result.trusted).toBe(true);
    expect(result.coverage).toBeGreaterThan(0.95);
  });

  it('drops ALL stamps when monotonicity is broken beyond clamp tolerance', () => {
    const narration = narrationOf();
    const alignment = perfectAlignment(narration.text);
    // Make one late word start long before the previous one ends.
    const lastWordSpan = narration.spans.filter((s) => !s.isPunct).at(-1)!;
    for (let u = lastWordSpan.start; u < lastWordSpan.end; u++) {
      alignment.startSeconds[u] = 0.01;
      alignment.endSeconds[u] = 0.02;
    }
    const duration = Array.from(narration.text).length * 80;
    const result = mapAlignmentToStamps(narration, alignment, duration);
    expect(result.trusted).toBe(false);
    expect(result.stamps).toHaveLength(0);
    expect(result.issues.join(' ')).toMatch(/monotonicity/);
  });

  it('marks the track untrusted when the provider text diverges wholesale', () => {
    const narration = narrationOf();
    const other = 'Совсем другой текст, ничего общего с рассказом вообще.';
    const result = mapAlignmentToStamps(narration, perfectAlignment(other), 10_000);
    expect(result.trusted).toBe(false);
    expect(result.stamps).toHaveLength(0);
  });

  it('clamps stamps to the track duration and drops zero-width results', () => {
    const narration = narrationOf();
    const alignment = perfectAlignment(narration.text);
    const totalMs = Array.from(narration.text).length * 80;
    const result = mapAlignmentToStamps(narration, alignment, totalMs - 400);
    expect(result.stamps.every((s: WordStamp) => s.endMs <= totalMs - 400)).toBe(true);
    expect(result.stamps.every((s: WordStamp) => s.endMs > s.startMs)).toBe(true);
  });
});

describe('alignCharacters', () => {
  it('is identity on an exact echo', () => {
    const map = alignCharacters('абв', ['а', 'б', 'в']);
    expect([...map]).toEqual([0, 1, 2]);
  });

  it('resynchronizes around a provider insertion', () => {
    const map = alignCharacters('абв', ['а', 'x', 'б', 'в']);
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(2);
    expect(map[2]).toBe(3);
  });
});

describe('resolveEnvVar', () => {
  it('reads from a .env file without touching process.env', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), '# comment\nTEST_PIPELINE_KEY="from-file"\n');
    expect(resolveEnvVar('TEST_PIPELINE_KEY', dir)).toBe('from-file');
    expect(process.env.TEST_PIPELINE_KEY).toBeUndefined();
  });

  it('prefers process.env and .env.local over .env', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'TEST_PIPELINE_KEY=base\n');
    writeFileSync(join(dir, '.env.local'), 'TEST_PIPELINE_KEY=local\n');
    expect(resolveEnvVar('TEST_PIPELINE_KEY', dir)).toBe('local');
    expect(resolveEnvVar('TEST_PIPELINE_MISSING', dir)).toBeUndefined();
  });
});

describe('ElevenLabsClient key hygiene', () => {
  const KEY = 'sk-super-secret-value-123';

  it('never leaks the API key into thrown errors', async () => {
    const fetchImpl = (async () =>
      new Response(`bad request: key ${KEY} rejected`, { status: 401 })) as typeof fetch;
    const client = new ElevenLabsClient(KEY, { fetchImpl });
    try {
      await client.listVoices();
      expect.unreachable('listVoices should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ElevenLabsError);
      expect((e as Error).message).not.toContain(KEY);
      expect((e as Error).message).toContain('«redacted»');
    }
  });

  it('resolves voice names, premade aliases, and raw ids', async () => {
    const fetchImpl = (async () =>
      Response.json({
        voices: [
          { voice_id: 'abcDEF1234567890abcd', name: 'Anton' },
          { voice_id: 'xyzXYZ1234567890wxyz', name: 'Callum - Husky Trickster' },
        ],
      })) as typeof fetch;
    const client = new ElevenLabsClient(KEY, { fetchImpl });
    expect(await client.resolveVoiceId('anton')).toBe('abcDEF1234567890abcd');
    expect(await client.resolveVoiceId('Callum')).toBe('xyzXYZ1234567890wxyz');
    expect(await client.resolveVoiceId('Callum - Husky Trickster')).toBe('xyzXYZ1234567890wxyz');
    expect(await client.resolveVoiceId('abcDEF1234567890abcd')).toBe('abcDEF1234567890abcd');
    await expect(client.resolveVoiceId('Nobody')).rejects.toThrow(/no voice named "Nobody"/);
  });
});

/** A fake ElevenLabs backend: real HTTP shapes, deterministic audio + alignment. */
function fakeElevenLabsFetch(mp3: Buffer, captured: unknown[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voices')) {
      return Response.json({ voices: [{ voice_id: 'v'.repeat(20), name: 'Anton' }] });
    }
    if (u.includes('/with-timestamps')) {
      const body = JSON.parse(String(init!.body)) as { text: string };
      captured.push(body);
      const characters = Array.from(body.text);
      // 60ms per char, comfortably inside the generated audio's duration.
      return Response.json({
        audio_base64: mp3.toString('base64'),
        alignment: {
          characters,
          character_start_times_seconds: characters.map((_, i) => (i * 60) / 1000),
          character_end_times_seconds: characters.map((_, i) => ((i + 1) * 60) / 1000),
        },
      });
    }
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
}

/** Generate a short silent MP3 with ffmpeg (long enough to cover the alignment). */
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
    `anullsrc=r=44100:cl=mono`,
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

describe('runFinalize (fake provider, real ffmpeg)', () => {
  it('renders, encodes Opus, maps stamps, and writes a valid pack.json', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(draftFile, DRAFT);
    const mp3 = makeSilentMp3(work, 3);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeElevenLabsFetch(mp3) });

    const outDir = join(work, 'pack');
    const summary = await runFinalize([draftFile], outDir, client, { defaultSeed: 7 });

    expect(summary.reports).toHaveLength(1);
    const report = summary.reports[0]!;
    expect(report.seed).toBe(7);
    expect(report.stampResult.trusted).toBe(true);
    expect(report.stampResult.coverage).toBeGreaterThan(0.95);
    expect(existsSync(join(outDir, 'audio', 'test-track-anton.opus'))).toBe(true);

    const pack = JSON.parse(readFileSync(join(outDir, 'pack.json'), 'utf8')) as Pack;
    const track = pack.stories[0]!.audio[0]!;
    expect(track.id).toBe('test-track-anton');
    expect(track.file).toBe('audio/test-track-anton.opus');
    expect(track.durationMs).toBeGreaterThan(2000);
    expect(track.timestamps.length).toBe(7);
  });

  it('v3 default: audioTag prefixes the text, spans stay exact, previous_text omitted', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(
      draftFile,
      DRAFT.replace('    settings:', "    audioTag: '[whispers]'\n    settings:"),
    );
    const mp3 = makeSilentMp3(work, 4);
    const captured: { text: string; previous_text?: string; model_id: string }[] = [];
    const client = new ElevenLabsClient('test-key', {
      fetchImpl: fakeElevenLabsFetch(mp3, captured),
    });

    const outDir = join(work, 'pack');
    const summary = await runFinalize([draftFile], outDir, client, { defaultSeed: 7 });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.model_id).toBe('eleven_v3');
    expect(captured[0]!.text.startsWith('[whispers] Ночь.')).toBe(true);
    expect(captured[0]!.previous_text).toBeUndefined(); // v3 rejects it
    const report = summary.reports[0]!;
    expect(report.stampResult.trusted).toBe(true);
    expect(report.stampResult.coverage).toBe(1); // tag chars never stamped, tokens all are
  });

  it('non-v3 model keeps previous_text and ignores audioTag', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(
      draftFile,
      DRAFT.replace('    settings:', "    audioTag: '[whispers]'\n    settings:"),
    );
    const mp3 = makeSilentMp3(work, 4);
    const captured: { text: string; previous_text?: string }[] = [];
    const client = new ElevenLabsClient('test-key', {
      fetchImpl: fakeElevenLabsFetch(mp3, captured),
    });

    await runFinalize([draftFile], join(work, 'pack'), client, {
      defaultSeed: 7,
      modelId: 'eleven_multilingual_v2',
    });
    expect(captured[0]!.text.startsWith('Ночь.')).toBe(true);
    expect(captured[0]!.previous_text).toBe('Slow and quiet.');
  });

  it('v3 + audioCues: cue inserted after the separator, spans exact, coverage 1', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(
      draftFile,
      DRAFT.replace(
        '    settings:',
        "    audioTag: '[fearful]'\n    audioCues:\n      t-s02: '[whispers]'\n    settings:",
      ),
    );
    const mp3 = makeSilentMp3(work, 5);
    const captured: { text: string }[] = [];
    const client = new ElevenLabsClient('test-key', {
      fetchImpl: fakeElevenLabsFetch(mp3, captured),
    });

    const outDir = join(work, 'pack');
    const summary = await runFinalize([draftFile], outDir, client, { defaultSeed: 7 });

    expect(captured[0]!.text).toBe(
      `[fearful] Ночь.${SENTENCE_SEPARATOR}[whispers] Дом молчит, но кто-то ходит наверху.`,
    );
    const report = summary.reports[0]!;
    expect(report.stampResult.trusted).toBe(true);
    expect(report.stampResult.coverage).toBe(1);
    // Spans are exact: every stamp maps back onto the cued text at the shifted offset.
    const story = draftPack().stories[0]!;
    const narration = steerNarration(
      buildNarration(story),
      {
        id: 'x',
        audioTag: '[fearful]',
        audioCues: { 't-s02': '[whispers]' },
      },
      true,
    );
    for (const span of narration.spans) {
      const sentence = story.sentences.find((s) => s.id === span.sentenceId)!;
      expect(narration.text.slice(span.start, span.end)).toBe(
        sentence.tokens[span.tokenIndex]!.text,
      );
    }
    // Cue chars themselves are never stamped: the first word of t-s02 starts after the cue.
    const pack = JSON.parse(readFileSync(join(outDir, 'pack.json'), 'utf8')) as Pack;
    const stamps = pack.stories[0]!.audio[0]!.timestamps;
    const firstOfS02 = stamps.find((st) => st.sentenceId === 't-s02' && st.tokenIndex === 0)!;
    const expectedStartMs = narration.spans.find((sp) => sp.sentenceId === 't-s02')!.start * 60;
    expect(firstOfS02.startMs).toBe(expectedStartMs);
  });

  it('non-v3 model + audioCues: narration text unchanged', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(
      draftFile,
      DRAFT.replace('    settings:', "    audioCues:\n      t-s02: '[whispers]'\n    settings:"),
    );
    const mp3 = makeSilentMp3(work, 4);
    const captured: { text: string }[] = [];
    const client = new ElevenLabsClient('test-key', {
      fetchImpl: fakeElevenLabsFetch(mp3, captured),
    });
    await runFinalize([draftFile], join(work, 'pack'), client, {
      defaultSeed: 7,
      modelId: 'eleven_multilingual_v2',
    });
    expect(captured[0]!.text).toBe(
      `Ночь.${SENTENCE_SEPARATOR}Дом молчит, но кто-то ходит наверху.`,
    );
  });

  it('audioCues keyed to an unknown sentence id throws (never a silent skip)', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(
      draftFile,
      DRAFT.replace('    settings:', "    audioCues:\n      t-s99: '[whispers]'\n    settings:"),
    );
    const mp3 = makeSilentMp3(work, 4);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeElevenLabsFetch(mp3) });
    await expect(
      runFinalize([draftFile], join(work, 'pack'), client, { defaultSeed: 7 }),
    ).rejects.toThrow(/audioCues reference sentence id\(s\) not in this story: t-s99/);
  });

  it('audition renders take files and never writes pack.json', async () => {
    const work = tempDir();
    const draftFile = join(work, 'test.draft.md');
    writeFileSync(draftFile, DRAFT);
    const mp3 = makeSilentMp3(work, 3);
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeElevenLabsFetch(mp3) });

    const outDir = join(work, 'pack');
    const result = await runAudition([draftFile], outDir, client, { takes: 2 });
    const takes = result.story;
    expect(takes).toHaveLength(2);
    expect(result.dialogue).toHaveLength(0);
    expect(new Set(takes.map((t) => t.seed)).size).toBe(2);
    for (const take of takes) expect(existsSync(take.file)).toBe(true);
    expect(existsSync(join(outDir, 'pack.json'))).toBe(false);
  });
});

describe('runPublish', () => {
  function makeContentRepo(): string {
    const dir = tempDir();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't09@test'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T09 Test'], { cwd: dir });
    writeFileSync(
      join(dir, 'manifest.json'),
      `${JSON.stringify({ schemaVersion: 1, packs: [] }, null, 2)}\n`,
    );
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
    return dir;
  }

  function makePackDir(version = 1, audioBytes = 'OPUSDATA'): string {
    const dir = tempDir();
    const pack = draftPack();
    const withAudio: Pack = {
      ...pack,
      version,
      stories: pack.stories.map((s) => ({
        ...s,
        audio: [
          {
            id: 'test-track-anton',
            voice: 'elevenlabs:Anton',
            style: 'creepy-whisper',
            file: 'audio/test-track-anton.opus',
            durationMs: 3000,
            timestamps: [],
          },
        ],
      })),
    };
    writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(withAudio, null, 2)}\n`);
    mkdirSync(join(dir, 'audio'), { recursive: true });
    writeFileSync(join(dir, 'audio', 'test-track-anton.opus'), audioBytes);
    return dir;
  }

  it('publishes a new pack: files copied, manifest updated, commit created', () => {
    const content = makeContentRepo();
    const packDir = makePackDir();
    const summary = runPublish(packDir, content);

    expect(summary.outcome).toBe('published');
    expect(summary.files.map((f) => f.path).sort()).toEqual([
      'audio/test-track-anton.opus',
      'pack.json',
    ]);
    expect(
      existsSync(join(content, 'packs', 'test-audio-pack', 'audio', 'test-track-anton.opus')),
    ).toBe(true);

    const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8'));
    expect(manifest.packs).toHaveLength(1);
    expect(manifest.packs[0].id).toBe('test-audio-pack');
    expect(manifest.packs[0].bytes).toBe(summary.totalBytes);

    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: content,
      encoding: 'utf8',
    });
    expect(status.trim()).toBe(''); // everything committed
  });

  it('is a no-op at the same version with identical content', () => {
    const content = makeContentRepo();
    const packDir = makePackDir();
    runPublish(packDir, content);
    const again = runPublish(packDir, content);
    expect(again.outcome).toBe('unchanged');
  });

  it('refuses same-version publishes with changed content', () => {
    const content = makeContentRepo();
    runPublish(makePackDir(1, 'OPUS-A'), content);
    expect(() => runPublish(makePackDir(1, 'OPUS-B'), content)).toThrow(/bump the pack version/);
  });

  it('refuses downgrades and accepts version bumps', () => {
    const content = makeContentRepo();
    runPublish(makePackDir(2), content);
    expect(() => runPublish(makePackDir(1), content)).toThrow(/refusing to publish older/);
    const bumped = runPublish(makePackDir(3, 'NEW-AUDIO'), content);
    expect(bumped.outcome).toBe('published');
    const manifest = JSON.parse(readFileSync(join(content, 'manifest.json'), 'utf8'));
    expect(manifest.packs).toHaveLength(1);
    expect(manifest.packs[0].version).toBe(3);
  });

  it('refuses to publish into a dirty content repo', () => {
    const content = makeContentRepo();
    writeFileSync(join(content, 'stray.txt'), 'uncommitted');
    expect(() => runPublish(makePackDir(), content)).toThrow(/uncommitted changes/);
  });
});
