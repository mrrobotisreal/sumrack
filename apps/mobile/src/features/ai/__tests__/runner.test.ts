import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiError } from '../errors';
import { DEFAULT_MODEL_TABLE, resolveRun } from '../run-profile';
import { EFFORT_REJECTION_WORDS, isEffortParamRejection, runChat } from '../runner';

const track = vi.hoisted(() => vi.fn());
const fetchFn = vi.hoisted(() => vi.fn());

vi.mock('@/services/analytics', () => ({ track }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => 'test-key-value'),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock('@/db', () => ({
  repos: { settings: { get: vi.fn(async () => null), set: vi.fn() } },
}));

// Route the real client through an injectable fetch: runner → chatCompletion.
vi.mock('../client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../client')>();
  return {
    ...mod,
    chatCompletion: (
      req: Parameters<typeof mod.chatCompletion>[0],
      deps: Parameters<typeof mod.chatCompletion>[1],
    ) => mod.chatCompletion(req, { ...deps, fetchFn: fetchFn as unknown as typeof fetch }),
  };
});

const MESSAGES = [{ role: 'user' as const, content: 'Reply with exactly: ok' }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sentBody(call: number): Record<string, unknown> {
  const [, init] = fetchFn.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

const OK = { model: 'anthropic/claude-opus-5.5', choices: [{ message: { content: 'ok' } }] };

beforeEach(() => {
  track.mockClear();
  fetchFn.mockReset();
});

describe('isEffortParamRejection (§4.4)', () => {
  it('matches a 4xx http-client naming the effort lever, case-insensitively', () => {
    for (const word of EFFORT_REJECTION_WORDS) {
      expect(
        isEffortParamRejection(new AiError('http-client', `Bad ${word.toUpperCase()} x`, 400)),
      ).toBe(true);
    }
    expect(
      isEffortParamRejection(new AiError('http-client', 'Unknown parameter: verbosity', 422)),
    ).toBe(true);
  });

  it('ignores other codes, 5xx, and unrelated 4xx messages', () => {
    expect(isEffortParamRejection(new AiError('http-server', 'verbosity broke', 500))).toBe(false);
    expect(isEffortParamRejection(new AiError('http-client', 'verbosity broke', 500))).toBe(false);
    expect(isEffortParamRejection(new AiError('http-client', 'context too long', 400))).toBe(false);
    expect(isEffortParamRejection(new AiError('http-auth', 'effort', 401))).toBe(false);
    expect(isEffortParamRejection(new Error('verbosity'))).toBe(false);
  });
});

describe('runChat with a run profile', () => {
  it('sets model + extras and stamps provider/quality/effort/model on the lifecycle events', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse(OK));
    const run = resolveRun(
      { provider: 'anthropic', quality: 'normal', effort: 'ultra' },
      DEFAULT_MODEL_TABLE,
    );
    const result = await runChat('grammar-key-test', { messages: MESSAGES, maxTokens: 64 }, run);

    expect(result.content).toBe('ok');
    expect(result.effortApplied).toBe(true);
    const body = sentBody(0);
    expect(body.model).toBe('anthropic/claude-opus-5.5');
    expect(body.verbosity).toBe('xhigh');
    expect(body.reasoning).toEqual({ enabled: true, exclude: true });
    expect(body.usage).toEqual({ include: true });

    const stamp = {
      feature: 'grammar-key-test',
      provider: 'anthropic',
      quality: 'normal',
      effort: 'ultra',
      model: 'anthropic/claude-opus-5.5',
    };
    expect(track).toHaveBeenCalledWith('ai_request_sent', stamp);
    expect(track).toHaveBeenCalledWith('ai_request_succeeded', expect.objectContaining(stamp));
  });

  it('falls back ONCE without the effort extras on a matching 4xx', async () => {
    fetchFn
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Unsupported parameter: verbosity' } }, 400),
      )
      .mockResolvedValueOnce(jsonResponse(OK));
    const run = resolveRun(
      { provider: 'openai', quality: 'fast', effort: 'high' },
      DEFAULT_MODEL_TABLE,
    );
    const result = await runChat('word-profile', { messages: MESSAGES }, run);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sentBody(0).reasoning).toEqual({ effort: 'high', exclude: true });
    const retry = sentBody(1);
    expect(retry).not.toHaveProperty('reasoning');
    expect(retry).not.toHaveProperty('verbosity');
    expect(retry.usage).toEqual({ include: true });
    expect(retry.model).toBe('openai/gpt-6-sol');
    expect(result.effortApplied).toBe(false);
    expect(track).toHaveBeenCalledWith('ai_effort_param_rejected', {
      provider: 'openai',
      model: 'openai/gpt-6-sol',
    });
    expect(track).toHaveBeenCalledTimes(3); // sent, rejected, succeeded
  });

  it('does not retry a second rejection, nor a 5xx', async () => {
    fetchFn
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'reasoning not supported' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'reasoning not supported' } }, 400));
    const run = resolveRun(
      { provider: 'anthropic', quality: 'fastest', effort: 'low' },
      DEFAULT_MODEL_TABLE,
    );
    await expect(runChat('grammar-lesson', { messages: MESSAGES }, run)).rejects.toMatchObject({
      code: 'http-client',
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledWith(
      'ai_request_failed',
      expect.objectContaining({ code: 'http-client', provider: 'anthropic' }),
    );

    fetchFn.mockReset();
    track.mockClear();
    fetchFn.mockResolvedValueOnce(jsonResponse({ error: { message: 'verbosity exploded' } }, 500));
    await expect(runChat('grammar-lesson', { messages: MESSAGES }, run)).rejects.toMatchObject({
      code: 'http-server',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalledWith('ai_effort_param_rejected', expect.anything());
  });
});

describe('runChat without a run profile (decision 6 guard)', () => {
  it('sends the legacy body — no verbosity/reasoning/usage keys, no run props', async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({
        model: 'anthropic/claude-sonnet-5',
        choices: [{ message: { content: 'x' } }],
      }),
    );
    const result = await runChat('explain', { messages: MESSAGES, maxTokens: 10 });
    expect(Object.keys(sentBody(0))).toEqual(['model', 'messages', 'max_tokens', 'temperature']);
    expect(sentBody(0).model).toBe('anthropic/claude-sonnet-5'); // DEFAULT_MODEL via getModel()
    expect(result).not.toHaveProperty('effortApplied');
    expect(track).toHaveBeenCalledWith('ai_request_sent', { feature: 'explain' });
    expect(track).toHaveBeenCalledWith('ai_request_succeeded', {
      feature: 'explain',
      ms: expect.any(Number),
    });
  });

  it('a 4xx naming verbosity is NOT retried for a legacy request', async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ error: { message: 'verbosity?' } }, 400));
    await expect(runChat('journal-feedback', { messages: MESSAGES })).rejects.toMatchObject({
      code: 'http-client',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
