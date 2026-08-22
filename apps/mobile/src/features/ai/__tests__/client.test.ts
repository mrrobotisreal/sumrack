import { describe, expect, it, vi } from 'vitest';

import { chatCompletion, type ChatDeps } from '../client';
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
    expect(result).toEqual({ content: 'ответ', model: 'anthropic/claude-sonnet-5' });

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
});
