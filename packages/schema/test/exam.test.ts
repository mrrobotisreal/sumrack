import { describe, expect, it } from 'vitest';
import {
  ExamSchema,
  countStemGaps,
  examStoryRefs,
  itemPoints,
  officialShapeIssues,
  resolveItemAudio,
  safeParsePack,
  type Exam,
} from '../src';
import { makeValidExamPack, makeValidPack } from './helpers';

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

const exam = (pack: any) => pack.exams[0];
/** Subtest by kind in the helper's mock (official order: writing, lexgram, reading, listening, speaking). */
const sub = (pack: any, kind: string) => exam(pack).subtests.find((s: any) => s.kind === kind);
const items = (pack: any, kind: string, part = 0) => sub(pack, kind).parts[part].items;

describe('exam pack — shape', () => {
  it('accepts a minimal valid exam pack', () => {
    expectValid(makeValidExamPack());
  });

  it('applies the schema defaults (minQuestions, minTokens, monologue bounds + timers)', () => {
    const pack = makeValidExamPack() as any;
    delete items(pack, 'writing')[0].minQuestions;
    delete items(pack, 'writing')[0].maxQuestions;
    const result = safeParsePack(pack);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const e = result.data.exams![0]!;
    const wr = e.subtests[0]!.parts[0]!.items[0] as any;
    expect(wr.minQuestions).toBe(0);
    const sp = e.subtests[4]!.parts;
    expect((sp[0]!.items[0] as any).minTokens).toBe(4);
    expect(sp[2]!.items[0]).toMatchObject({
      minSentences: 10,
      maxSentences: 12,
      prepSec: 480,
      answerSec: 120,
    });
  });

  it('an "exam" pack must contain at least one exam', () => {
    const pack = makeValidExamPack() as any;
    pack.exams = [];
    expectIssue(pack, 'exams', 'at least one exam');
    delete pack.exams;
    expectIssue(pack, 'exams', 'at least one exam');
  });

  it('existing pack types are untouched by the exams field (additive change)', () => {
    expectValid(makeValidPack());
    const pack = makeValidPack() as any;
    pack.stories.push(...(makeValidExamPack() as any).stories);
    pack.exams = (makeValidExamPack() as any).exams;
    expectValid(pack);
  });

  it('rejects duplicate exam ids', () => {
    const pack = makeValidExamPack() as any;
    pack.exams.push(structuredClone(exam(pack)));
    expectIssue(pack, 'exams[1].id', 'duplicate exam id "a1-mock-t"');
  });

  it('rejects unknown keys (strictObject), an unknown format and a bad mode', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'lexgram')[0].hint = 'x';
    expectIssue(pack, 'exams[0].subtests[1].parts[0].items[0]', 'Unrecognized key');
    const fmt = makeValidExamPack() as any;
    exam(fmt).format = 'tbu';
    expectIssue(fmt, 'exams[0].format', '');
    const mode = makeValidExamPack() as any;
    exam(mode).mode = 'quiz';
    expectIssue(mode, 'exams[0].mode', '');
  });

  it('choice options are 2–4; monologue questions 4–12; writing bullets 3–15', () => {
    const one = makeValidExamPack() as any;
    items(one, 'lexgram')[0].options = ['в'];
    items(one, 'lexgram')[0].answer = 0;
    expectIssue(one, 'items[0].options', '');
    const five = makeValidExamPack() as any;
    items(five, 'lexgram')[0].options = ['а', 'б', 'в', 'г', 'д'];
    expectIssue(five, 'items[0].options', '');
    const q = makeValidExamPack() as any;
    items(q, 'speaking', 2)[0].questions.splice(3);
    expectIssue(q, 'items[0].questions', '');
    const b = makeValidExamPack() as any;
    items(b, 'writing')[0].bullets.splice(2);
    expectIssue(b, 'items[0].bullets', '');
  });
});

describe('exam invariant 1 — ids + NFC', () => {
  it('rejects duplicate subtest ids', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'reading').id = 'lexgram';
    expectIssue(pack, 'exams[0].subtests[2].id', 'duplicate subtest id "lexgram"');
  });

  it('rejects duplicate part ids within a subtest (but allows them across subtests)', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'speaking').parts[1].id = 't1';
    expectIssue(pack, 'exams[0].subtests[4].parts[1].id', 'duplicate part id "t1"');
    // every objective subtest of the helper reuses "p1"/"p3"/"p4" freely
    expectValid(makeValidExamPack());
  });

  it('rejects duplicate item ids across subtests (unique per exam)', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'reading')[0].id = 'lg01';
    expectIssue(pack, 'subtests[2].parts[0].items[0].id', 'duplicate item id "lg01"');
  });

  it('rejects NFD text anywhere in the exam', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'lexgram')[0].options[0] = 'й'.normalize('NFD');
    expectIssue(pack, 'items[0].options[0]', 'NFC');
    const stem = makeValidExamPack() as any;
    items(stem, 'reading')[0].stem = 'Анна живёт в … ё'.normalize('NFD');
    expectIssue(stem, 'items[0].stem', 'NFC');
  });
});

describe('exam invariant 2 — item kinds per subtest kind', () => {
  it('rejects a speaking item in a reading subtest', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'reading').push(structuredClone(items(pack, 'speaking')[0]));
    items(pack, 'reading')[2].id = 'rd99';
    expectIssue(
      pack,
      'subtests[2].parts[0].items[2].kind',
      'reading subtest holds only choice / typed',
    );
  });

  it('rejects a choice item in a speaking subtest and in a writing subtest', () => {
    const pack = makeValidExamPack() as any;
    const choice = { ...structuredClone(items(pack, 'lexgram')[0]), id: 'x01' };
    items(pack, 'speaking').push(choice);
    expectIssue(pack, 'subtests[4].parts[0].items[1].kind', 'speaking subtest holds only');
  });

  it('a writing part holds exactly one writing item', () => {
    const pack = makeValidExamPack() as any;
    const second = { ...structuredClone(items(pack, 'writing')[0]), id: 'wr02' };
    items(pack, 'writing').push(second);
    expectIssue(pack, 'subtests[0].parts[0].items', 'exactly one writing item');
  });
});

describe('exam invariant 3 — choice items', () => {
  it('rejects an answer index out of range', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'lexgram')[0].answer = 2;
    expectIssue(pack, 'items[0].answer', 'answer 2 is out of range for 2 options');
  });

  it('rejects options that collide after normalization (case, ё/е, spaces)', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'reading')[0].options = ['Ёлка', 'елка', 'Сочи'];
    expectIssue(pack, 'items[0].options[1]', 'duplicates option 0');
  });

  it('allows one gap and rejects two; «…», "..." and "___" all count', () => {
    expect(countStemGaps('Нина играет … компьютере.')).toBe(1);
    expect(countStemGaps('Нина играет ... компьютере.')).toBe(1);
    expect(countStemGaps('Нина играет ___ компьютере.')).toBe(1);
    expect(countStemGaps('Нина играет на компьютере.')).toBe(0);
    expect(countStemGaps('… играет ___')).toBe(2);
    const pack = makeValidExamPack() as any;
    items(pack, 'lexgram')[0].stem = 'Нина … играет … компьютере.';
    expectIssue(pack, 'items[0].stem', 'at most one gap');
  });
});

describe('exam invariant 4 — points', () => {
  it('Σ item points must equal maxPoints', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'reading').maxPoints = 100;
    expectIssue(
      pack,
      'subtests[2].maxPoints',
      'add up to 8 but subtest "reading" declares maxPoints 100',
    );
  });

  it('per-item points override pointsPerItem; ±0.001 tolerance', () => {
    const pack = makeValidExamPack() as any;
    const lg = sub(pack, 'lexgram');
    delete lg.pointsPerItem;
    lg.parts[0].items[0].points = 0.3333;
    lg.parts[0].items[1].points = 0.6667;
    lg.maxPoints = 1;
    expectValid(pack);
    expect(itemPoints({ pointsPerItem: 4 }, { points: 5 } as any)).toBe(5);
    expect(itemPoints({ pointsPerItem: 4 }, {} as any)).toBe(4);
  });

  it('an objective subtest needs pointsPerItem or points on every item', () => {
    const pack = makeValidExamPack() as any;
    delete sub(pack, 'listening').pointsPerItem;
    items(pack, 'listening')[0].points = 5;
    expectIssue(
      pack,
      'subtests[3].pointsPerItem',
      'needs "pointsPerItem" or "points" on every item',
    );
  });

  it('rejects points on a rubric (writing/speaking) item', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'writing')[0].points = 10;
    expectIssue(pack, 'subtests[0].parts[0].items[0].points', 'scored by rubric');
  });
});

describe('exam invariant 5 — listening audio', () => {
  it('items after the first inherit the part’s first audio (resolveItemAudio)', () => {
    const pack = makeValidExamPack() as any;
    const part = sub(pack, 'listening').parts[0];
    expect(resolveItemAudio(part, 0)).toEqual({ storyId: 'ls-01' });
    expect(resolveItemAudio(part, 1)).toEqual({ storyId: 'ls-01' });
    part.items[1].audio = { storyId: 'rd-01' };
    expect(resolveItemAudio(part, 1)).toEqual({ storyId: 'rd-01' });
    expect(resolveItemAudio(part, 9)).toBeUndefined();
    const speaking = sub(pack, 'speaking').parts[0];
    expect(resolveItemAudio(speaking, 0)).toBeUndefined();
  });

  it('rejects a listening part whose first item has no audio', () => {
    const pack = makeValidExamPack() as any;
    delete items(pack, 'listening')[0].audio;
    expectIssue(
      pack,
      'subtests[3].parts[0].items[0].audio',
      'first item of a listening part must carry one',
    );
    expectIssue(pack, 'subtests[3].parts[0].items[1].audio', 'none to inherit');
  });

  it('a mock’s listening subtest must set audioPlays; a drill need not', () => {
    const pack = makeValidExamPack() as any;
    delete sub(pack, 'listening').audioPlays;
    expectIssue(pack, 'subtests[3].audioPlays', 'must set "audioPlays"');
    exam(pack).mode = 'drill';
    expectValid(pack);
  });
});

describe('exam invariant 7 — story refs resolve (pack level)', () => {
  it('rejects a dangling storyId', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'reading')[0].passage.storyId = 'rd-99';
    expectIssue(pack, 'subtests[2].parts[0].items[0].passage.storyId', 'unknown story "rd-99"');
  });

  it('rejects an unknown sentence id and a non-contiguous span', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'reading')[0].passage.sentenceIds = ['tfa1t01r01-s01', 'tfa1t01r01-s03'];
    expectIssue(pack, 'passage.sentenceIds[1]', 'contiguous run in story order');
    const back = makeValidExamPack() as any;
    items(back, 'reading')[0].passage.sentenceIds = ['tfa1t01r01-s02', 'tfa1t01r01-s01'];
    expectIssue(back, 'passage.sentenceIds[1]', 'contiguous run');
    const foreign = makeValidExamPack() as any;
    items(foreign, 'reading')[0].passage.sentenceIds = ['tfa1t01l01-s01'];
    expectIssue(foreign, 'passage.sentenceIds[0]', 'not in story "rd-01"');
  });

  it('rejects a trackId the story does not have', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'listening')[0].audio.trackId = 'ls01-cast';
    expectIssue(pack, 'items[0].audio.trackId', 'no audio track "ls01-cast"');
  });

  it('audio is all-or-nothing across audio/prompt refs once any story has a track', () => {
    const pack = makeValidExamPack() as any;
    pack.stories[0].audio.push({
      id: 'rd01-wintrow',
      voice: 'elevenlabs:x',
      style: 'lecturer',
      file: 'audio/rd-01.opus',
      durationMs: 1000,
      timestamps: [],
    });
    // rd-01 is only a passage ref; ls-01 is an audio + prompt ref with no track.
    expectIssue(
      pack,
      'subtests[3].parts[0].items[0].audio.storyId',
      'every audio/prompt story needs a track',
    );
    expectIssue(pack, 'subtests[4].parts[0].items[0].prompt.storyId', 'has none');
    pack.stories[1].audio.push({
      ...pack.stories[0].audio[0],
      id: 'ls01-cast',
      file: 'audio/ls-01.opus',
    });
    items(pack, 'listening')[0].audio.trackId = 'ls01-cast';
    expectValid(pack);
  });

  it('examStoryRefs lists every authored ref with its field and path', () => {
    const result = safeParsePack(makeValidExamPack());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const refs = examStoryRefs(result.data.exams![0]!);
    expect(refs.map((r) => `${r.itemId}:${r.field}:${r.ref.storyId}`)).toEqual([
      'rd01:passage:rd-01',
      'rd02:passage:rd-01',
      'ls01:audio:ls-01',
      'sp01:prompt:ls-01',
      'sp02:prompt:ls-01',
    ]);
    expect(refs[0]!.path).toEqual(['subtests', 2, 'parts', 0, 'items', 0, 'passage']);
  });

  it('exam item ids never join the pack-wide sentence-id set', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'lexgram')[0].id = 'tfa1t01r01-s01';
    expectValid(pack);
  });
});

describe('exam invariant 8 — speaking', () => {
  it('a speaking-situation needs its situation text', () => {
    const pack = makeValidExamPack() as any;
    delete sub(pack, 'speaking').parts[1].items[0].situation;
    expectIssue(pack, 'subtests[4].parts[1].items[0].situation', 'needs its "situation"');
  });

  it('rejects a monologue group of 3 (and of 1)', () => {
    const pack = makeValidExamPack() as any;
    const t3 = sub(pack, 'speaking').parts[2].items;
    t3.push({ ...structuredClone(t3[0]), id: 'sp05' });
    expectIssue(pack, 'subtests[4].parts[2].items[0].group', 'group "g1" has 3 members');
    const one = makeValidExamPack() as any;
    sub(one, 'speaking').parts[2].items[1].group = 'g2';
    expectIssue(one, 'items[0].group', 'group "g1" has 1 member —');
  });

  it('rejects minSentences > maxSentences', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'speaking').parts[2].items[0].minSentences = 13;
    expectIssue(pack, 'parts[2].items[0].minSentences', 'exceeds maxSentences 12');
  });

  it('reuses the M17 expectation verbatim, incl. slot-form hygiene', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'speaking').parts[0].items[0].expect.slots[0].options[0].forms = ['москве,'];
    expectIssue(pack, 'expect.slots[0].options[0].forms[0]', 'no punctuation');
    const noAccept = makeValidExamPack() as any;
    sub(noAccept, 'speaking').parts[0].items[0].expect.accept = [];
    expectIssue(noAccept, 'expect.accept', '');
  });

  it('monologue question cues follow the slot-form rule', () => {
    const pack = makeValidExamPack() as any;
    sub(pack, 'speaking').parts[2].items[0].questions[0].cues = ['зо*вут'];
    expectIssue(pack, 'questions[0].cues[0]', 'single TRAILING "*"');
  });
});

describe('exam invariant 9 — writing', () => {
  it('rejects minQuestions > maxQuestions', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'writing')[0].minQuestions = 6;
    expectIssue(pack, 'items[0].minQuestions', 'exceeds maxQuestions 5');
  });

  it('rejects a bullet cue with punctuation, and duplicate bullet ids', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'writing')[0].bullets[0].cues = ['зовут!'];
    expectIssue(
      pack,
      'items[0].bullets[0].cues[0]',
      'cue "зовут!" must be letters/digits/spaces/hyphens only',
    );
    const dup = makeValidExamPack() as any;
    items(dup, 'writing')[0].bullets[1].id = 'b1';
    expectIssue(dup, 'items[0].bullets[1].id', 'duplicate bullet id "b1"');
  });

  it('a bullet needs ≥ 1 cue; minSentences ≥ 5', () => {
    const pack = makeValidExamPack() as any;
    items(pack, 'writing')[0].bullets[0].cues = [];
    expectIssue(pack, 'items[0].bullets[0].cues', '');
    const short = makeValidExamPack() as any;
    items(short, 'writing')[0].minSentences = 4;
    expectIssue(short, 'items[0].minSentences', '');
  });
});

describe('ExamSchema is self-contained (T68 parses a stored exam without its pack)', () => {
  it('parses an exam whose refs point at stories it cannot see', () => {
    const raw = exam(makeValidExamPack() as any);
    raw.subtests[2].parts[0].items[0].passage.storyId = 'not-in-any-pack';
    expect(ExamSchema.safeParse(raw).success).toBe(true);
  });
});

// --- invariant 10 ------------------------------------------------------------

/** A synthetic conforming A1 mock: 70/70/40, 25/100/40, 20/100/30 ×2, writing 30, speaking 20 (300/300/600). */
function makeOfficialMock(): Exam {
  const base = exam(makeValidExamPack() as any);
  const choice = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    kind: 'choice',
    topic: 'conj',
    stem: 'Вопрос …',
    options: ['а', 'б', 'в'],
    answer: 0,
    ...extra,
  });
  const range = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
  const [writing, lexgram, reading, listening, speaking] = base.subtests;
  lexgram.maxPoints = 70;
  lexgram.parts = [
    {
      id: 'p1',
      instructions: lexgram.parts[0].instructions,
      items: range(70, 'lg').map((id) => choice(id)),
    },
  ];
  reading.maxPoints = 100;
  reading.parts = [
    {
      id: 'p1',
      instructions: reading.parts[0].instructions,
      items: range(25, 'rd').map((id) => choice(id)),
    },
  ];
  listening.maxPoints = 100;
  listening.parts = [
    {
      id: 'p1',
      instructions: listening.parts[0].instructions,
      items: range(20, 'ls').map((id, i) =>
        choice(id, i === 0 ? { audio: { storyId: 'ls-01' } } : {}),
      ),
    },
  ];
  const parsed = ExamSchema.safeParse({
    ...base,
    subtests: [writing, lexgram, reading, listening, speaking],
  });
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  return parsed.data!;
}

describe('officialShapeIssues (invariant 10, non-fatal)', () => {
  it('returns [] for a conforming A1 TORFL mock', () => {
    expect(officialShapeIssues(makeOfficialMock())).toEqual([]);
  });

  it('flags order, counts, points, timers, audioPlays, dictionary, navigation and part times', () => {
    const mock = makeOfficialMock();
    const [writing, lexgram, reading, listening, speaking] = mock.subtests as any[];
    lexgram.parts[0].items.pop();
    lexgram.durationMin = 50;
    reading.dictionary = false;
    listening.audioPlays = 1;
    listening.navigation = 'free';
    writing.durationMin = 60;
    speaking.parts[2].timeSec = 480;
    mock.subtests = [lexgram, writing, reading, listening, speaking];
    const lines = officialShapeIssues(mock);
    expect(lines.every((l) => l.startsWith('⚠ official-shape: '))).toBe(true);
    expect(lines).toEqual([
      '⚠ official-shape: subtests are [lexgram, writing, reading, listening, speaking] — the official order is [writing, lexgram, reading, listening, speaking]',
      '⚠ official-shape: lexgram "lexgram" has items 69 — official 70',
      '⚠ official-shape: lexgram "lexgram" durationMin 50 — official 40',
      '⚠ official-shape: writing "writing" durationMin 60 — official 30',
      '⚠ official-shape: reading "reading" dictionary false — official true',
      '⚠ official-shape: listening "listening" navigation free — official linear',
      '⚠ official-shape: listening "listening" audioPlays 1 — official 2',
      '⚠ official-shape: speaking "speaking" part times are 300/300/480 s — official 300/300/600 s',
    ]);
  });

  it('does not judge drills, other levels or other formats', () => {
    const drill = makeOfficialMock();
    drill.mode = 'drill';
    drill.subtests = drill.subtests.slice(1, 2);
    expect(officialShapeIssues(drill)).toEqual([]);
    const a2 = makeOfficialMock();
    a2.level = 'A2';
    a2.subtests = [];
    expect(officialShapeIssues(a2)).toEqual([]);
  });

  it('flags the small helper mock (too few items) without throwing', () => {
    const result = safeParsePack(makeValidExamPack());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const lines = officialShapeIssues(result.data.exams![0]!);
    expect(lines).toContain('⚠ official-shape: lexgram "lexgram" has items 2 — official 70');
    expect(lines).toContain('⚠ official-shape: reading "reading" maxPoints 8 — official 100');
  });
});
