import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncError } from '../errors';
import { GithubContentClient } from '../github-client';

const TOKEN = 'github_pat_TEST_NEVER_LOGGED';

function mockFetch(status: number, body?: Uint8Array, headers?: Record<string, string>) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    arrayBuffer: async () => (body ?? new Uint8Array()).buffer,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GithubContentClient', () => {
  const client = () =>
    new GithubContentClient(
      { owner: 'mrrobotisreal', repo: 'sumrack-content', branch: 'main' },
      TOKEN,
    );

  it('requests the contents API with raw accept, bearer auth, and encoded ref', async () => {
    const body = new TextEncoder().encode('{"schemaVersion":1,"packs":[]}');
    const fn = mockFetch(200, body);
    const bytes = await client().fetchRawFile('packs/a1-creepypasta-001/pack.json');
    expect(new TextDecoder().decode(bytes)).toContain('schemaVersion');

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.github.com/repos/mrrobotisreal/sumrack-content/contents/packs/a1-creepypasta-001/pack.json?ref=main',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Accept).toBe('application/vnd.github.raw+json');
  });

  it.each([
    [401, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'http'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    mockFetch(status);
    const err = await client()
      .fetchRawFile('manifest.json')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect((err as SyncError).code).toBe(code);
  });

  it('maps 403 with exhausted rate limit to rate-limited', async () => {
    mockFetch(403, undefined, { 'x-ratelimit-remaining': '0' });
    const err = await client()
      .fetchRawFile('manifest.json')
      .catch((e: unknown) => e);
    expect((err as SyncError).code).toBe('rate-limited');
  });

  it('never includes the token in error messages', async () => {
    for (const status of [401, 403, 404, 429, 500]) {
      mockFetch(status);
      const err = (await client()
        .fetchRawFile('manifest.json')
        .catch((e: unknown) => e)) as Error;
      expect(err.message).not.toContain(TOKEN);
      expect(String(err.stack)).not.toContain(TOKEN);
    }
  });

  it('wraps network failures without leaking the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError(`fetch failed: some internals mentioning Bearer ${TOKEN}`);
      }),
    );
    const err = (await client()
      .fetchRawFile('manifest.json')
      .catch((e: unknown) => e)) as SyncError;
    expect(err.code).toBe('network');
    expect(err.message).not.toContain(TOKEN);
  });
});
