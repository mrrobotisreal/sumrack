import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubContentClient } from '../github-client';

const TOKEN = 'github_pat_TEST_NEVER_LOGGED';

function mockFetch(status: number, jsonBody?: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => jsonBody,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () =>
  new GithubContentClient(
    { owner: 'mrrobotisreal', repo: 'sumrak-content', branch: 'main' },
    TOKEN,
  );

describe('GithubContentClient write/list methods (T20)', () => {
  it('listDirectory parses entries and requests the json media type', async () => {
    const fn = mockFetch(200, [
      {
        name: 'sumrak-backup-20260823-030000Z.json',
        path: 'backups/x.json',
        sha: 'abc',
        size: 42,
        type: 'file',
      },
      { name: 'sub', path: 'backups/sub', sha: 'def', size: 0, type: 'dir' },
    ]);
    const entries = await client().listDirectory('backups');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: 'sumrak-backup-20260823-030000Z.json', sha: 'abc' });

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/contents/backups?ref=main');
    expect((init.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');
  });

  it('listDirectory treats a missing directory as empty (first backup ever)', async () => {
    mockFetch(404);
    expect(await client().listDirectory('backups')).toEqual([]);
  });

  it('putFile PUTs base64 content with message + branch and no ref query', async () => {
    const fn = mockFetch(201, {});
    await client().putFile('backups/b.json', 'AAAA', 'Backup b.json');
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.github.com/repos/mrrobotisreal/sumrak-content/contents/backups/b.json',
    );
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'Backup b.json',
      content: 'AAAA',
      branch: 'main',
    });
    // Never a sha → an unexpected name collision fails loudly instead of overwriting.
  });

  it('deleteFile sends sha + message', async () => {
    const fn = mockFetch(200, {});
    await client().deleteFile('backups/old.json', 'sha123', 'Prune');
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'Prune',
      sha: 'sha123',
      branch: 'main',
    });
  });

  it('errors from write methods never contain the token', async () => {
    mockFetch(500);
    const err = await client()
      .putFile('backups/b.json', 'AAAA', 'Backup')
      .catch((e: unknown) => e);
    expect(String(err)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });
});
