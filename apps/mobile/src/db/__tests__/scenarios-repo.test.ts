import { describe, expect, it, vi } from 'vitest';
import { scenarioLines, type Pack } from '@sumrak/schema';
import scenarioPackJson from '@sumrak/schema/fixtures/packs/a1-scenario-fixture/pack.json';

import { importPack, removePack } from '../importer';
import { createRepositories } from '../repositories';
import {
  AttemptDetailSchema,
  ScenarioRunPathSchema,
  ScenarioTurnRuntimeSchema,
  createScenariosRepo,
} from '../repositories/scenarios';
import { scenarioRuns, scenarioTurns } from '../schema';
import { createTestDb } from './helpers';
import { sql } from 'drizzle-orm';

const tracked = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track: tracked }));

/**
 * T58: the scenarios repository surface (SPEAKING_SCENARIOS §4.3) over an
 * in-memory DB — reads with every JSON column Zod-parsed, the glossary
 * lookup, the run lifecycle (path/attempts/stats), and the stats repo's
 * scenario counts + the 'scenario' game-session mode.
 */

const PACK = scenarioPackJson as unknown as Pack;
const PACK_ID = PACK.id;
const SCENARIO_ID = 'radio-a1';

function packWithAudio(localUriFor?: (file: string) => string | null): Pack {
  const clone = JSON.parse(JSON.stringify(scenarioPackJson)) as Pack;
  for (const scenario of clone.scenarios!) {
    for (const ref of scenarioLines(scenario)) {
      const sentence = ref.line.sentence;
      const durationMs = 800;
      ref.line.audio = {
        file: `audio/${scenario.id}/${sentence.id}.opus`,
        durationMs,
        timestamps: [{ sentenceId: sentence.id, tokenIndex: 0, startMs: 0, endMs: 400 }],
        mouth: '01234321000000000000',
      };
    }
  }
  void localUriFor;
  return clone;
}

function allAudioFiles(pack: Pack): Record<string, string> {
  const out: Record<string, string> = {};
  for (const scenario of pack.scenarios!) {
    for (const ref of scenarioLines(scenario)) {
      out[ref.line.audio!.file] = `file:///packs/${pack.id}/${ref.line.audio!.file}`;
    }
  }
  return out;
}

const startInput = {
  packId: PACK_ID,
  scenarioId: SCENARIO_ID,
  familyId: 'radio',
  level: 'A1',
  startTurnId: 'radio-a1-t01',
};

const answerDetail = (score: number, matched = true) => ({
  kind: 'answer' as const,
  target: 'Меня зовут Митч.',
  words: [
    { display: 'Меня', target: 'меня', heard: 'меня', matched: true },
    { display: 'зовут', target: 'зовут', heard: 'завут', matched },
  ],
  score,
  slots: { name: matched ? 'free' : null },
});

describe('scenarios repository — content reads', () => {
  it('listScenarios groups rungs by family with counts, audioReady and run summaries', async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    const repo = createScenariosRepo(db);

    let families = await repo.listScenarios();
    expect(families).toHaveLength(1);
    expect(families[0]!.familyId).toBe('radio');
    expect(families[0]!.rungs).toHaveLength(1);
    expect(families[0]!.rungs[0]).toMatchObject({
      packId: PACK_ID,
      id: SCENARIO_ID,
      level: 'A1',
      turnCount: 6,
      glossaryCount: 15,
      audioReady: false,
      runCount: 0,
      lastRun: null,
      bestStats: null,
      packTitleEn: PACK.title.en,
    });

    // Rendered + staged everywhere → audioReady.
    const rendered = packWithAudio();
    rendered.version = 2;
    await importPack(db, rendered, { audioFiles: allAudioFiles(rendered) });
    families = await repo.listScenarios();
    expect(families[0]!.rungs[0]!.audioReady).toBe(true);

    // Rendered but nothing staged (cellular) → not ready.
    const deferred = packWithAudio();
    deferred.version = 3;
    await importPack(db, deferred);
    families = await repo.listScenarios();
    expect(families[0]!.rungs[0]!.audioReady).toBe(false);

    // Runs feed runCount / lastRun / bestStats (best = most clean turns).
    const r1 = await repo.startRun(startInput);
    await repo.recordStep(r1.id, { leaving: { misses: 2 }, nextTurnId: 'radio-a1-t02' });
    await repo.finishRun(r1.id, { endingId: 'end-ok' });
    const r2 = await repo.startRun(startInput);
    await repo.recordStep(r2.id, { nextTurnId: 'radio-a1-t02' });
    await repo.recordStep(r2.id, { nextTurnId: 'radio-a1-t03' });
    await repo.finishRun(r2.id, { endingId: 'end-ok' });
    const open = await repo.startRun(startInput);
    families = await repo.listScenarios();
    const rung = families[0]!.rungs[0]!;
    expect(rung.runCount).toBe(3);
    expect(rung.lastRun!.id).toBe(open.id);
    expect(rung.bestStats).toMatchObject({ turns: 3, cleanTurns: 3, misses: 0 });
  });

  it('getScenario returns the parsed runtime object: cast/scene/endings/nudges, turns, glossary, lines with audio + mouth, assets', async () => {
    const db = createTestDb();
    const rendered = packWithAudio();
    await importPack(db, rendered, {
      audioFiles: { [`audio/${SCENARIO_ID}/radio-a1-t01.opus`]: 'file:///a/radio-a1-t01.opus' },
      sceneFiles: { 'scene/host/body.png': { localUri: null, bytes: 1000 } },
    });
    const repo = createScenariosRepo(db);
    const detail = (await repo.getScenario(PACK_ID, SCENARIO_ID))!;

    expect(detail.scenario).toMatchObject({ id: SCENARIO_ID, startTurnId: 'radio-a1-t01' });
    expect((detail.scenario as Record<string, unknown>).castJson).toBeUndefined();
    expect(detail.cast.map((c) => c.role)).toEqual(['host', 'player']);
    expect(detail.cast[0]!.portrait?.placeholder).toEqual({ kind: 'man', hue: 25 });
    expect(detail.scene).toEqual({ accent: '#c26a3a', bed: 'studio', layout: 'center' });
    expect(detail.endings.map((e) => e.id)).toEqual(['end-ok']);
    expect(detail.nudges.map((n) => n.kind)).toEqual(['silence', 'which-word', 'dont-know']);

    expect(detail.turns.map((t) => t.id)).toEqual([
      'radio-a1-t01',
      'radio-a1-t02',
      'radio-a1-t03',
      'radio-a1-t04g',
      'radio-a1-t04b',
      'radio-a1-t04d',
    ]);
    const t01 = detail.turns[0]!;
    expect(t01).toMatchObject({
      say: ['radio-a1-t01-a', 'radio-a1-t01-b', 'radio-a1-t01'],
      expect: null,
      retry: null,
      next: 'radio-a1-t02',
      endingId: null,
    });
    const t02 = detail.turns[1]!;
    expect(t02.expect!.slots[0]).toMatchObject({ kind: 'free', id: 'name' });
    expect(t02.expect!.reject![0]!.reactSentenceId).toMatch(/^radio-a1-t02/);
    expect(t02.retry!.lifeline.ru).toEqual(expect.any(String));
    const t03 = detail.turns[2]!;
    expect(t03.expect!.branchOn).toBe('mood');
    expect(t03.next).toEqual({
      on: { good: 'radio-a1-t04g', bad: 'radio-a1-t04b' },
      default: 'radio-a1-t04d',
    });
    const endingTurns = detail.turns.filter((t) => t.endingId !== null);
    expect(endingTurns).toHaveLength(3);
    expect(endingTurns.every((t) => t.next === null)).toBe(true);

    expect(detail.glossary).toHaveLength(15);
    const check = detail.glossary.find((g) => g.id === 'radio-a1-gl-check')!;
    expect(check.forms).toEqual(['проверка', 'проверк*']);
    expect(check.translit).toEqual(['чек', 'чик', 'кек', 'кик']);

    expect(Object.keys(detail.lines)).toHaveLength(54);
    const prompt = detail.lines['radio-a1-t01']!;
    expect(prompt.sentence!.tokens.length).toBeGreaterThan(0);
    expect(prompt.audio).toMatchObject({
      variant: 'say',
      localUri: 'file:///a/radio-a1-t01.opus',
      mouth: '01234321000000000000',
    });
    expect(detail.lines['radio-a1-gl-check-ex']!.audio).toMatchObject({
      variant: 'explain',
      localUri: null,
    });
    expect(detail.assets).toEqual([
      { packId: PACK_ID, file: 'scene/host/body.png', localUri: null, bytes: 1000 },
    ]);

    const stamps = await repo.getStampsForSentence(PACK_ID, 'radio-a1-t01');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ stampIndex: 0, tokenIndex: 0, startMs: 0, endMs: 400 });

    expect(await repo.getScenario(PACK_ID, 'nope')).toBeNull();
    await removePack(db, PACK_ID);
    expect(await repo.getScenario(PACK_ID, SCENARIO_ID)).toBeNull();
  });

  it('an unreadable turn JSON resolves to a dropped turn + exactly one app_error', async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    await db
      .update(scenarioTurns)
      .set({ nextJson: '{not json' })
      .where(sql`${scenarioTurns.id} = 'radio-a1-t01'`);
    tracked.mockClear();
    const repo = createScenariosRepo(db);
    const first = (await repo.getScenario(PACK_ID, SCENARIO_ID))!;
    expect(first.turns.map((t) => t.id)).not.toContain('radio-a1-t01');
    expect(first.turns).toHaveLength(5);
    await repo.getScenario(PACK_ID, SCENARIO_ID);
    const errors = tracked.mock.calls.filter(([e]) => e === 'app_error');
    expect(errors).toEqual([['app_error', { scope: 'scenario-turn-parse', fatal: false }]]);
  });

  it('findGlossary matches ruNorm, forms and stem globs ё/е-tolerantly', async () => {
    const db = createTestDb();
    const clone = JSON.parse(JSON.stringify(scenarioPackJson)) as Pack;
    const entry = clone.scenarios![0]!.glossary[0]!;
    entry.ru = 'Ёлка';
    entry.forms = ['ёлка', 'ёлк*'];
    await importPack(db, clone);
    const repo = createScenariosRepo(db);

    expect((await repo.findGlossary(SCENARIO_ID, 'елка'))?.id).toBe(entry.id);
    expect((await repo.findGlossary(SCENARIO_ID, 'ЁЛКА'))?.id).toBe(entry.id);
    expect((await repo.findGlossary(SCENARIO_ID, 'ёлками'))?.id).toBe(entry.id);
    expect(await repo.findGlossary(SCENARIO_ID, 'ёл')).toBeNull();
    // Another entry by an inflected surface form (glob) — «проверк*» is gone
    // with entry 0 rewritten, so use a stable one: «связь» has forms.
    const svyaz = clone.scenarios![0]!.glossary.find((g) => g.ru === 'связь');
    if (svyaz) {
      expect((await repo.findGlossary(SCENARIO_ID, svyaz.forms[0]!))?.id).toBe(svyaz.id);
    }
    expect(await repo.findGlossary(SCENARIO_ID, '')).toBeNull();
    expect(await repo.findGlossary(SCENARIO_ID, 'абракадабра')).toBeNull();
    expect((await repo.findGlossary(SCENARIO_ID, 'елка', PACK_ID))?.id).toBe(entry.id);
    expect(await repo.findGlossary(SCENARIO_ID, 'елка', 'other-pack')).toBeNull();
  });

  it('sync helpers: listAudioForPack / setAudioLocalUri / listAssetsForPack / setAssetLocalUri', async () => {
    const db = createTestDb();
    await importPack(db, packWithAudio(), {
      sceneFiles: { 'scene/backdrop.png': { localUri: null, bytes: null } },
    });
    const repo = createScenariosRepo(db);
    const audio = await repo.listAudioForPack(PACK_ID);
    expect(audio).toHaveLength(54);
    expect(audio.every((a) => a.localUri === null)).toBe(true);
    await repo.setAudioLocalUri(PACK_ID, `audio/${SCENARIO_ID}/radio-a1-t01.opus`, 'file:///x');
    expect(
      (await repo.listAudioForPack(PACK_ID)).find((a) => a.sentenceId === 'radio-a1-t01')!.localUri,
    ).toBe('file:///x');

    expect(await repo.listAssetsForPack(PACK_ID)).toEqual([
      { packId: PACK_ID, file: 'scene/backdrop.png', localUri: null, bytes: null },
    ]);
    await repo.setAssetLocalUri(PACK_ID, 'scene/backdrop.png', 'file:///bd.png', 900);
    // Upsert: a layer the import never listed.
    await repo.setAssetLocalUri(PACK_ID, 'scene/host/body.png', 'file:///body.png');
    const assets = (await repo.listAssetsForPack(PACK_ID)).sort((a, b) =>
      a.file.localeCompare(b.file),
    );
    expect(assets).toEqual([
      { packId: PACK_ID, file: 'scene/backdrop.png', localUri: 'file:///bd.png', bytes: 900 },
      { packId: PACK_ID, file: 'scene/host/body.png', localUri: 'file:///body.png', bytes: null },
    ]);
  });
});

describe('scenarios repository — run lifecycle', () => {
  it('startRun → recordStep → recordAttempt → finishRun computes stats and reports newEnding', async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    const repo = createScenariosRepo(db);

    const run = await repo.startRun({ ...startInput, gameSessionId: 'gs-1' });
    expect(run).toMatchObject({
      packId: PACK_ID,
      scenarioId: SCENARIO_ID,
      familyId: 'radio',
      level: 'A1',
      finishedAt: null,
      endingId: null,
      statsJson: null,
      pinned: false,
      mediaLocal: true,
      mediaBundleState: null,
      gameSessionId: 'gs-1',
    });
    expect(repo.parseRunPath(run)).toEqual({
      v: 1,
      steps: [
        {
          turnId: 'radio-a1-t01',
          misses: 0,
          assisted: false,
          skipped: false,
          rescued: false,
          meta: 0,
        },
      ],
    });

    // t01 is a monologue → t02 (a prompt): two misses, a meta ask, then a match.
    await repo.recordStep(run.id, { nextTurnId: 'radio-a1-t02' });
    const a1 = await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'answer',
      outcome: 'miss',
      transcript: 'привет',
      detail: answerDetail(20, false),
      audioFile: `${run.id}/t02-1.ogg`,
      audioDurationMs: 900,
    });
    expect(a1.attemptNo).toBe(1);
    const m1 = await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'meta',
      outcome: 'explain',
      transcript: 'что значит проверка',
      detail: { kind: 'meta', query: 'проверка', hit: 'radio-a1-gl-check', source: 'glossary' },
    });
    expect(m1.attemptNo).toBe(2);
    const a2 = await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'answer',
      outcome: 'miss',
      transcript: 'я',
      detail: answerDetail(35, false),
    });
    expect(a2.attemptNo).toBe(3);
    const a3 = await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'answer',
      outcome: 'matched',
      transcript: 'меня зовут митч',
      detail: answerDetail(92),
    });
    expect(a3.attemptNo).toBe(4);
    const path = await repo.recordStep(run.id, {
      leaving: { misses: 2, assisted: true, meta: 1 },
      nextTurnId: 'radio-a1-t03',
    });
    expect(path.steps[1]).toEqual({
      turnId: 'radio-a1-t02',
      misses: 2,
      assisted: true,
      skipped: false,
      rescued: false,
      meta: 1,
    });
    expect(path.steps[2]!.turnId).toBe('radio-a1-t03');

    // t03 branches on mood → t04g (an ending turn).
    await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t03',
      kind: 'answer',
      outcome: 'rescued',
      transcript: 'всё супер',
      detail: { ...answerDetail(58), slots: { mood: 'good' } },
    });
    await repo.recordStep(run.id, {
      leaving: { branchKey: 'good', rescued: true },
      nextTurnId: 'radio-a1-t04g',
    });
    const {
      run: finished,
      stats,
      newEnding,
    } = await repo.finishRun(run.id, { endingId: 'end-ok' });
    expect(newEnding).toBe(true);
    expect(finished.endingId).toBe('end-ok');
    expect(finished.finishedAt).not.toBeNull();
    expect(stats).toEqual({
      turns: 4,
      cleanTurns: 2, // t01 (monologue) + t04g (ending); t02 missed twice, t03 rescued
      misses: 2,
      lifelines: 1,
      skips: 0,
      metaAsks: 1,
      rescues: 1,
      avgScore: 51.3, // (20 + 35 + 92 + 58) / 4 = 51.25 → 51.3
    });
    const stored = (await repo.getRun(run.id))!;
    expect(repo.parseRunStats(stored)).toEqual(stats);
    expect(repo.parseRunPath(stored)!.steps.map((s) => s.branchKey)).toEqual([
      undefined,
      undefined,
      'good',
      undefined,
    ]);

    // Second run to the same ending: not new. Finished runs refuse writes.
    const run2 = await repo.startRun(startInput);
    expect((await repo.finishRun(run2.id, { endingId: 'end-ok' })).newEnding).toBe(false);
    await expect(repo.recordStep(run.id, { nextTurnId: 'x' })).rejects.toThrow(/finished/);
    await expect(
      repo.recordAttempt({
        runId: run.id,
        turnId: 'x',
        kind: 'answer',
        outcome: 'miss',
        transcript: '',
        detail: answerDetail(0, false),
      }),
    ).rejects.toThrow(/finished/);
    // Outcome/detail domain enforced.
    const run3 = await repo.startRun(startInput);
    await expect(
      repo.recordAttempt({
        runId: run3.id,
        turnId: 'radio-a1-t02',
        kind: 'meta',
        outcome: 'matched',
        transcript: 'x',
        detail: { kind: 'meta', query: 'x', hit: null, source: 'none' },
      }),
    ).rejects.toThrow();
    await expect(
      repo.recordAttempt({
        runId: run3.id,
        turnId: 'radio-a1-t02',
        kind: 'answer',
        outcome: 'miss',
        transcript: 'x',
        detail: { kind: 'meta', query: 'x', hit: null, source: 'none' },
      }),
    ).rejects.toThrow(/mismatch/);
  });

  it('findResumableRun returns the newest unfinished run with a readable path; listRuns pages newest first', async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    const repo = createScenariosRepo(db);
    expect(await repo.findResumableRun(SCENARIO_ID)).toBeNull();

    const older = await repo.startRun(startInput);
    await new Promise((r) => setTimeout(r, 2));
    const finished = await repo.startRun(startInput);
    await repo.finishRun(finished.id, { endingId: 'end-ok' });
    await new Promise((r) => setTimeout(r, 2));
    const newest = await repo.startRun(startInput);
    expect((await repo.findResumableRun(SCENARIO_ID))!.id).toBe(newest.id);

    // A corrupt path is skipped in favour of the next resumable run.
    await db
      .update(scenarioRuns)
      .set({ pathJson: '{"v":9}' })
      .where(sql`${scenarioRuns.id} = ${newest.id}`);
    expect((await repo.findResumableRun(SCENARIO_ID))!.id).toBe(older.id);
    expect(await repo.findResumableRun('other')).toBeNull();

    const all = await repo.listRuns(SCENARIO_ID);
    expect(all.map((r) => r.id)).toEqual([newest.id, finished.id, older.id]);
    expect((await repo.listRuns(SCENARIO_ID, { limit: 1, offset: 1 })).map((r) => r.id)).toEqual([
      finished.id,
    ]);
    expect(await repo.listRuns()).toHaveLength(3);
    expect(await repo.listRuns('other')).toEqual([]);
  });

  it('getRunDebrief groups attempts per walked turn with details parsed; pin / prune / bundle bookkeeping', async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    const repo = createScenariosRepo(db);
    const run = await repo.startRun(startInput);
    await repo.recordStep(run.id, { nextTurnId: 'radio-a1-t02' });
    await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'answer',
      outcome: 'miss',
      transcript: 'э',
      detail: answerDetail(10, false),
      audioFile: 'r/1.ogg',
      audioDurationMs: 500,
    });
    await repo.recordAttempt({
      runId: run.id,
      turnId: 'radio-a1-t02',
      kind: 'answer',
      outcome: 'matched',
      transcript: 'меня зовут митч',
      detail: answerDetail(95),
      audioFile: 'r/2.ogg',
      audioDurationMs: 1500,
    });
    await repo.recordStep(run.id, { leaving: { misses: 1 }, nextTurnId: 'radio-a1-t03' });
    await repo.finishRun(run.id, { endingId: 'end-ok' });

    const debrief = (await repo.getRunDebrief(run.id))!;
    expect(debrief.turns.map((t) => t.turnId)).toEqual([
      'radio-a1-t01',
      'radio-a1-t02',
      'radio-a1-t03',
    ]);
    expect(debrief.turns[0]!.attempts).toEqual([]);
    expect(debrief.turns[1]!.attempts.map((a) => a.attemptNo)).toEqual([1, 2]);
    expect(debrief.turns[1]!.attempts[1]!.detail).toMatchObject({ kind: 'answer', score: 95 });
    expect(debrief.turns[1]!.step.misses).toBe(1);
    expect(debrief.stats).toMatchObject({ turns: 3, misses: 1, avgScore: 52.5 });
    expect(await repo.getRunDebrief('nope')).toBeNull();

    await repo.setPinned(run.id, true);
    expect((await repo.getRun(run.id))!.pinned).toBe(true);
    await repo.setMediaBundle(run.id, 'uploaded', 'bundle-2026-09-27.enc');
    expect(await repo.getRun(run.id)).toMatchObject({
      mediaBundleState: 'uploaded',
      mediaBundleName: 'bundle-2026-09-27.enc',
    });
    await repo.markMediaPruned([run.id]);
    expect((await repo.getRun(run.id))!.mediaLocal).toBe(false);
    const pruned = (await repo.getRunDebrief(run.id))!;
    expect(pruned.turns[1]!.attempts.every((a) => a.audioFile === null)).toBe(true);
    expect(pruned.turns[1]!.attempts[1]!.audioDurationMs).toBe(1500);
    await repo.markMediaPruned([]);
  });

  it('exported Zod contracts reject unknown keys and out-of-domain values', () => {
    expect(ScenarioRunPathSchema.safeParse({ v: 1, steps: [] }).success).toBe(true);
    expect(ScenarioRunPathSchema.safeParse({ v: 2, steps: [] }).success).toBe(false);
    expect(
      ScenarioRunPathSchema.safeParse({
        v: 1,
        steps: [
          {
            turnId: 't',
            misses: 0,
            assisted: false,
            skipped: false,
            rescued: false,
            meta: 0,
            extra: 1,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ScenarioRunPathSchema.safeParse({
        v: 1,
        steps: [
          { turnId: 't', misses: -1, assisted: false, skipped: false, rescued: false, meta: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      AttemptDetailSchema.safeParse({ kind: 'meta', query: 'x', hit: null, source: 'telepathy' })
        .success,
    ).toBe(false);
    expect(
      AttemptDetailSchema.safeParse({
        kind: 'answer',
        target: 't',
        words: [],
        score: 101,
        slots: {},
      }).success,
    ).toBe(false);
    expect(
      ScenarioTurnRuntimeSchema.safeParse({
        id: 't',
        orderIdx: 0,
        speakerId: 'host',
        say: ['s1'],
        expect: null,
        retry: null,
        next: { on: { a: 'x' }, default: 'y' },
        endingId: null,
      }).success,
    ).toBe(true);
    expect(
      ScenarioTurnRuntimeSchema.safeParse({
        id: 't',
        orderIdx: 0,
        speakerId: 'host',
        say: [],
        expect: null,
        retry: null,
        next: 'x',
        endingId: null,
      }).success,
    ).toBe(false);
  });
});

describe('stats repo — scenario counts + game-session mode', () => {
  it("startGameSession('scenario', { runId }) is accepted; getScenarioStats counts finished/clean runs and completed families", async () => {
    const db = createTestDb();
    await importPack(db, scenarioPackJson);
    const repos = createRepositories(db);

    const session = await repos.stats.startGameSession('scenario', { runId: 'run-x' });
    expect(session).toMatchObject({ mode: 'scenario', detail: { runId: 'run-x' } });
    expect((await repos.stats.listGameSessions())[0]!.mode).toBe('scenario');

    expect(await repos.stats.getScenarioStats()).toEqual({
      finishedRunCount: 0,
      cleanRunCount: 0,
      familiesCompleted: 0,
    });

    const clean = await repos.scenarios.startRun(startInput);
    await repos.scenarios.recordStep(clean.id, { nextTurnId: 'radio-a1-t02' });
    await repos.scenarios.finishRun(clean.id, { endingId: 'end-ok' });
    const dirty = await repos.scenarios.startRun(startInput);
    await repos.scenarios.recordStep(dirty.id, {
      leaving: { misses: 1 },
      nextTurnId: 'radio-a1-t02',
    });
    await repos.scenarios.finishRun(dirty.id, { endingId: 'end-ok' });
    await repos.scenarios.startRun(startInput); // open — never counts

    expect(await repos.stats.getScenarioStats()).toEqual({
      finishedRunCount: 2,
      cleanRunCount: 1,
      familiesCompleted: 1, // the one installed family has its only rung finished
    });

    // A run for a rung that is not installed proves nothing about "all".
    await removePack(db, PACK_ID);
    expect(await repos.stats.getScenarioStats()).toMatchObject({
      finishedRunCount: 2,
      familiesCompleted: 0,
    });
  });
});
