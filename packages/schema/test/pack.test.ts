import { describe, expect, it } from 'vitest';
import {
  ExerciseSpecSchema,
  PackSchema,
  reconstructSentenceRu,
  safeParsePack,
  type Token,
} from '../src';
import { makeValidPack } from './helpers';

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

describe('PackSchema', () => {
  it('accepts a minimal valid stories pack', () => {
    expect(PackSchema.safeParse(makeValidPack()).success).toBe(true);
  });

  it('rejects punctuation tokens carrying linguistic annotations', () => {
    const pack = makeValidPack() as any;
    pack.stories[0].sentences[0].tokens[2].lemma = 'точка';
    expectIssue(pack, 'tokens[2].lemma', 'must not carry');
  });

  it('rejects tokens that do not reconstruct the sentence', () => {
    const pack = makeValidPack() as any;
    pack.stories[0].sentences[0].tokens[1].text = 'тут';
    expectIssue(pack, 'sentences[0].tokens', 'do not reconstruct');
  });

  it('supports spaceBefore overrides for « » quoting', () => {
    const pack = makeValidPack() as any;
    pack.stories[0].sentences[0] = {
      id: 'test-s01',
      ru: 'Он говорит: «Я дома».',
      en: 'He says: "I am home."',
      tokens: [
        { text: 'Он', lemma: 'он', translation: 'he', pos: 'pron', level: 'A1' },
        { text: 'говорит', lemma: 'говорить', translation: 'says', pos: 'verb', level: 'A1' },
        { text: ':', isPunct: true },
        { text: '«', isPunct: true, spaceBefore: true },
        { text: 'Я', lemma: 'я', translation: 'I', pos: 'pron', level: 'A1', spaceBefore: false },
        { text: 'дома', lemma: 'дома', translation: 'at home', pos: 'adv', level: 'A1' },
        { text: '»', isPunct: true },
        { text: '.', isPunct: true },
      ],
    };
    const result = PackSchema.safeParse(pack);
    expect(result.success).toBe(true);
  });

  it('rejects non-NFC Russian text', () => {
    const pack = makeValidPack() as any;
    // ё composed as е + U+0308 (NFD) instead of the single NFC codepoint
    pack.stories[0].sentences[0].ru = 'Всё хорошо.'.normalize('NFD');
    pack.stories[0].sentences[0].tokens = [{ text: 'x', isPunct: true }];
    expectIssue(pack, 'ru', 'NFC');
  });

  it('rejects duplicate sentence ids across stories', () => {
    const pack = makeValidPack() as any;
    const clone = structuredClone(pack.stories[0]);
    clone.id = 'test-story-2';
    pack.stories.push(clone); // same sentence id "test-s01"
    expectIssue(pack, 'stories[1].sentences[0].id', 'duplicate sentence id');
  });

  it('rejects word stamps pointing at unknown sentences or bad token indexes', () => {
    const pack = makeValidPack() as any;
    pack.stories[0].audio = [
      {
        id: 'track-1',
        voice: 'elevenlabs:Anton',
        style: 'neutral',
        file: 'audio/track-1.opus',
        durationMs: 5000,
        timestamps: [
          { sentenceId: 'no-such-sentence', tokenIndex: 0, startMs: 0, endMs: 400 },
          { sentenceId: 'test-s01', tokenIndex: 99, startMs: 500, endMs: 900 },
          { sentenceId: 'test-s01', tokenIndex: 0, startMs: 1000, endMs: 9000 },
        ],
      },
    ];
    expectIssue(pack, 'timestamps[0].sentenceId', 'unknown sentence');
    expectIssue(pack, 'timestamps[1].tokenIndex', 'out of range');
    expectIssue(pack, 'timestamps[2].endMs', 'past the track duration');
  });

  it('enforces type-specific required sections', () => {
    const checkpoint = makeValidPack() as any;
    checkpoint.type = 'checkpoint';
    expectIssue(checkpoint, 'exercises', 'checkpoint');

    const courseUnit = makeValidPack() as any;
    courseUnit.type = 'course-unit';
    expectIssue(courseUnit, 'lesson', 'course-unit');

    const prompts = makeValidPack() as any;
    prompts.type = 'prompts';
    expectIssue(prompts, 'prompts', 'journal prompt');

    const stories = makeValidPack() as any;
    stories.stories = [];
    expectIssue(stories, 'stories', 'at least one story');
  });

  it('rejects unknown extra fields (typo protection for hand-authored packs)', () => {
    const pack = makeValidPack() as any;
    pack.stories[0].sentences[0].tokens[0].translaton = 'oops';
    expectIssue(pack, 'tokens[0]', 'translaton');
  });

  // T30: optional theme/track (V2 §5.2, §6.1). Absent track = main at the
  // APP layer — the schema records only what was authored.
  describe('theme & track (T30)', () => {
    it('accepts theme with a known scene and accent, and a track', () => {
      const pack = makeValidPack() as any;
      pack.theme = { scene: 'hallway', accent: '#C08A4A' };
      pack.track = 'family';
      const result = PackSchema.safeParse(pack);
      expect(result.success).toBe(true);
      expect(result.success && result.data.theme?.scene).toBe('hallway');
      expect(result.success && result.data.track).toBe('family');
    });

    it('passes an UNKNOWN scene through untouched (forward compatibility)', () => {
      const pack = makeValidPack() as any;
      pack.theme = { scene: 'attic-observatory' };
      const result = PackSchema.safeParse(pack);
      expect(result.success).toBe(true);
      expect(result.success && result.data.theme?.scene).toBe('attic-observatory');
    });

    it('leaves theme and track absent (not defaulted) when unauthored', () => {
      const result = PackSchema.safeParse(makeValidPack());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.theme).toBeUndefined();
        expect(result.data.track).toBeUndefined();
      }
    });

    it('rejects a malformed accent color and a non-kebab track', () => {
      const badAccent = makeValidPack() as any;
      badAccent.theme = { scene: 'cellar', accent: 'reddish' };
      expectIssue(badAccent, 'accent', 'hex color');

      const badTrack = makeValidPack() as any;
      badTrack.track = 'Семья';
      expectIssue(badTrack, 'track', 'kebab-case');
    });

    it('rejects unknown keys inside theme (strict object)', () => {
      const pack = makeValidPack() as any;
      pack.theme = { scene: 'kitchen', mood: 'ominous' };
      expectIssue(pack, 'theme', 'mood');
    });
  });
});

describe('reconstructSentenceRu', () => {
  it('joins words with spaces and attaches punctuation', () => {
    const tokens = [{ text: 'Я' }, { text: 'дома' }, { text: '.', isPunct: true }] as Token[];
    expect(reconstructSentenceRu(tokens)).toBe('Я дома.');
  });
});

describe('ExerciseSpecSchema', () => {
  it('accepts each kind', () => {
    const specs = [
      {
        id: 'ex-1',
        kind: 'multiple-choice',
        direction: 'ru-en',
        prompt: 'дом',
        choices: ['house', 'wall'],
        correctIndex: 0,
      },
      { id: 'ex-2', kind: 'cloze', sentenceRu: 'Я ___ дома.', answer: 'сижу' },
      { id: 'ex-3', kind: 'sentence-builder', en: 'I am home.', tokens: ['Я', 'дома'] },
      { id: 'ex-4', kind: 'listening', text: 'Я дома.' },
      { id: 'ex-5', kind: 'pronunciation', text: 'Я дома.' },
    ];
    for (const spec of specs) {
      expect(ExerciseSpecSchema.safeParse(spec).success, `kind ${spec.kind}`).toBe(true);
    }
  });

  it('rejects out-of-range correctIndex and blankless cloze', () => {
    const mc = ExerciseSpecSchema.safeParse({
      id: 'ex-1',
      kind: 'multiple-choice',
      direction: 'ru-en',
      prompt: 'дом',
      choices: ['house', 'wall'],
      correctIndex: 5,
    });
    expect(mc.success).toBe(false);
    const cloze = ExerciseSpecSchema.safeParse({
      id: 'ex-2',
      kind: 'cloze',
      sentenceRu: 'Я дома.',
      answer: 'дома',
    });
    expect(cloze.success).toBe(false);
  });
});
