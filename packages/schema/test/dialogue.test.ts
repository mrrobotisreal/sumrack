import { describe, expect, it } from 'vitest';
import { analyzeDialogueGraph, safeParsePack, type Dialogue } from '../src';
import { makeChoice, makeNode, makeValidDialoguePack, makeValidPack } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

function expectIssue(pack: unknown, pathSubstr: string, messageSubstr: string) {
  const result = safeParsePack(pack);
  expect(result.success).toBe(false);
  if (result.success) return;
  const hit = result.issues.find(
    (i) => i.path.includes(pathSubstr) && i.message.includes(messageSubstr),
  );
  expect(
    hit,
    `expected an issue at "${pathSubstr}" mentioning "${messageSubstr}", got:\n${result.message}`,
  ).toBeDefined();
}

const dlg = (pack: any) => pack.dialogues[0];

describe('dialogue pack — shape', () => {
  it('accepts a minimal valid dialogue pack', () => {
    const result = safeParsePack(makeValidDialoguePack());
    expect(result.success, result.success ? '' : result.message).toBe(true);
  });

  it('a "dialogue" pack must contain at least one dialogue', () => {
    const pack = makeValidDialoguePack() as any;
    pack.dialogues = [];
    expectIssue(pack, 'dialogues', 'at least one dialogue');
    delete pack.dialogues;
    expectIssue(pack, 'dialogues', 'at least one dialogue');
  });

  it('existing pack types are untouched by the dialogues field (additive change)', () => {
    // a stories pack without the key still validates …
    expect(safeParsePack(makeValidPack()).success).toBe(true);
    // … and a stories pack MAY carry dialogues (permissive, like other sections)
    const pack = makeValidPack() as any;
    pack.dialogues = (makeValidDialoguePack() as any).dialogues;
    expect(safeParsePack(pack).success).toBe(true);
  });

  it('rejects duplicate dialogue ids', () => {
    const pack = makeValidDialoguePack() as any;
    const clone = structuredClone(dlg(pack));
    // rename node/choice sentence ids so only the dialogue id collides
    clone.nodes.forEach((n: any) => {
      n.id = `b-${n.id}`;
      n.sentence.id = n.id;
      if (n.next) n.next = `b-${n.next}`;
      if (n.choices)
        n.choices.forEach((c: any) => {
          c.id = `b-${c.id}`;
          c.sentence.id = c.id;
          c.next = `b-${c.next}`;
        });
    });
    clone.startNodeId = 'b-dlg-n1';
    pack.dialogues.push(clone);
    expectIssue(pack, 'dialogues[1].id', 'duplicate dialogue id');
  });
});

describe('dialogue node — exactly one of choices | next | endingId', () => {
  it('rejects a node with none of the three', () => {
    const pack = makeValidDialoguePack() as any;
    delete dlg(pack).nodes[0].next;
    expectIssue(
      pack,
      'dialogues[0].nodes[0]',
      'exactly one of "choices", "next", or "endingId" (has none)',
    );
  });

  it('rejects a node with two of the three, naming which', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].endingId = 'e-good';
    expectIssue(pack, 'dialogues[0].nodes[0]', '(has: next, endingId)');
  });
});

describe('dialogue graph — resolvability', () => {
  it('rejects a dangling next', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].next = 'dlg-ghost';
    expectIssue(pack, 'dialogues[0].nodes[0].next', 'next "dlg-ghost" does not resolve to a node');
  });

  it('rejects a dangling choice target', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[1].choices[1].next = 'dlg-ghost';
    expectIssue(pack, 'dialogues[0].nodes[1].choices[1].next', 'does not resolve to a node');
  });

  it('rejects a dangling endingId', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[2].endingId = 'e-ghost';
    expectIssue(
      pack,
      'dialogues[0].nodes[2].endingId',
      'endingId "e-ghost" does not resolve to an ending',
    );
  });

  it('rejects a dangling startNodeId', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).startNodeId = 'dlg-ghost';
    expectIssue(pack, 'dialogues[0].startNodeId', 'does not resolve to a node');
  });

  it('rejects an unresolvable speakerId', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].speakerId = 'ghost';
    expectIssue(pack, 'dialogues[0].nodes[0].speakerId', 'does not resolve to a character');
  });
});

describe('dialogue graph — player semantics', () => {
  it('rejects choices on a node speaking as "player"', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[1].speakerId = 'player';
    expectIssue(pack, 'dialogues[0].nodes[1].choices', 'choices already speak as the player');
  });

  it('allows a scripted (non-branching) player line', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].speakerId = 'player';
    expect(safeParsePack(pack).success).toBe(true);
  });
});

describe('dialogue graph — reachability & endings', () => {
  it('rejects an unreachable node', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes.push(makeNode('dlg-n5', 'mama', 'Стоп.', { endingId: 'e-bad' }));
    expectIssue(
      pack,
      'dialogues[0].nodes[4]',
      'node "dlg-n5" is unreachable from startNodeId "dlg-n1"',
    );
  });

  it('rejects a dead-trap cycle (no exit to an ending)', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[2] = makeNode('dlg-n3', 'mama', 'Хорошо.', { next: 'dlg-n3' }); // self-loop
    expectIssue(pack, 'dialogues[0].nodes[2]', 'dead trap');
  });

  it('accepts a cycle that keeps an exit path to an ending', () => {
    const pack = makeValidDialoguePack() as any;
    // n3 loops back to the choice point; the other choice still exits via n4
    dlg(pack).nodes[2] = makeNode('dlg-n3', 'mama', 'Хорошо.', { next: 'dlg-n2' });
    dlg(pack).endings = dlg(pack).endings.filter((e: any) => e.id !== 'e-good');
    const result = safeParsePack(pack);
    expect(result.success, result.success ? '' : result.message).toBe(true);
    expect(analyzeDialogueGraph(dlg(pack) as Dialogue).hasCycle).toBe(true);
  });

  it('flags every trapped node when no ending is reachable at all', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[2] = makeNode('dlg-n3', 'mama', 'Хорошо.', { next: 'dlg-n2' });
    dlg(pack).nodes[3] = makeNode('dlg-n4', 'mama', 'Ладно.', { next: 'dlg-n2' });
    expectIssue(pack, 'dialogues[0].nodes[0]', 'dead trap');
    expectIssue(pack, 'dialogues[0].endings[0]', 'never referenced');
    expectIssue(pack, 'dialogues[0].endings[1]', 'never referenced');
  });

  it('rejects an ending no node references', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).endings.push({
      id: 'e-strange',
      title: { ru: 'Странно', en: 'Strange' },
      recap: { ru: 'Очень странно.', en: 'Very strange.' },
      tone: 'strange',
    });
    expectIssue(
      pack,
      'dialogues[0].endings[2]',
      'ending "e-strange" is never referenced by any node',
    );
  });
});

describe('dialogue graph — bounds & id uniqueness', () => {
  it('rejects more than 60 nodes', () => {
    const pack = makeValidDialoguePack() as any;
    const d = dlg(pack);
    for (let i = 0; i < 57; i++) {
      d.nodes.splice(1, 0, makeNode(`dlg-x${i}`, 'mama', 'Да.', { next: 'dlg-n2' }));
      d.nodes[0].next = `dlg-x${i}`;
      d.nodes[1].next = i === 0 ? 'dlg-n2' : `dlg-x${i - 1}`;
    }
    // 61 nodes now; sentence ids collide (Да.) — fix them to isolate the bound
    d.nodes.forEach((n: any, i: number) => {
      n.sentence.id = `dlg-sent-${i}`;
    });
    expectIssue(pack, 'dialogues[0].nodes', '60');
  });

  it('rejects a single choice and more than four choices', () => {
    const one = makeValidDialoguePack() as any;
    dlg(one).nodes[1].choices = dlg(one).nodes[1].choices.slice(0, 1);
    expectIssue(one, 'dialogues[0].nodes[1].choices', '2');

    const five = makeValidDialoguePack() as any;
    for (let i = 0; i < 3; i++) {
      dlg(five).nodes[1].choices.push(makeChoice(`dlg-n2-x${i}`, 'Может быть.', 'dlg-n3'));
      dlg(five).nodes[1].choices[2 + i].sentence.id = `dlg-n2-x${i}`;
    }
    expectIssue(five, 'dialogues[0].nodes[1].choices', '4');
  });

  it('rejects duplicate node / choice / ending / character ids', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[3].id = 'dlg-n3';
    dlg(pack).nodes[3].sentence.id = 'dlg-n4-sent';
    expectIssue(pack, 'dialogues[0].nodes[3].id', 'duplicate node id "dlg-n3"');

    const pack2 = makeValidDialoguePack() as any;
    dlg(pack2).nodes[1].choices[1].id = 'dlg-n2-c1';
    dlg(pack2).nodes[1].choices[1].sentence.id = 'dlg-n2-c2';
    expectIssue(pack2, 'dialogues[0].nodes[1].choices[1].id', 'duplicate choice id');

    const pack3 = makeValidDialoguePack() as any;
    dlg(pack3).endings[1].id = 'e-good';
    dlg(pack3).nodes[3].endingId = 'e-good';
    expectIssue(pack3, 'dialogues[0].endings[1].id', 'duplicate ending id');

    const pack4 = makeValidDialoguePack() as any;
    dlg(pack4).characters[1].id = 'mama';
    expectIssue(pack4, 'dialogues[0].characters[1].id', 'duplicate character id');
  });
});

describe('dialogue sentences — pack-wide sentence ids & invariants', () => {
  it('rejects a dialogue sentence id colliding with a story sentence id', () => {
    const stories = (makeValidPack() as any).stories;
    const pack = makeValidDialoguePack() as any;
    pack.stories = stories; // story sentence id "test-s01"
    dlg(pack).nodes[0].sentence.id = 'test-s01';
    expectIssue(pack, 'dialogues[0].nodes[0].sentence.id', 'duplicate sentence id "test-s01"');
  });

  it('rejects a choice sentence id colliding with a node sentence id', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[1].choices[0].sentence.id = 'dlg-n1';
    expectIssue(pack, 'dialogues[0].nodes[1].choices[0].sentence.id', 'duplicate sentence id');
  });

  it('dialogue sentences enforce the reconstruction invariant', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].sentence.tokens[0].text = 'Пока';
    expectIssue(pack, 'dialogues[0].nodes[0].sentence.tokens', 'do not reconstruct');
  });

  it('dialogue sentences enforce NFC (ё never decomposed)', () => {
    const pack = makeValidDialoguePack() as any;
    const s = dlg(pack).nodes[0].sentence;
    s.ru = 'Всё.'.normalize('NFD');
    s.tokens = [{ text: 'x', isPunct: true }];
    expectIssue(pack, 'dialogues[0].nodes[0].sentence.ru', 'NFC');
  });

  it('asrAlternates must be NFC-normalized', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[1].choices[0].asrAlternates = ['Всё хорошо.'.normalize('NFD')];
    expectIssue(pack, 'dialogues[0].nodes[1].choices[0].asrAlternates[0]', 'NFC');
  });
});

describe('dialogue node audio', () => {
  const audioFor = (node: any) => ({
    file: `audio/test-dlg/${node.id}.opus`,
    durationMs: 2000,
    timestamps: [{ sentenceId: node.sentence.id, tokenIndex: 0, startMs: 0, endMs: 500 }],
  });

  it('accepts a fully voiced dialogue (player lines exempt)', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].speakerId = 'player'; // scripted player line, no audio needed
    for (const node of dlg(pack).nodes.slice(1)) node.audio = audioFor(node);
    const result = safeParsePack(pack);
    expect(result.success, result.success ? '' : result.message).toBe(true);
  });

  it('rejects a half-voiced dialogue, naming the unvoiced node', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].audio = audioFor(dlg(pack).nodes[0]);
    expectIssue(pack, 'dialogues[0].nodes[1].audio', 'node "dlg-n2" (speaker "mama") has none');
  });

  it('rejects node audio stamps pointing at a foreign sentence', () => {
    const pack = makeValidDialoguePack() as any;
    for (const node of dlg(pack).nodes) node.audio = audioFor(node);
    dlg(pack).nodes[0].audio.timestamps[0].sentenceId = 'dlg-n2';
    expectIssue(
      pack,
      'dialogues[0].nodes[0].audio.timestamps[0].sentenceId',
      'node "dlg-n1" speaks sentence "dlg-n1"',
    );
  });

  it('rejects out-of-range tokenIndex and endMs past the duration', () => {
    const pack = makeValidDialoguePack() as any;
    for (const node of dlg(pack).nodes) node.audio = audioFor(node);
    dlg(pack).nodes[0].audio.timestamps[0].tokenIndex = 99;
    dlg(pack).nodes[1].audio.timestamps[0].endMs = 99999;
    expectIssue(pack, 'dialogues[0].nodes[0].audio.timestamps[0].tokenIndex', 'out of range');
    expectIssue(pack, 'dialogues[0].nodes[1].audio.timestamps[0].endMs', 'past the audio duration');
  });
});

describe('analyzeDialogueGraph', () => {
  it('computes reachability, endings, and path stats on the helper graph', () => {
    const dialogue = dlg(makeValidDialoguePack()) as Dialogue;
    const a = analyzeDialogueGraph(dialogue);
    expect(a.unreachable).toEqual([]);
    expect(a.deadTraps).toEqual([]);
    expect(a.unreferencedEndings).toEqual([]);
    expect(a.reachableEndings).toEqual(['e-good', 'e-bad']);
    expect(a.shortestPathNodes).toBe(3); // n1 → n2 → n3
    expect(a.longestPathNodes).toBe(3);
    expect(a.hasCycle).toBe(false);
    expect(a.longestPathCapped).toBe(false);
  });

  it('is tolerant of dangling references (they are just not edges)', () => {
    const pack = makeValidDialoguePack() as any;
    dlg(pack).nodes[0].next = 'dlg-ghost';
    const a = analyzeDialogueGraph(dlg(pack));
    expect(a.reachable).toEqual(new Set(['dlg-n1']));
    expect(a.unreachable).toEqual(['dlg-n2', 'dlg-n3', 'dlg-n4']);
  });
});
