import { describe, expect, it } from 'vitest';
import {
  MOUTH_TRACK_STEP_MS,
  analyzeDialogueGraph,
  safeParsePack,
  scenarioGraphInput,
  scenarioLines,
  slotBranchKeys,
  slotFormIssue,
  type Scenario,
} from '../src';
import { makeLine, makeValidDialoguePack, makeValidPack, makeValidScenarioPack } from './helpers';

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

function expectValid(pack: unknown) {
  const result = safeParsePack(pack);
  expect(result.success, result.success ? '' : result.message).toBe(true);
}

const scn = (pack: any) => pack.scenarios[0];

describe('scenario pack — shape', () => {
  it('accepts a minimal valid scenario pack', () => {
    expectValid(makeValidScenarioPack());
  });

  it('applies the schema defaults (language, layout, mouthStyle, acceptsNumber, minTokens)', () => {
    const pack = makeValidScenarioPack() as any;
    delete scn(pack).language;
    delete scn(pack).scene.layout;
    delete scn(pack).cast[0].portrait.mouthStyle;
    delete scn(pack).turns[2].expect.slots[0].acceptsNumber;
    delete scn(pack).turns[1].expect.slots[0].minTokens;
    const result = safeParsePack(pack);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const s = result.data.scenarios![0]!;
    expect(s.language).toBe('ru');
    expect(s.scene.layout).toBe('center');
    expect(s.cast[0]!.portrait!.mouthStyle).toBe('default');
    expect((s.turns[2]!.expect!.slots[0] as any).acceptsNumber).toBe(false);
    expect((s.turns[1]!.expect!.slots[0] as any).minTokens).toBe(1);
  });

  it('a "scenario" pack must contain at least one scenario', () => {
    const pack = makeValidScenarioPack() as any;
    pack.scenarios = [];
    expectIssue(pack, 'scenarios', 'at least one scenario');
    delete pack.scenarios;
    expectIssue(pack, 'scenarios', 'at least one scenario');
  });

  it('existing pack types are untouched by the scenarios field (additive change)', () => {
    expect(safeParsePack(makeValidPack()).success).toBe(true);
    expect(safeParsePack(makeValidDialoguePack()).success).toBe(true);
    const pack = makeValidPack() as any;
    pack.scenarios = (makeValidScenarioPack() as any).scenarios;
    expectValid(pack);
  });

  it('rejects duplicate scenario ids', () => {
    const pack = makeValidScenarioPack() as any;
    const clone = structuredClone(scn(pack));
    for (const ref of scenarioLines(clone)) ref.line.sentence.id = `b-${ref.line.sentence.id}`;
    pack.scenarios.push(clone);
    expectIssue(pack, 'scenarios[1].id', 'duplicate scenario id "scn"');
  });

  it('rejects unknown keys everywhere (strictObject)', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[0].mood = 'x';
    expectIssue(pack, 'scenarios[0].turns[0]', 'Unrecognized key');
  });

  it('rejects more than 40 turns and more than 3 say lines', () => {
    const many = makeValidScenarioPack() as any;
    for (let i = 0; i < 40; i++) {
      many.scenarios[0].turns.push({
        id: `scn-x${i}`,
        speakerId: 'host',
        say: [makeLine(`scn-x${i}`, 'Да.')],
        endingId: 'e-ok',
      });
    }
    expectIssue(many, 'scenarios[0].turns', '40');

    const long = makeValidScenarioPack() as any;
    scn(long).turns[0].say = [1, 2, 3, 4].map((i) => makeLine(`scn-t1-${i}`, 'Да.'));
    expectIssue(long, 'scenarios[0].turns[0].say', '3');
  });
});

describe('scenario cast', () => {
  it('rejects duplicate cast ids', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).cast[1].id = 'host';
    expectIssue(pack, 'scenarios[0].cast[1].id', 'duplicate cast id "host"');
  });

  it('requires exactly one host', () => {
    const none = makeValidScenarioPack() as any;
    scn(none).cast[0].role = 'npc';
    expectIssue(none, 'scenarios[0].cast', 'exactly one character with role "host" (found 0)');

    const two = makeValidScenarioPack() as any;
    scn(two).cast.push({ ...scn(two).cast[0], id: 'host2' });
    expectIssue(two, 'scenarios[0].cast', 'exactly one character with role "host" (found 2)');
  });

  it('requires the reserved player with role player, and only it', () => {
    const missing = makeValidScenarioPack() as any;
    scn(missing).cast[1].id = 'you';
    expectIssue(missing, 'scenarios[0].cast', 'must include the reserved "player" character');
    expectIssue(missing, 'scenarios[0].cast[1].role', 'only the reserved "player" character');

    const wrongRole = makeValidScenarioPack() as any;
    scn(wrongRole).cast[1].role = 'npc';
    expectIssue(wrongRole, 'scenarios[0].cast[1].role', 'must have role "player"');
  });

  it('rejects a speakerId that does not resolve or is the player', () => {
    const ghost = makeValidScenarioPack() as any;
    scn(ghost).turns[0].speakerId = 'ghost';
    expectIssue(ghost, 'scenarios[0].turns[0].speakerId', 'does not resolve to a cast member');

    const player = makeValidScenarioPack() as any;
    scn(player).turns[0].speakerId = 'player';
    expectIssue(player, 'scenarios[0].turns[0].speakerId', 'the player never has scripted lines');

    const nudge = makeValidScenarioPack() as any;
    scn(nudge).nudges[0].speakerId = 'player';
    expectIssue(nudge, 'scenarios[0].nudges[0].speakerId', 'the player never has scripted lines');
  });

  it('a non-placeholder portrait needs body + mouthAnchor', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).cast[0].portrait = { mouthStyle: 'beard' };
    expectIssue(pack, 'scenarios[0].cast[0].portrait.body', 'unless "placeholder" is set');
    expectIssue(pack, 'scenarios[0].cast[0].portrait.mouthAnchor', 'unless "placeholder" is set');

    const png = makeValidScenarioPack() as any;
    scn(png).cast[0].portrait = {
      body: 'scene/host/body.png',
      eyelids: 'scene/host/eyelids.png',
      mouthAnchor: { x: 0.4, y: 0.5, w: 0.2, h: 0.1 },
    };
    expectValid(png);
  });

  it('rejects an absolute backdrop path and a malformed accent', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).scene.backdrop = '/etc/passwd';
    scn(pack).scene.accent = 'red';
    expectIssue(pack, 'scenarios[0].scene.backdrop', 'relative path');
    expectIssue(pack, 'scenarios[0].scene.accent', 'hex color');
  });
});

describe('scenario turn — expect ⇔ retry, next | endingId', () => {
  it('rejects expect without retry, naming the turn', () => {
    const pack = makeValidScenarioPack() as any;
    delete scn(pack).turns[1].retry;
    expectIssue(pack, 'scenarios[0].turns[1].retry', 'turn "scn-t2" has "expect" but no "retry"');
  });

  it('rejects retry without expect', () => {
    const pack = makeValidScenarioPack() as any;
    delete scn(pack).turns[1].expect;
    expectIssue(pack, 'scenarios[0].turns[1].expect', 'has "retry" but no "expect"');
  });

  it('rejects a turn with neither next nor endingId, and one with both', () => {
    const none = makeValidScenarioPack() as any;
    delete scn(none).turns[0].next;
    expectIssue(none, 'scenarios[0].turns[0]', 'exactly one of "next" or "endingId" (has none)');

    const both = makeValidScenarioPack() as any;
    scn(both).turns[0].endingId = 'e-ok';
    expectIssue(both, 'scenarios[0].turns[0]', '(has both)');
  });
});

describe('scenario branching — next.on', () => {
  it('rejects more than 4 branch keys', () => {
    const pack = makeValidScenarioPack() as any;
    const slot = scn(pack).turns[2].expect.slots[0];
    for (const k of ['k1', 'k2', 'k3']) {
      slot.options.push({ key: k, lemma: k, forms: [k] });
      scn(pack).turns[2].next.on[k] = 'scn-t4d';
    }
    expectIssue(pack, 'scenarios[0].turns[2].next.on', 'branches on 5 keys — the maximum is 4');
  });

  it('requires expect.branchOn when next has on', () => {
    const pack = makeValidScenarioPack() as any;
    delete scn(pack).turns[2].expect.branchOn;
    expectIssue(pack, 'scenarios[0].turns[2].next.on', 'has no expect.branchOn');
  });

  it('rejects an on key that is not an option key of the branchOn slot', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[2].next.on.great = 'scn-t4g';
    expectIssue(
      pack,
      'scenarios[0].turns[2].next.on.great',
      'key "great" is not a branch key of slot "mood" (allowed: good, bad)',
    );
  });

  it('acceptsNumber exposes the extra "number" key; a number slot has only it', () => {
    const forms = makeValidScenarioPack() as any;
    scn(forms).turns[2].next.on.number = 'scn-t4d';
    expectIssue(forms, 'scenarios[0].turns[2].next.on.number', 'not a branch key');
    scn(forms).turns[2].expect.slots[0].acceptsNumber = true;
    expectValid(forms);

    const num = makeValidScenarioPack() as any;
    scn(num).turns[2].expect.slots[0] = { kind: 'number', id: 'mood', required: true };
    expectIssue(num, 'scenarios[0].turns[2].next.on.good', 'allowed: number');
    scn(num).turns[2].next.on = { number: 'scn-t4g' };
    scn(num).turns[3].endingId = 'e-ok';
    // t4b is now unreachable — rewire it away to isolate the branch-key rule
    scn(num).turns.splice(4, 1);
    expectValid(num);
  });

  it('rejects branchOn pointing at a free slot or an unknown slot', () => {
    const free = makeValidScenarioPack() as any;
    scn(free).turns[1].next = { on: { name: 'scn-t3' }, default: 'scn-t3' };
    scn(free).turns[1].expect.branchOn = 'name';
    expectIssue(free, 'scenarios[0].turns[1].expect.branchOn', 'is a free slot');

    const ghost = makeValidScenarioPack() as any;
    scn(ghost).turns[2].expect.branchOn = 'ghost';
    expectIssue(ghost, 'scenarios[0].turns[2].expect.branchOn', 'is not a slot of turn "scn-t3"');
  });

  it('rejects an empty on record', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[2].next.on = {};
    expectIssue(pack, 'scenarios[0].turns[2].next.on', 'has no branch keys');
  });

  it('rejects a reserved "number" option key on an acceptsNumber slot', () => {
    const pack = makeValidScenarioPack() as any;
    const slot = scn(pack).turns[2].expect.slots[0];
    slot.acceptsNumber = true;
    slot.options[0].key = 'number';
    scn(pack).turns[2].next.on = { number: 'scn-t4g', bad: 'scn-t4b' };
    expectIssue(pack, 'scenarios[0].turns[2].expect.slots[0].options[0].key', 'reserved');
  });
});

describe('scenario graph — resolvability (dangling references)', () => {
  it('rejects a dangling linear next', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[0].next = 'scn-ghost';
    expectIssue(pack, 'scenarios[0].turns[0].next', 'next "scn-ghost" does not resolve to a turn');
  });

  it('rejects a dangling on target and a dangling default', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[2].next.on.good = 'scn-ghost';
    scn(pack).turns[2].next.default = 'scn-void';
    expectIssue(pack, 'scenarios[0].turns[2].next.on.good', 'target "scn-ghost" does not resolve');
    expectIssue(pack, 'scenarios[0].turns[2].next.default', '"scn-void" does not resolve');
  });

  it('rejects a dangling endingId and startTurnId', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[3].endingId = 'e-ghost';
    scn(pack).startTurnId = 'scn-ghost';
    expectIssue(pack, 'scenarios[0].turns[3].endingId', 'does not resolve to an ending');
    expectIssue(pack, 'scenarios[0].startTurnId', 'does not resolve to a turn');
  });
});

describe('scenario graph — reachability via the adapter', () => {
  it('rejects an unreachable turn', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns.push({
      id: 'scn-orphan',
      speakerId: 'host',
      say: [makeLine('scn-orphan', 'Стоп.')],
      endingId: 'e-ok',
    });
    expectIssue(
      pack,
      'scenarios[0].turns[6]',
      'turn "scn-orphan" is unreachable from startTurnId "scn-t1"',
    );
  });

  it('rejects a dead trap (a branch target that loops without an exit)', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[4] = {
      id: 'scn-t4b',
      speakerId: 'host',
      say: [makeLine('scn-t4b', 'Жаль.')],
      next: 'scn-t4b',
    };
    expectIssue(pack, 'scenarios[0].turns[4]', 'dead trap');
  });

  it('rejects an ending no turn references', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).endings.push({
      id: 'e-lost',
      title: { ru: 'Нигде', en: 'Nowhere' },
      recap: { ru: 'Никак.', en: 'No way.' },
      tone: 'strange',
    });
    expectIssue(pack, 'scenarios[0].endings[1]', 'ending "e-lost" is never referenced by any turn');
  });

  it('scenarioGraphInput turns on-values + default into pseudo-choices, linear next into next', () => {
    const scenario = scn(makeValidScenarioPack()) as Scenario;
    const input = scenarioGraphInput(scenario);
    expect(input.startNodeId).toBe('scn-t1');
    expect(input.nodes[0]).toEqual({ id: 'scn-t1', next: 'scn-t2' });
    expect(input.nodes[2]).toEqual({
      id: 'scn-t3',
      choices: [{ next: 'scn-t4g' }, { next: 'scn-t4b' }, { next: 'scn-t4d' }],
    });
    expect(input.nodes[3]).toEqual({ id: 'scn-t4g', endingId: 'e-ok' });

    const a = analyzeDialogueGraph(input);
    expect(a.unreachable).toEqual([]);
    expect(a.deadTraps).toEqual([]);
    expect(a.unreferencedEndings).toEqual([]);
    expect(a.reachableEndings).toEqual(['e-ok']);
    expect(a.shortestPathNodes).toBe(4);
    expect(a.longestPathNodes).toBe(4);
    expect(a.hasCycle).toBe(false);
  });
});

describe('scenario audio', () => {
  const audioFor = (line: any, durationMs = 2000) => ({
    file: `audio/scn/${line.sentence.id}.opus`,
    durationMs,
    timestamps: [{ sentenceId: line.sentence.id, tokenIndex: 0, startMs: 0, endMs: 500 }],
    mouth: '0'.repeat(Math.ceil(durationMs / MOUTH_TRACK_STEP_MS)),
  });
  const voiceAll = (pack: any) => {
    for (const ref of scenarioLines(scn(pack))) ref.line.audio = audioFor(ref.line);
  };

  it('accepts a fully voiced scenario (turn, retry, glossary and nudge lines)', () => {
    const pack = makeValidScenarioPack() as any;
    voiceAll(pack);
    expectValid(pack);
    expect(scenarioLines(scn(pack)).length).toBe(6 + 4 + 2 + 3);
  });

  it('rejects a half-voiced scenario, naming the first unvoiced line of every kind', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[0].say[0].audio = audioFor(scn(pack).turns[0].say[0]);
    expectIssue(pack, 'scenarios[0].turns[1].say[0].audio', 'say line "scn-t2" has none');
    expectIssue(pack, 'scenarios[0].turns[1].retry.confused.audio', 'confused line "scn-t2-conf"');
    expectIssue(pack, 'scenarios[0].glossary[0].explain.audio', 'explain line "gl-privet-ex"');
    expectIssue(pack, 'scenarios[0].nudges[0].line.audio', 'nudge line "nudge-silence"');
  });

  it('accepts coach audio on an expectation (free text: duration + mouth, no stamps)', () => {
    const pack = makeValidScenarioPack() as any;
    voiceAll(pack);
    scn(pack).turns[1].expect.coachAudio = {
      file: 'audio/scn/scn-t2-coach.opus',
      durationMs: 1200,
      mouth: '0'.repeat(30),
    };
    expectValid(pack);
  });

  it('rejects coach audio that carries word stamps or a mismatched mouth track', () => {
    const pack = makeValidScenarioPack() as any;
    voiceAll(pack);
    scn(pack).turns[1].expect.coachAudio = {
      file: 'audio/scn/scn-t2-coach.opus',
      durationMs: 1200,
      timestamps: [{ sentenceId: 'scn-t2', tokenIndex: 0, startMs: 0, endMs: 500 }],
      mouth: '0'.repeat(10),
    };
    expectIssue(pack, 'scenarios[0].turns[1].expect.coachAudio.timestamps', 'no word stamps');
    expectIssue(pack, 'scenarios[0].turns[1].expect.coachAudio.mouth', '10 steps');
  });

  it('rejects stamps pointing at a foreign sentence, out of range, or past the duration', () => {
    const pack = makeValidScenarioPack() as any;
    voiceAll(pack);
    scn(pack).turns[0].say[0].audio.timestamps[0].sentenceId = 'scn-t2';
    scn(pack).turns[1].say[0].audio.timestamps[0].tokenIndex = 99;
    scn(pack).turns[2].say[0].audio.timestamps[0].endMs = 99999;
    expectIssue(
      pack,
      'scenarios[0].turns[0].say[0].audio.timestamps[0].sentenceId',
      'the line speaks sentence "scn-t1"',
    );
    expectIssue(
      pack,
      'scenarios[0].turns[1].say[0].audio.timestamps[0].tokenIndex',
      'out of range',
    );
    expectIssue(
      pack,
      'scenarios[0].turns[2].say[0].audio.timestamps[0].endMs',
      'past the audio duration',
    );
  });

  it('mouth track length must be ceil(durationMs / 40) ± 1', () => {
    const pack = makeValidScenarioPack() as any;
    voiceAll(pack);
    const line = scn(pack).turns[0].say[0];
    line.audio.durationMs = 1010; // → 26 steps
    line.audio.mouth = '3'.repeat(27); // +1 ok
    expectValid(pack);
    line.audio.mouth = '3'.repeat(25); // −1 ok
    expectValid(pack);
    line.audio.mouth = '3'.repeat(24);
    expectIssue(
      pack,
      'scenarios[0].turns[0].say[0].audio.mouth',
      'mouth track has 24 steps but the audio lasts 1010ms = 26 steps of 40ms',
    );
    line.audio.mouth = '3'.repeat(25) + '5';
    expectIssue(pack, 'scenarios[0].turns[0].say[0].audio.mouth', 'viseme digits 0–4');
  });
});

describe('scenario glossary', () => {
  const secondEntry = () => ({
    id: 'gl-two',
    ru: 'два',
    en: 'two',
    forms: ['два'],
    translit: ['ту'],
    explain: makeLine('gl-two-ex', 'Два — это two.'),
    howToSay: makeLine('gl-two-how', 'Two — по-русски два.'),
  });

  it('rejects duplicate ids and duplicate headwords (case-insensitive)', () => {
    const ids = makeValidScenarioPack() as any;
    scn(ids).glossary.push({ ...secondEntry(), id: 'gl-privet' });
    expectIssue(ids, 'scenarios[0].glossary[1].id', 'duplicate glossary id "gl-privet"');

    const ru = makeValidScenarioPack() as any;
    scn(ru).glossary.push({ ...secondEntry(), ru: 'Привет' });
    expectIssue(ru, 'scenarios[0].glossary[1].ru', 'duplicate glossary headword "Привет"');
  });

  it('requires NFC forms and translit', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).glossary[0].forms.push('ещё'.normalize('NFD'));
    scn(pack).glossary[0].translit.push('ёлка'.normalize('NFD'));
    expectIssue(pack, 'scenarios[0].glossary[0].forms[1]', 'NFC');
    expectIssue(pack, 'scenarios[0].glossary[0].translit[1]', 'NFC');
  });

  it('glossary clip sentence ids join the pack-wide uniqueness set', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).glossary[0].howToSay.sentence.id = 'scn-t1';
    expectIssue(
      pack,
      'scenarios[0].glossary[0].howToSay.sentence.id',
      'duplicate sentence id "scn-t1"',
    );
  });

  it('rejects more than 120 entries', () => {
    const pack = makeValidScenarioPack() as any;
    for (let i = 0; i < 120; i++) {
      scn(pack).glossary.push({
        ...secondEntry(),
        id: `gl-${i}`,
        ru: `слово${i}`,
        explain: makeLine(`gl-${i}-ex`, 'Да.'),
        howToSay: makeLine(`gl-${i}-how`, 'Да.'),
      });
    }
    expectIssue(pack, 'scenarios[0].glossary', '120');
  });
});

describe('scenario slots — forms hygiene', () => {
  const opt = (pack: any) => scn(pack).turns[2].expect.slots[0].options[0];

  it('rejects punctuation, non-trailing globs, double globs and NFD in forms', () => {
    const pack = makeValidScenarioPack() as any;
    opt(pack).forms = ['хорошо.', 'хор*шо', 'хо**', 'ещё'.normalize('NFD'), 'так себе', 'кое-как*'];
    expectIssue(
      pack,
      'scenarios[0].turns[2].expect.slots[0].options[0].forms[0]',
      'no punctuation',
    );
    expectIssue(pack, 'scenarios[0].turns[2].expect.slots[0].options[0].forms[1]', 'TRAILING');
    expectIssue(pack, 'scenarios[0].turns[2].expect.slots[0].options[0].forms[2]', 'TRAILING');
    expectIssue(pack, 'scenarios[0].turns[2].expect.slots[0].options[0].forms[3]', 'NFC');
    // multi-word forms and in-word hyphens are fine
    expect(slotFormIssue('так себе')).toBeNull();
    expect(slotFormIssue('кое-как*')).toBeNull();
    expect(slotFormIssue('95')).toBeNull();
  });

  it('rejects duplicate option keys and duplicate slot ids', () => {
    const keys = makeValidScenarioPack() as any;
    scn(keys).turns[2].expect.slots[0].options[1].key = 'good';
    expectIssue(
      keys,
      'scenarios[0].turns[2].expect.slots[0].options[1].key',
      'duplicate option key "good"',
    );

    const slots = makeValidScenarioPack() as any;
    scn(slots).turns[2].expect.slots.push({ kind: 'number', id: 'mood', required: false });
    expectIssue(slots, 'scenarios[0].turns[2].expect.slots[1].id', 'duplicate slot id "mood"');
  });

  it('rejects more than 6 slots and more than 4 reject groups', () => {
    const pack = makeValidScenarioPack() as any;
    for (let i = 0; i < 6; i++) {
      scn(pack).turns[2].expect.slots.push({ kind: 'number', id: `n${i}`, required: false });
    }
    expectIssue(pack, 'scenarios[0].turns[2].expect.slots', '6');
    scn(pack).turns[2].expect.slots.length = 1;
    scn(pack).turns[2].expect.reject = [1, 2, 3, 4, 5].map(() => ({ forms: ['спасибо'] }));
    expectIssue(pack, 'scenarios[0].turns[2].expect.reject', '4');
  });

  it('slotBranchKeys: forms → option keys (+ number), number → number, free → none', () => {
    expect(
      slotBranchKeys({
        kind: 'forms',
        id: 's',
        required: true,
        acceptsNumber: true,
        options: [{ key: 'a', lemma: 'а', forms: ['а'] }],
      }),
    ).toEqual(['a', 'number']);
    expect(slotBranchKeys({ kind: 'number', id: 's', required: true })).toEqual(['number']);
    expect(slotBranchKeys({ kind: 'free', id: 's', required: true, minTokens: 1 })).toEqual([]);
  });
});

describe('scenario nudges', () => {
  it('requires exactly one of each kind', () => {
    const dup = makeValidScenarioPack() as any;
    scn(dup).nudges[1].kind = 'silence';
    expectIssue(dup, 'scenarios[0].nudges[1].kind', 'duplicate nudge kind "silence"');
    expectIssue(dup, 'scenarios[0].nudges', 'missing nudge of kind "which-word"');

    const two = makeValidScenarioPack() as any;
    scn(two).nudges.pop();
    expectIssue(two, 'scenarios[0].nudges', '3');
  });
});

describe('scenario sentences — pack-wide sentence ids', () => {
  it('rejects a scenario line id colliding with a story or dialogue sentence id', () => {
    const pack = makeValidScenarioPack() as any;
    pack.stories = (makeValidPack() as any).stories; // "test-s01"
    scn(pack).turns[0].say[0].sentence.id = 'test-s01';
    expectIssue(
      pack,
      'scenarios[0].turns[0].say[0].sentence.id',
      'duplicate sentence id "test-s01"',
    );

    const mixed = makeValidScenarioPack() as any;
    mixed.dialogues = (makeValidDialoguePack() as any).dialogues; // "dlg-n1"
    scn(mixed).nudges[0].line.sentence.id = 'dlg-n1';
    expectIssue(mixed, 'scenarios[0].nudges[0].line.sentence.id', 'duplicate sentence id "dlg-n1"');
  });

  it('retry and react lines are sentences too', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[1].retry.hint.sentence.id = 'scn-t2-conf';
    expectIssue(pack, 'scenarios[0].turns[1].retry.hint.sentence.id', 'duplicate sentence id');

    const react = makeValidScenarioPack() as any;
    scn(react).turns[1].expect.reject = [
      { forms: ['спасибо'], react: makeLine('scn-t2', 'Нет, имя.') },
    ];
    expectIssue(
      react,
      'scenarios[0].turns[1].expect.reject[0].react.sentence.id',
      'duplicate sentence id',
    );
  });

  it('scenario sentences enforce the reconstruction invariant and NFC', () => {
    const pack = makeValidScenarioPack() as any;
    scn(pack).turns[0].say[0].sentence.tokens[0].text = 'Пока';
    expectIssue(pack, 'scenarios[0].turns[0].say[0].sentence.tokens', 'do not reconstruct');
  });
});
