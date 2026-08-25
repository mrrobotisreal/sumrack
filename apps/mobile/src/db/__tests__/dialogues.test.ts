import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Pack } from '@sumrak/schema';
import dialoguePackJson from '@sumrak/schema/fixtures/packs/a2-dialogue-001/pack.json';

import { importPack, removePack } from '../importer';
import { createDialoguesRepo, DialogueRunPathSchema } from '../repositories/dialogues';
import { createContentRepo } from '../repositories/content';
import {
  dialogueChoices,
  dialogueEndings,
  dialogueNodeAudio,
  dialogueNodeStamps,
  dialogueNodes,
  dialogueRuns,
  dialogues,
  sentences,
  tokens,
} from '../schema';
import { createTestDb } from './helpers';

/**
 * T26: dialogue pack import (denormalize, version bump, removal, audio),
 * the dialogues repository (graph, run lifecycle, pathJson contract), and
 * the sentences-table reuse decision (FTS, storyId = dialogueId).
 */

const PACK = dialoguePackJson as unknown as Pack;
const PACK_ID = PACK.id;
const DIALOGUE_ID = 'dinner-mini';

/** The fixture with per-node audio attached (what a T26 render produces). */
function packWithAudio(): Pack {
  const clone = JSON.parse(JSON.stringify(dialoguePackJson)) as Pack;
  for (const dialogue of clone.dialogues!) {
    for (const node of dialogue.nodes) {
      node.audio = {
        file: `audio/${dialogue.id}/${node.sentence.id}.opus`,
        durationMs: 1500,
        timestamps: [
          { sentenceId: node.sentence.id, tokenIndex: 0, startMs: 0, endMs: 500 },
          ...(node.sentence.tokens.length > 2
            ? [{ sentenceId: node.sentence.id, tokenIndex: 2, startMs: 600, endMs: 1100 }]
            : []),
        ],
      };
      for (const choice of node.choices ?? []) {
        choice.audio = {
          file: `audio/${dialogue.id}/${choice.sentence.id}.opus`,
          durationMs: 1200,
          timestamps: [{ sentenceId: choice.sentence.id, tokenIndex: 0, startMs: 0, endMs: 400 }],
        };
      }
    }
  }
  return clone;
}

describe('dialogue pack import', () => {
  it('denormalizes the full graph into the dialogue content tables', async () => {
    const db = createTestDb();
    const result = await importPack(db, dialoguePackJson);
    expect(result.action).toBe('installed');
    expect(result.counts).toEqual({ stories: 0, dialogues: 1, sentences: 17, tokens: 91 });

    const [dialogueRows, nodeRows, choiceRows, endingRows] = await Promise.all([
      db.select().from(dialogues),
      db.select().from(dialogueNodes),
      db.select().from(dialogueChoices),
      db.select().from(dialogueEndings),
    ]);
    expect(dialogueRows).toHaveLength(1);
    expect(dialogueRows[0]).toMatchObject({
      id: DIALOGUE_ID,
      startNodeId: 'din-n01',
      level: 'A2',
    });
    expect((dialogueRows[0]!.characters as { id: string }[]).map((c) => c.id)).toEqual([
      'mama',
      'babushka',
      'player',
    ]);
    expect(nodeRows).toHaveLength(11);
    const n02 = nodeRows.find((n) => n.id === 'din-n02')!;
    expect(n02).toMatchObject({ kind: 'choices', nextNodeId: null, endingId: null });
    const n01 = nodeRows.find((n) => n.id === 'din-n01')!;
    expect(n01).toMatchObject({ kind: 'next', nextNodeId: 'din-n02', speakerId: 'mama' });
    const n08 = nodeRows.find((n) => n.id === 'din-n08')!;
    expect(n08).toMatchObject({ kind: 'ending', endingId: 'end-good' });
    expect(choiceRows).toHaveLength(6);
    const c1 = choiceRows.find((c) => c.id === 'din-n02-c1')!;
    expect(c1).toMatchObject({ nodeId: 'din-n02', nextNodeId: 'din-n03', orderIdx: 0 });
    expect(endingRows.map((e) => e.id).sort()).toEqual(['end-awkward', 'end-good', 'end-strange']);
  });

  it('puts node/choice sentences into the shared tables with storyId = dialogueId', async () => {
    const db = createTestDb();
    await importPack(db, dialoguePackJson);
    const sentenceRows = await db.select().from(sentences);
    expect(sentenceRows).toHaveLength(17); // 11 node lines + 6 choice lines
    expect(sentenceRows.every((s) => s.storyId === DIALOGUE_ID)).toBe(true);
    const tokenRows = await db.select().from(tokens);
    expect(tokenRows.every((t) => t.storyId === DIALOGUE_ID)).toBe(true);
    // ё-folded shadow columns populated like story tokens.
    const borshch = tokenRows.find((t) => t.text === 'борща');
    expect(borshch?.lemmaNorm).toBe('борщ');
  });

  it('dialogue tokens ride the FTS index (tokens_fts triggers fired)', async () => {
    const db = createTestDb();
    await importPack(db, dialoguePackJson);
    const content = createContentRepo(db);
    // «Проходи» is din-n01's first token; е-typed search must match too.
    const hits = await content.searchTokens('проходи');
    expect(hits.length).toBeGreaterThan(0);
    const raw = await db.all<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM tokens_fts WHERE tokens_fts MATCH 'борщ'`,
    );
    expect(raw[0]!.n).toBeGreaterThan(0);
  });

  it('stores node + choice audio with stamps and maps staged localUris', async () => {
    const db = createTestDb();
    const withAudio = packWithAudio();
    const audioFiles = {
      [`audio/${DIALOGUE_ID}/din-n01.opus`]: 'file:///packs/a2/audio/din-n01.opus',
    };
    await importPack(db, withAudio, { audioFiles });

    const audioRows = await db.select().from(dialogueNodeAudio);
    expect(audioRows).toHaveLength(17); // 11 node lines + 6 choice coach files
    const nodeAudio = audioRows.find((a) => a.sentenceId === 'din-n01')!;
    expect(nodeAudio).toMatchObject({
      nodeId: 'din-n01',
      choiceId: null,
      localUri: 'file:///packs/a2/audio/din-n01.opus',
      durationMs: 1500,
    });
    const coach = audioRows.find((a) => a.sentenceId === 'din-n02-c1')!;
    expect(coach).toMatchObject({ nodeId: 'din-n02', choiceId: 'din-n02-c1', localUri: null });

    const stamps = await db.select().from(dialogueNodeStamps);
    expect(stamps.length).toBeGreaterThan(17);
  });

  it('version bump replaces content and preserves dialogue_runs; removal cascades content only', async () => {
    const db = createTestDb();
    await importPack(db, dialoguePackJson);
    const repo = createDialoguesRepo(db);
    const run = await repo.startRun(DIALOGUE_ID, 'din-n01');
    await repo.recordStep(run.id, { nodeId: 'din-n02' });
    await repo.finishRun(run.id, { endingId: 'end-good' });

    // v2 reimport: content rows replaced, run + endings-seen untouched.
    const v2 = JSON.parse(JSON.stringify(dialoguePackJson)) as Pack;
    v2.version = 2;
    const updated = await importPack(db, v2);
    expect(updated.action).toBe('updated');
    expect(await db.select().from(dialogues)).toHaveLength(1);
    const runs = await repo.listRuns(DIALOGUE_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.endingId).toBe('end-good');
    // The preserved run still resolves against v2's content ids.
    const graph = await repo.getDialogueGraph(PACK_ID, DIALOGUE_ID);
    expect(graph!.endings.some((e) => e.id === runs[0]!.endingId)).toBe(true);

    // Same-version reimport is a no-op; downgrade refused.
    expect((await importPack(db, v2)).action).toBe('unchanged');
    expect((await importPack(db, dialoguePackJson)).action).toBe('skipped-older');

    // Removal: content gone (cascade), user rows intact and null-safe.
    await removePack(db, PACK_ID);
    expect(await db.select().from(dialogues)).toHaveLength(0);
    expect(await db.select().from(dialogueNodes)).toHaveLength(0);
    expect(await db.select().from(sentences)).toHaveLength(0);
    expect(await db.select().from(dialogueRuns)).toHaveLength(1);
    expect(await repo.listEndingsSeen(DIALOGUE_ID)).toHaveLength(1);
    expect(await repo.getDialogueGraph(PACK_ID, DIALOGUE_ID)).toBeNull();
    expect(await repo.listDialogues()).toHaveLength(0);
  });
});

describe('dialogues repository', () => {
  it('listDialogues reports counts incl. endings seen + finished runs', async () => {
    const db = createTestDb();
    await importPack(db, dialoguePackJson);
    const repo = createDialoguesRepo(db);

    let list = await repo.listDialogues();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: DIALOGUE_ID,
      nodeCount: 11,
      endingCount: 3,
      endingsSeenCount: 0,
      finishedRunCount: 0,
    });
    expect(list[0]!.characters.map((c) => c.audioTag)).toEqual(['[warm]', '[gentle]', undefined]);

    const run = await repo.startRun(DIALOGUE_ID, 'din-n01');
    await repo.finishRun(run.id, { endingId: 'end-strange' });
    list = await repo.listDialogues();
    expect(list[0]).toMatchObject({ endingsSeenCount: 1, finishedRunCount: 1 });
  });

  it('getDialogueGraph resolves sentences, choices, audio per line', async () => {
    const db = createTestDb();
    await importPack(db, packWithAudio(), {
      audioFiles: { [`audio/${DIALOGUE_ID}/din-n05.opus`]: 'file:///a/din-n05.opus' },
    });
    const repo = createDialoguesRepo(db);
    const graph = (await repo.getDialogueGraph(PACK_ID, DIALOGUE_ID))!;

    expect(graph.dialogue.startNodeId).toBe('din-n01');
    expect(graph.nodes).toHaveLength(11);
    expect(graph.nodes.map((n) => n.id)[0]).toBe('din-n01');
    const n02 = graph.nodes.find((n) => n.id === 'din-n02')!;
    expect(n02.sentence!.ru).toBe('Ты голодный?');
    expect(n02.sentence!.tokens.length).toBeGreaterThan(0);
    expect(n02.choices).toHaveLength(3);
    expect(n02.choices[0]!.sentence!.tokens.length).toBeGreaterThan(0);
    expect(n02.choices[0]!.audio!.file).toBe(`audio/${DIALOGUE_ID}/din-n02-c1.opus`);
    const n05 = graph.nodes.find((n) => n.id === 'din-n05')!;
    expect(n05.audio!.localUri).toBe('file:///a/din-n05.opus');

    const stamps = await repo.getStampsForSentence(PACK_ID, 'din-n01');
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps[0]).toMatchObject({ stampIndex: 0, tokenIndex: 0 });
  });

  it('run lifecycle: steps stamp choices onto the answered node; finish computes avg + collects endings', async () => {
    const db = createTestDb();
    await importPack(db, dialoguePackJson);
    const repo = createDialoguesRepo(db);

    const run = await repo.startRun(DIALOGUE_ID, 'din-n01');
    await repo.recordStep(run.id, { nodeId: 'din-n02' });
    const path = await repo.recordStep(run.id, {
      nodeId: 'din-n03',
      choiceId: 'din-n02-c1',
      score: 84,
    });
    expect(path.steps).toEqual([
      { nodeId: 'din-n01' },
      { nodeId: 'din-n02', choiceId: 'din-n02-c1', score: 84 },
      { nodeId: 'din-n03' },
    ]);

    const { run: finished, newEnding } = await repo.finishRun(run.id, { endingId: 'end-good' });
    expect(newEnding).toBe(true);
    expect(finished.spokenScoreAvg).toBe(84);
    expect(finished.endingId).toBe('end-good');

    // Second run to the same ending: not a new collect; stored path validates.
    const run2 = await repo.startRun(DIALOGUE_ID, 'din-n01');
    const result2 = await repo.finishRun(run2.id, { endingId: 'end-good' });
    expect(result2.newEnding).toBe(false);
    expect(result2.run.spokenScoreAvg).toBeNull();
    const stored = await repo.getRun(run.id);
    expect(() => repo.parseRunPath(stored!)).not.toThrow();

    // Finished runs refuse further writes; malformed steps are rejected.
    await expect(repo.recordStep(run.id, { nodeId: 'din-n04' })).rejects.toThrow(/finished/);
    const run3 = await repo.startRun(DIALOGUE_ID, 'din-n01');
    await expect(
      repo.recordStep(run3.id, { nodeId: 'x', choiceId: 'c', score: 150 }),
    ).rejects.toThrow();
  });

  it('pathJson contract rejects unknown keys and bad scores', () => {
    expect(
      DialogueRunPathSchema.safeParse({ v: 1, steps: [{ nodeId: 'a', extra: true }] }).success,
    ).toBe(false);
    expect(DialogueRunPathSchema.safeParse({ v: 2, steps: [] }).success).toBe(false);
    expect(
      DialogueRunPathSchema.safeParse({ v: 1, steps: [{ nodeId: 'a', score: -1 }] }).success,
    ).toBe(false);
    expect(
      DialogueRunPathSchema.safeParse({
        v: 1,
        steps: [{ nodeId: 'a', choiceId: 'c', score: 100 }],
      }).success,
    ).toBe(true);
  });
});
