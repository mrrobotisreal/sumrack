import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiError } from '@/features/ai/errors';
import {
  buildRescueMessages,
  describeSlot,
  RESCUE_SYSTEM_TEMPLATE,
  type RescueInput,
} from '@/features/ai/prompts/scenario-rescue';
import { DEFAULT_MODEL_TABLE } from '@/features/ai/run-profile';
import { RescueVerdictSchema } from '@/features/ai/schemas';

import { judgeAnswer } from '../judge/judge';
import {
  parseRescueReply,
  RESCUE_MAX_TOKENS,
  RESCUE_MIN_CONTENT_TOKENS,
  RESCUE_TIMEOUT_MS,
  rescueMiss,
  rescueProfile,
  shouldRescue,
  type RescueDeps,
} from '../judge/rescue';

const track = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(async () => ({ isInternetReachable: true })),
  addNetworkStateListener: vi.fn(),
}));
vi.mock('@/db', () => ({
  repos: { settings: { get: vi.fn(async () => null), set: vi.fn() } },
}));

/**
 * The online rescue (T60, SPEAKING_SCENARIOS §5.3): the gate, the verbatim
 * prompt, the fixture parse (two live Haiku 4.5 captures at fastest/low —
 * `scenario-rescue-accept.json` / `-reject.json`), and the timeout ⇒
 * offline-verdict path. No network here, ever.
 */

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai/__tests__/__fixtures__',
);
interface RescueFixture {
  input: RescueInput;
  model: string;
  choices: { message: { content: string }; finish_reason: string | null }[];
}
function fixture(name: string): RescueFixture {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as RescueFixture;
}

const accept = fixture('scenario-rescue-accept');
const reject = fixture('scenario-rescue-reject');

describe('the rescue prompt', () => {
  it('system prompt is the §5.3 text verbatim with the language substituted', () => {
    const messages = buildRescueMessages(accept.input);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toBe(RESCUE_SYSTEM_TEMPLATE.replace('{LANGUAGE_NAME}', 'Russian'));
    expect(messages[0]!.content).toContain(
      '{"verdict":"accept"|"reject","branchKey":string|null,"reason":string}',
    );
    expect(messages[0]!.content).not.toContain('{LANGUAGE_NAME}');
    expect(buildRescueMessages({ ...accept.input, language: 'uk' })[0]!.content).toContain(
      'Ukrainian',
    );
  });

  it('user turn carries question RU/EN · slots · accept list · keys · transcript', () => {
    const user = buildRescueMessages(accept.input)[1]!.content;
    expect(user).toContain(
      'Question: «Очень приятно! Откуда ты?» — "Nice to meet you! Where are you from?"',
    );
    expect(user).toContain('- origin: usa|colorado|elsewhere (required)');
    expect(user).toContain('Accepted paraphrases: «Я из Америки.» | «Из Колорадо.» | «Я из США.»');
    expect(user).toContain('Allowed branch keys: usa, colorado, elsewhere');
    expect(user).toContain('Transcript: «я родился в денвере и живу там всю жизнь»');
  });

  it('describeSlot renders every slot kind', () => {
    expect(
      describeSlot({
        kind: 'forms',
        id: 'd',
        required: true,
        acceptsNumber: true,
        options: [{ key: 'long', lemma: 'давно', forms: ['давно'] }],
      }),
    ).toBe('d: long|number (required)');
    expect(describeSlot({ kind: 'number', id: 'n', required: false })).toBe(
      'n: a number (optional)',
    );
    expect(describeSlot({ kind: 'free', id: 'name', required: true, minTokens: 1 })).toBe(
      'name: any answer of ≥ 1 content word (required)',
    );
    expect(
      describeSlot({ kind: 'free', id: 's', required: true, minTokens: 3, cues: ['я видел'] }),
    ).toBe('s: any answer of ≥ 3 content words, with one of: я видел (required)');
    expect(buildRescueMessages({ ...accept.input, allowedKeys: [] })[1]!.content).toContain(
      'Allowed branch keys: none (reply null)',
    );
  });
});

describe('shouldRescue (the §5.3 gate)', () => {
  const miss = { verdict: 'miss' as const, contentTokenCount: 3 };
  it('needs miss ∧ online ∧ pref ∧ key ∧ ≥ 2 content tokens', () => {
    expect(shouldRescue({ judge: miss, online: true, rescueOnline: true, hasKey: true })).toBe(
      true,
    );
    expect(
      shouldRescue({
        judge: { ...miss, verdict: 'matched' },
        online: true,
        rescueOnline: true,
        hasKey: true,
      }),
    ).toBe(false);
    expect(
      shouldRescue({
        judge: { ...miss, verdict: 'no-speech' },
        online: true,
        rescueOnline: true,
        hasKey: true,
      }),
    ).toBe(false);
    expect(shouldRescue({ judge: miss, online: false, rescueOnline: true, hasKey: true })).toBe(
      false,
    );
    expect(shouldRescue({ judge: miss, online: true, rescueOnline: false, hasKey: true })).toBe(
      false,
    );
    expect(shouldRescue({ judge: miss, online: true, rescueOnline: true, hasKey: false })).toBe(
      false,
    );
    expect(
      shouldRescue({
        judge: { ...miss, contentTokenCount: 1 },
        online: true,
        rescueOnline: true,
        hasKey: true,
      }),
    ).toBe(false);
    expect(RESCUE_MIN_CONTENT_TOKENS).toBe(2);
  });

  it('the fixture transcripts are misses the offline judge would hand over', () => {
    const j = judgeAnswer(accept.input.transcript, accept.input);
    expect(j.verdict).toBe('miss');
    expect(j.contentTokenCount).toBeGreaterThanOrEqual(2);
    expect(shouldRescue({ judge: j, online: true, rescueOnline: true, hasKey: true })).toBe(true);
  });

  it('constants: 4 s deadline, 200 tokens, fastest/low of the preferred provider', () => {
    expect(RESCUE_TIMEOUT_MS).toBe(4000);
    expect(RESCUE_MAX_TOKENS).toBe(200);
    expect(rescueProfile({ provider: 'openai', quality: 'best', effort: 'ultra' })).toEqual({
      provider: 'openai',
      quality: 'fastest',
      effort: 'low',
    });
  });
});

describe('parseRescueReply (captured fixtures)', () => {
  it('accept fixture: fenced JSON ⇒ accept + a valid branch key', () => {
    const content = accept.choices[0]!.message.content;
    expect(
      RescueVerdictSchema.safeParse(JSON.parse(content.replace(/```json|```/g, ''))).success,
    ).toBe(true);
    const r = parseRescueReply(content, accept.input.allowedKeys);
    expect(r.verdict).toBe('accept');
    expect(r.branchKey).toBe('colorado');
    expect(r.reason).toBeTruthy();
  });

  it('reject fixture ⇒ reject, null key', () => {
    const r = parseRescueReply(reject.choices[0]!.message.content, reject.input.allowedKeys);
    expect(r.verdict).toBe('reject');
    expect(r.branchKey).toBeNull();
  });

  it('an unknown branch key is dropped to null (⇒ next.default)', () => {
    const r = parseRescueReply('{"verdict":"accept","branchKey":"mars","reason":"x"}', ['usa']);
    expect(r).toEqual({ verdict: 'accept', branchKey: null, reason: 'x' });
  });

  it('garbage ⇒ invalid-response', () => {
    expect(() => parseRescueReply('Sure! The answer is fine.', [])).toThrow(AiError);
    expect(() => parseRescueReply('{"verdict":"maybe"}', [])).toThrow(AiError);
  });
});

describe('rescueMiss', () => {
  const preset = {
    provider: 'anthropic' as const,
    quality: 'normal' as const,
    effort: 'high' as const,
  };
  let now = 1000;
  const deps = (chat: RescueDeps['chat']): RescueDeps => ({
    chat,
    now: () => now,
  });
  beforeEach(() => {
    track.mockClear();
    now = 1000;
  });

  it('accept ⇒ {accept, branchKey, ms, model} + scenario_rescue', async () => {
    const out = await rescueMiss(
      accept.input,
      { preset, table: DEFAULT_MODEL_TABLE },
      deps(async (input, table, p) => {
        expect(input.transcript).toBe(accept.input.transcript);
        expect(p).toEqual(preset);
        expect(table.anthropic.fastest).toBe('anthropic/claude-haiku-4.5');
        now += 850;
        return { content: accept.choices[0]!.message.content, model: accept.model };
      }),
    );
    expect(out).toMatchObject({
      verdict: 'accept',
      branchKey: 'colorado',
      ms: 850,
      model: accept.model,
    });
    expect(track).toHaveBeenCalledWith('scenario_rescue', {
      verdict: 'accept',
      ms: 850,
      model: accept.model,
    });
  });

  it('reject ⇒ {reject}', async () => {
    const out = await rescueMiss(
      reject.input,
      { preset, table: DEFAULT_MODEL_TABLE },
      deps(async () => ({ content: reject.choices[0]!.message.content, model: reject.model })),
    );
    expect(out.verdict).toBe('reject');
  });

  it('a thrown AiError ⇒ {error, code} — never rejects', async () => {
    const out = await rescueMiss(
      accept.input,
      { preset, table: DEFAULT_MODEL_TABLE },
      deps(async () => {
        throw new AiError('http-server', 'boom', 503);
      }),
    );
    expect(out).toMatchObject({
      verdict: 'error',
      code: 'http-server',
      model: 'anthropic/claude-haiku-4.5',
    });
    expect(track).toHaveBeenCalledWith(
      'scenario_rescue',
      expect.objectContaining({ verdict: 'error', code: 'http-server' }),
    );
  });

  it('an unparseable reply ⇒ {error, invalid-response}', async () => {
    const out = await rescueMiss(
      accept.input,
      { preset, table: DEFAULT_MODEL_TABLE },
      deps(async () => ({ content: 'no json here', model: 'm' })),
    );
    expect(out).toMatchObject({ verdict: 'error', code: 'invalid-response' });
  });

  it('a chat that never resolves is cut at the 4 s deadline ⇒ {error, timeout}', async () => {
    vi.useFakeTimers();
    try {
      const pending = rescueMiss(
        accept.input,
        { preset, table: DEFAULT_MODEL_TABLE },
        deps(() => new Promise(() => undefined)),
      );
      await vi.advanceTimersByTimeAsync(RESCUE_TIMEOUT_MS + 1);
      const out = await pending;
      expect(out).toMatchObject({ verdict: 'error', code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});
