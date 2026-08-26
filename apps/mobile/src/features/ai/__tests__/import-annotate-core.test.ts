import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePack, reconstructSentenceRu } from '@sumrak/schema';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { AiError } from '../errors';
import {
  annotateSentences,
  buildPackFromEnvelope,
  buildSentenceFromResponse,
  deleteSentence,
  envelopeProgress,
  isPunctText,
  mergeLevel,
  mergeWithNext,
  newEnvelope,
  parseEnvelope,
  processAnnotateQueue,
  splitAfterWord,
  tokenIsLowConfidence,
  type AnnotationEnvelope,
} from '../import-annotate-core';
import {
  buildImportAnnotateMessages,
  buildImportAnnotateRetryMessages,
} from '../prompts/import-annotate';
import { extractJsonObject, ImportAnnotateResponseSchema } from '../schemas';

/**
 * T29 import-annotation core tests. The happy path parses a REAL recorded
 * Sonnet response (scripts/capture-ai-fixtures.ts import-annotate) with the
 * exact production parsers — no live network in CI; failure paths use
 * synthetic completions.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'import-annotate.json'), 'utf8')) as {
  sentences: { id: string; ru: string }[];
  model: string;
  content: string;
};

function chatOk(content: string) {
  return vi.fn().mockResolvedValue({ content, model: 'test-model' });
}

const noSleep = (_ms: number) => Promise.resolve();

describe('prompt templates', () => {
  it('system pins the JSON contract + lemma conventions; user carries id: ru lines', () => {
    const messages = buildImportAnnotateMessages([{ id: 'c1', ru: 'Я дома.' }]);
    expect(messages[0]!.role).toBe('system');
    for (const marker of ['"sentences"', '"tokens"', '"lemma"', 'imperfective infinitive', 'ё']) {
      expect(messages[0]!.content).toContain(marker);
    }
    expect(messages[1]!.content).toContain('c1: Я дома.');
  });

  it('retry continues the conversation with the raw output and exact errors', () => {
    const messages = buildImportAnnotateRetryMessages(
      [{ id: 'c1', ru: 'Я дома.' }],
      '{"bad": true}',
      [{ id: 'c1', error: 'token "дом" does not match' }],
    );
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ role: 'assistant', content: '{"bad": true}' });
    expect(messages[3]!.content).toContain('c1: token "дом" does not match');
  });
});

describe('recorded fixture (real Sonnet response)', () => {
  const response = ImportAnnotateResponseSchema.parse(extractJsonObject(fixture.content));

  it('parses with the production schema and echoes every sentence id', () => {
    expect(response.sentences.map((s) => s.id).sort()).toEqual(
      fixture.sentences.map((s) => s.id).sort(),
    );
    expect(response.level).toBeDefined();
  });

  it('every sentence reconstructs exactly and word tokens carry lemma+translation', () => {
    for (const input of fixture.sentences) {
      const got = response.sentences.find((s) => s.id === input.id)!;
      const built = buildSentenceFromResponse(input.ru, got.en, got.tokens);
      expect(reconstructSentenceRu(built.tokens)).toBe(input.ru);
      for (const tok of built.tokens) {
        if (!tok.isPunct) {
          expect(tok.lemma).toBeTruthy();
          expect(tok.translation).toBeTruthy();
        }
      }
    }
  });

  it('handles the recorded edge cases: «» quotes, digits, emoji, latin, names', () => {
    const byId = new Map(response.sentences.map((s) => [s.id, s]));
    // c2: «Пятёрочка» hugs its quotes (spaceBefore derivation) + latin Yandex
    const c2 = buildSentenceFromResponse(
      fixture.sentences[1]!.ru,
      byId.get('c2')!.en,
      byId.get('c2')!.tokens,
    );
    const quote = c2.tokens.findIndex((t) => t.text === '«');
    expect(c2.tokens[quote]!.spaceBefore).toBe(true);
    expect(c2.tokens[quote + 1]!.spaceBefore).toBe(false);
    expect(c2.tokens.find((t) => t.text === 'Yandex')!.isPunct).toBeUndefined();
    // c3: emoji passes through as punctuation
    const c3 = buildSentenceFromResponse(
      fixture.sentences[2]!.ru,
      byId.get('c3')!.en,
      byId.get('c3')!.tokens,
    );
    expect(c3.tokens.find((t) => t.text === '🙂')!.isPunct).toBe(true);
    // c4: the name keeps its capital in the lemma
    const c4 = buildSentenceFromResponse(
      fixture.sentences[3]!.ru,
      byId.get('c4')!.en,
      byId.get('c4')!.tokens,
    );
    const anna = c4.tokens.find((t) => t.text === 'Анна')!;
    expect(anna.lemma).toBe('Анна');
  });
});

describe('buildSentenceFromResponse failure honesty', () => {
  it('rejects a word token missing lemma/translation — never auto-fills', () => {
    expect(() =>
      buildSentenceFromResponse('Я дома.', 'I am home.', [
        { text: 'Я', lemma: 'я', translation: 'I' },
        { text: 'дома' },
        { text: '.' },
      ]),
    ).toThrow(/missing lemma/);
  });

  it('rejects altered token text with a ⟨here⟩ marker at the break point', () => {
    expect(() =>
      buildSentenceFromResponse('Я чёрный кот.', 'I am a black cat.', [
        { text: 'Я', lemma: 'я', translation: 'I' },
        { text: 'черный', lemma: 'чёрный', translation: 'black' }, // ё folded — must fail
        { text: 'кот', lemma: 'кот', translation: 'cat' },
        { text: '.' },
      ]),
    ).toThrow(/⟨here⟩/);
  });

  it('rejects a token table that ends before the sentence does', () => {
    expect(() =>
      buildSentenceFromResponse('Я дома.', 'I am home.', [
        { text: 'Я', lemma: 'я', translation: 'I' },
        { text: 'дома', lemma: 'дома', translation: 'at home' },
      ]),
    ).toThrow(/unconsumed/);
  });

  it('drops annotations from punctuation and stray whitespace tokens', () => {
    const built = buildSentenceFromResponse('Я дома.', 'I am home.', [
      { text: 'Я', lemma: 'я', translation: 'I', pos: 'pron', grammar: 'nom.', level: 'A1' },
      { text: ' ' },
      {
        text: 'дома',
        lemma: 'дома',
        translation: 'at home',
        pos: 'adv',
        grammar: 'adv.',
        level: 'A1',
      },
      { text: '.', lemma: 'период', translation: 'period' },
    ]);
    expect(built.tokens).toHaveLength(3);
    expect(built.tokens[2]).toEqual({ text: '.', isPunct: true });
  });
});

describe('confidence rule', () => {
  it('flags model-uncertain tokens, content words missing grammar/level, and pos-less words', () => {
    const flag = (raw: Parameters<typeof tokenIsLowConfidence>[0]) =>
      tokenIsLowConfidence(raw, {
        text: raw.text,
        ...(raw.lemma ? { lemma: raw.lemma } : {}),
        ...(raw.translation ? { translation: raw.translation } : {}),
        ...(raw.pos ? { pos: raw.pos } : {}),
        ...(raw.grammar ? { grammar: raw.grammar } : {}),
        ...(raw.level ? { level: raw.level } : {}),
        ...(isPunctText(raw.text) ? { isPunct: true } : {}),
      });
    const full = {
      text: 'кот',
      lemma: 'кот',
      translation: 'cat',
      pos: 'noun',
      grammar: 'm.sg. nom.',
      level: 'A1' as const,
    };
    expect(flag(full)).toBe(false);
    expect(flag({ ...full, uncertain: true })).toBe(true);
    expect(flag({ ...full, grammar: undefined })).toBe(true);
    expect(flag({ ...full, level: undefined })).toBe(true);
    expect(flag({ ...full, pos: undefined })).toBe(true);
    // adverbs are uninflected: no grammar note is fine, but level still required
    const adv = {
      text: 'очень',
      lemma: 'очень',
      translation: 'very',
      pos: 'adv',
      level: 'A1' as const,
    };
    expect(flag(adv)).toBe(false);
    expect(flag({ ...adv, level: undefined })).toBe(true);
    // names/foreign/num deliberately omit level — exempt from the heuristic
    expect(flag({ text: 'Анна', lemma: 'Анна', translation: 'Anna', pos: 'name' })).toBe(false);
    expect(flag({ text: '.' })).toBe(false);
  });
});

describe('envelope + boundary edits', () => {
  it('newEnvelope splits the request text into pending sentences', () => {
    const env = newEnvelope('Я дома. Кто там?');
    expect(env.sentences.map((s) => s.ru)).toEqual(['Я дома.', 'Кто там?']);
    expect(env.sentences.every((s) => s.status === 'pending')).toBe(true);
    expect(envelopeProgress(env)).toEqual({ done: 0, total: 2, flagged: 0 });
  });

  it('round-trips through JSON and rejects garbage', () => {
    const env = newEnvelope('Я дома.');
    expect(parseEnvelope(JSON.stringify(env))).toEqual(env);
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ v: 2 }))).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
  });

  it('merge joins with the next sentence and resets to pending', () => {
    const env = newEnvelope('Это был не сон. А что-то другое.');
    env.sentences[0]!.status = 'ok';
    const merged = mergeWithNext(env, env.sentences[0]!.uid);
    expect(merged.sentences).toHaveLength(1);
    expect(merged.sentences[0]).toMatchObject({
      ru: 'Это был не сон. А что-то другое.',
      status: 'pending',
    });
  });

  it('split divides after a word, allocating a fresh uid', () => {
    const env = newEnvelope('Я дома и мне страшно');
    const split = splitAfterWord(env, env.sentences[0]!.uid, 1);
    expect(split.sentences.map((s) => s.ru)).toEqual(['Я дома', 'и мне страшно']);
    expect(split.sentences[1]!.uid).toBe('c2');
    expect(split.nextUid).toBe(3);
    // out-of-range is a no-op
    expect(splitAfterWord(env, env.sentences[0]!.uid, 5)).toBe(env);
  });

  it('delete removes a sentence', () => {
    const env = newEnvelope('Я дома. Кто там?');
    const after = deleteSentence(env, env.sentences[0]!.uid);
    expect(after.sentences.map((s) => s.ru)).toEqual(['Кто там?']);
  });
});

describe('mergeLevel', () => {
  it('takes the max across CEFR order', () => {
    expect(mergeLevel(undefined, 'A2')).toBe('A2');
    expect(mergeLevel('B1', undefined)).toBe('B1');
    expect(mergeLevel('A2', 'B2')).toBe('B2');
    expect(mergeLevel('C1', 'A1')).toBe('C1');
  });
});

// ——— annotation pass ———

const goodTokens = (words: [string, string, string][]) =>
  words.map(([text, lemma, translation]) => ({
    text,
    ...(isPunctText(text) ? {} : { lemma, translation, pos: 'noun', grammar: 'x', level: 'A1' }),
  }));

function completion(sentences: unknown[], level = 'A1') {
  return JSON.stringify({ level, sentences });
}

describe('annotateSentences (semantic retry)', () => {
  const env = (): AnnotationEnvelope => newEnvelope('Я дома.');

  const good = {
    id: 'c1',
    en: 'I am home.',
    tokens: [
      { text: 'Я', lemma: 'я', translation: 'I', pos: 'pron', grammar: 'nom.', level: 'A1' },
      {
        text: 'дома',
        lemma: 'дома',
        translation: 'at home',
        pos: 'adv',
        grammar: 'adv.',
        level: 'A1',
      },
      { text: '.' },
    ],
  };
  const mangled = { ...good, tokens: [{ text: 'Я was here', lemma: 'я', translation: 'I' }] };

  it('reconstruction failure → one retry with the exact error → success', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: completion([mangled]), model: 'm' })
      .mockResolvedValueOnce({ content: completion([good]), model: 'm' });
    const onRetry = vi.fn();
    const out = await annotateSentences({ chat, sleep: noSleep, onRetry }, env(), ['c1']);
    expect(out.sentences[0]!.status).toBe('ok');
    expect(out.sentences[0]!.en).toBe('I am home.');
    expect(onRetry).toHaveBeenCalledWith(1);
    // The retry message carried the ⟨here⟩ error and the raw first output.
    const retryMessages = chat.mock.calls[1]![0].messages;
    expect(retryMessages.some((m: { content: string }) => m.content.includes('⟨here⟩'))).toBe(true);
  });

  it('retry still failing → needs-review with error + raw attempt preserved', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: completion([mangled]), model: 'm' })
      .mockResolvedValueOnce({ content: completion([mangled]), model: 'm' });
    const out = await annotateSentences({ chat, sleep: noSleep }, env(), ['c1']);
    const s = out.sentences[0]!;
    expect(s.status).toBe('needs-review');
    expect(s.error).toMatch(/⟨here⟩/);
    expect(s.raw).toEqual(mangled.tokens);
  });

  it('sentence not returned at all → needs-review', async () => {
    const other = { ...good, id: 'zz' };
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: completion([other]), model: 'm' })
      .mockResolvedValueOnce({ content: completion([other]), model: 'm' });
    const out = await annotateSentences({ chat, sleep: noSleep }, env(), ['c1']);
    expect(out.sentences[0]!.status).toBe('needs-review');
    expect(out.sentences[0]!.error).toMatch(/not returned/);
  });

  it('malformed JSON exhausts the transport ladder and throws invalid-response', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'not json at all', model: 'm' });
    await expect(
      annotateSentences({ chat, sleep: noSleep, retryDelaysMs: [0] }, env(), ['c1']),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(chat).toHaveBeenCalledTimes(2); // initial + one ladder retry
  });
});

describe('processAnnotateQueue', () => {
  const goodCompletion = completion([
    {
      id: 'c1',
      en: 'I am home.',
      tokens: goodTokens([
        ['Я', 'я', 'I'],
        ['дома', 'дома', 'at home'],
        ['.', '', ''],
      ]),
    },
    {
      id: 'c2',
      en: 'Who is there?',
      tokens: goodTokens([
        ['Кто', 'кто', 'who'],
        ['там', 'там', 'there'],
        ['?', '', ''],
      ]),
    },
  ]);

  interface MockedDeps {
    chat: Mock;
    sleep: (ms: number) => Promise<void>;
    listQueued: Mock;
    saveEnvelope: Mock;
    markAnnotated: Mock;
    isOnline: Mock;
    onPhase: Mock;
    onRequestDone?: Mock;
    retryDelaysMs?: number[];
  }

  function baseDeps(overrides: Partial<MockedDeps> = {}) {
    const saved: string[] = [];
    const deps: MockedDeps = {
      chat: chatOk(goodCompletion),
      sleep: noSleep,
      listQueued: vi
        .fn()
        .mockResolvedValue([{ id: 'req1', text: 'Я дома. Кто там?', annotationJson: null }]),
      saveEnvelope: vi.fn().mockImplementation(async (_id: string, json: string) => {
        saved.push(json);
      }),
      markAnnotated: vi.fn().mockResolvedValue(undefined),
      isOnline: vi.fn().mockResolvedValue(true),
      onPhase: vi.fn(),
      ...overrides,
    };
    return { deps, saved };
  }

  it('offline: row stays queued, phase reflects it, nothing runs', async () => {
    const { deps } = baseDeps({ isOnline: vi.fn().mockResolvedValue(false) });
    const done = await processAnnotateQueue(deps);
    expect(done).toBe(0);
    expect(deps.chat).not.toHaveBeenCalled();
    expect(deps.onPhase).toHaveBeenCalledWith('req1', { phase: 'queued' });
  });

  it('happy pass: envelope saved per batch, request marked annotated, stats reported', async () => {
    const onRequestDone = vi.fn();
    const { deps, saved } = baseDeps({ onRequestDone });
    const done = await processAnnotateQueue(deps);
    expect(done).toBe(1);
    // initial pending envelope + post-batch envelope
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(deps.markAnnotated).toHaveBeenCalledTimes(1);
    const finalEnv = parseEnvelope(deps.markAnnotated.mock.calls[0]![1])!;
    expect(finalEnv.sentences.every((s) => s.status === 'ok')).toBe(true);
    expect(onRequestDone).toHaveBeenCalledWith('req1', { sentences: 2, flagged: 0 });
    expect(deps.onPhase).toHaveBeenLastCalledWith('req1', null);
  });

  it('resumes from a partially annotated envelope (only pending sentences run)', async () => {
    const env = newEnvelope('Я дома. Кто там?');
    env.sentences[0] = {
      ...env.sentences[0]!,
      status: 'ok',
      en: 'I am home.',
      tokens: [
        { text: 'Я', lemma: 'я', translation: 'I' },
        { text: 'дома', lemma: 'дома', translation: 'at home' },
        { text: '.', isPunct: true },
      ],
    };
    const { deps } = baseDeps({
      listQueued: vi
        .fn()
        .mockResolvedValue([
          { id: 'req1', text: 'Я дома. Кто там?', annotationJson: JSON.stringify(env) },
        ]),
    });
    await processAnnotateQueue(deps);
    const userMsg = deps.chat.mock.calls[0]![0].messages[1].content as string;
    expect(userMsg).toContain('c2: Кто там?');
    expect(userMsg).not.toContain('c1:');
  });

  it('transport failure keeps the row queued with an error phase', async () => {
    const { deps } = baseDeps({
      chat: vi.fn().mockRejectedValue(new AiError('http-server', 'boom', 500)),
      retryDelaysMs: [],
    });
    const done = await processAnnotateQueue(deps);
    expect(done).toBe(0);
    expect(deps.markAnnotated).not.toHaveBeenCalled();
    const last = deps.onPhase.mock.calls.at(-1)!;
    expect(last[1]).toMatchObject({ phase: 'error' });
  });

  it('a key problem halts the whole pass (second request untouched)', async () => {
    const { deps } = baseDeps({
      chat: vi.fn().mockRejectedValue(new AiError('no-key', 'no key')),
      listQueued: vi.fn().mockResolvedValue([
        { id: 'req1', text: 'Я дома.', annotationJson: null },
        { id: 'req2', text: 'Кто там?', annotationJson: null },
      ]),
    });
    await processAnnotateQueue(deps);
    expect(deps.chat).toHaveBeenCalledTimes(1);
  });
});

describe('buildPackFromEnvelope + the commit gate', () => {
  it('builds a schema-valid pack from ok sentences, excluding flagged/pending', () => {
    const env = newEnvelope('Я дома. Кто там? Охохо какой-то бред.');
    env.level = 'A2';
    env.sentences[0] = {
      ...env.sentences[0]!,
      status: 'ok',
      en: 'I am home.',
      tokens: [
        { text: 'Я', lemma: 'я', translation: 'I' },
        { text: 'дома', lemma: 'дома', translation: 'at home' },
        { text: '.', isPunct: true },
      ],
    };
    env.sentences[1] = {
      ...env.sentences[1]!,
      status: 'ok',
      en: 'Who is there?',
      tokens: [
        { text: 'Кто', lemma: 'кто', translation: 'who' },
        { text: 'там', lemma: 'там', translation: 'there' },
        { text: '?', isPunct: true },
      ],
    };
    env.sentences[2] = { ...env.sentences[2]!, status: 'needs-review', error: 'nope' };

    const { pack, included, excluded } = buildPackFromEnvelope({
      packId: 'imported-20260825-test',
      title: 'Тест',
      env,
    });
    expect(included).toBe(2);
    expect(excluded).toBe(1);
    const parsed = parsePack(pack);
    expect(parsed.level).toBe('A2');
    expect(parsed.tags).toContain('imported');
    expect(parsed.stories[0]!.sentences.map((s) => s.id)).toEqual(['s1-001', 's1-002']);
  });
});
