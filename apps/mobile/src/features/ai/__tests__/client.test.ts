import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { buildRequestBody, chatCompletion, type ChatDeps } from '../client';
import { AiError } from '../errors';

const MESSAGES = [{ role: 'user' as const, content: 'привет' }];

function deps(overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    getApiKey: async () => 'test-key-value',
    getModel: async () => 'anthropic/claude-sonnet-5',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('chatCompletion', () => {
  it('returns content and served model on success', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        model: 'anthropic/claude-sonnet-5',
        choices: [{ message: { content: 'ответ' } }],
      }),
    );
    const result = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn }));
    expect(result).toEqual({
      content: 'ответ',
      model: 'anthropic/claude-sonnet-5',
      usage: undefined,
      finishReason: undefined,
    });

    // The key travels ONLY in the Authorization header — never in the body.
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key-value');
    expect(init.body as string).not.toContain('test-key-value');
  });

  it('throws no-key without touching the network', async () => {
    const fetchFn = vi.fn();
    await expect(
      chatCompletion({ messages: MESSAGES }, deps({ fetchFn, getApiKey: async () => null })),
    ).rejects.toMatchObject({ code: 'no-key' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'http-auth'],
    [403, 'http-auth'],
    [429, 'http-rate'],
    [400, 'http-client'],
    [500, 'http-server'],
    [503, 'http-server'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const fetchFn = vi.fn(async () => jsonResponse({}, status as number));
    await expect(chatCompletion({ messages: MESSAGES }, deps({ fetchFn }))).rejects.toMatchObject({
      code,
    });
  });

  it('prefers the provider error message but keeps the status-derived code', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { message: 'model is overloaded' } }, 500),
    );
    const err = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn })).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('http-server');
    expect(err.message).toBe('model is overloaded');
  });

  it('rejects non-JSON and malformed envelopes as invalid-response', async () => {
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(
      chatCompletion({ messages: MESSAGES }, deps({ fetchFn: notJson })),
    ).rejects.toMatchObject({ code: 'invalid-response' });

    const badShape = vi.fn(async () => jsonResponse({ choices: [] }));
    await expect(
      chatCompletion({ messages: MESSAGES }, deps({ fetchFn: badShape })),
    ).rejects.toMatchObject({ code: 'invalid-response' });

    const empty = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '  ' } }] }));
    await expect(
      chatCompletion({ messages: MESSAGES }, deps({ fetchFn: empty })),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('maps fetch network failures to a retriable network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(chatCompletion({ messages: MESSAGES }, deps({ fetchFn }))).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('times out via AbortController → timeout code', async () => {
    const fetchFn = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(
      chatCompletion(
        { messages: MESSAGES, timeoutMs: 20 },
        deps({ fetchFn: fetchFn as unknown as typeof fetch }),
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  // --- T51: model / extras on the request, usage + finish_reason on the response ---

  it('req.model overrides deps.getModel(); extras merge after the standard fields', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    await chatCompletion(
      {
        messages: MESSAGES,
        model: 'openai/gpt-6-sol',
        extras: { reasoning: { effort: 'low', exclude: true }, usage: { include: true } },
      },
      deps({ fetchFn }),
    );
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('openai/gpt-6-sol');
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(body.usage).toEqual({ include: true });
    expect(body.messages).toEqual(MESSAGES);
  });

  it('extras can never clobber messages / model / max_tokens / temperature', () => {
    const body = buildRequestBody(
      {
        messages: MESSAGES,
        maxTokens: 64,
        model: 'anthropic/claude-opus-5.5',
        extras: {
          model: 'evil/model',
          messages: [],
          max_tokens: 1,
          temperature: 2,
          verbosity: 'xhigh',
        },
      },
      'anthropic/claude-opus-5.5',
    );
    expect(body).toEqual({
      model: 'anthropic/claude-opus-5.5',
      messages: MESSAGES,
      max_tokens: 64,
      temperature: 0.3,
      verbosity: 'xhigh',
    });
  });

  it('a legacy request (no model, no extras) sends exactly the four standard fields', () => {
    expect(
      Object.keys(buildRequestBody({ messages: MESSAGES }, 'anthropic/claude-sonnet-5')),
    ).toEqual(['model', 'messages', 'max_tokens', 'temperature']);
  });

  it('parses usage (incl. reasoning tokens + cost) and finish_reason into the result', async () => {
    // Fixture shape: an OpenRouter response with `usage: { include: true }` accounting.
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        id: 'gen-123',
        model: 'anthropic/claude-opus-5.5',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 340,
          total_tokens: 352,
          cost: 0.0123,
          completion_tokens_details: { reasoning_tokens: 300 },
        },
      }),
    );
    const result = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn }));
    expect(result).toEqual({
      content: 'ok',
      model: 'anthropic/claude-opus-5.5',
      finishReason: 'stop',
      usage: { promptTokens: 12, completionTokens: 340, reasoningTokens: 300, costUsd: 0.0123 },
    });
  });

  it('parses the usage block of a REAL captured word-profile response (T52 fixture)', async () => {
    // word-profile-verb.json was captured by scripts/capture-ai-fixtures.ts with
    // `usage: { include: true }` — the exact envelope OpenRouter returns to the app.
    const fixture = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '__fixtures__/word-profile-verb.json',
        ),
        'utf8',
      ),
    ) as {
      model: string;
      choices: { message: { content: string }; finish_reason: string | null }[];
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        cost: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const fetchFn = vi.fn(async () => jsonResponse(fixture));
    const result = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn }));
    expect(result.model).toBe(fixture.model);
    expect(result.finishReason).toBe('stop');
    expect(result.content).toBe(fixture.choices[0]!.message.content);
    expect(result.usage).toEqual({
      promptTokens: fixture.usage.prompt_tokens,
      completionTokens: fixture.usage.completion_tokens,
      reasoningTokens: fixture.usage.completion_tokens_details?.reasoning_tokens,
      costUsd: fixture.usage.cost,
    });
    expect(result.usage!.costUsd).toBeGreaterThan(0);
    expect(result.usage!.completionTokens).toBeGreaterThan(1000);
  });

  it('finish_reason length + null content → the specific ran-out-of-room invalid-response', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        model: 'openai/gpt-6-astra',
        choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'length' }],
        usage: { prompt_tokens: 12, completion_tokens: 16384, cost: 0.5 },
      }),
    );
    const err = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn })).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('invalid-response');
    expect(err.message).toMatch(/ran out of room/);
  });

  it('null content WITHOUT length keeps the legacy empty-completion error', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: null }, finish_reason: 'stop' }] }),
    );
    const err = await chatCompletion({ messages: MESSAGES }, deps({ fetchFn })).catch((e) => e);
    expect(err.code).toBe('invalid-response');
    expect(err.message).toBe('empty completion');
  });
});
