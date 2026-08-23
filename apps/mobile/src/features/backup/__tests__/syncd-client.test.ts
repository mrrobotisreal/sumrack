import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupError } from '../errors';
import { normalizeSyncdHost, SyncdClient } from '../syncd-client';

/**
 * T21 syncd client: Zod validation of every response, typed unreachable vs.
 * server-error mapping, and the token-never-leaks rule. fetch is mocked —
 * the live contract is exercised against the real Go service on-device.
 */

const TOKEN = 'secret-bearer-token-0123456789abcdef';
const HOST = 'http://homeserver:8787';

function mockFetchOnce(response: Partial<Response> & { jsonBody?: unknown; textBody?: string }) {
  const { jsonBody, textBody, ...rest } = response;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      jsonBody !== undefined ? Promise.resolve(jsonBody) : Promise.reject(new Error('no json')),
    text: () => Promise.resolve(textBody ?? ''),
    ...rest,
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeSyncdHost', () => {
  it('defaults the scheme and strips trailing slashes', () => {
    expect(normalizeSyncdHost('homeserver:8787')).toBe('http://homeserver:8787');
    expect(normalizeSyncdHost('http://homeserver:8787///')).toBe('http://homeserver:8787');
    expect(normalizeSyncdHost('  https://100.64.0.7:8787/ ')).toBe('https://100.64.0.7:8787');
  });

  it('rejects empty and unparseable input', () => {
    expect(normalizeSyncdHost('')).toBeNull();
    expect(normalizeSyncdHost('   ')).toBeNull();
    expect(normalizeSyncdHost('http://')).toBeNull();
  });
});

describe('SyncdClient.listBackups', () => {
  it('parses, filters unparseable names, and sorts newest first', async () => {
    mockFetchOnce({
      jsonBody: {
        backups: [
          { name: 'sumrak-backup-20260822-030000Z.json', size: 100, timestampMs: 1 },
          { name: 'stranger.json', size: 5, timestampMs: 2 },
          { name: 'sumrak-backup-20260823-030000Z.json', size: 200, timestampMs: 3 },
        ],
      },
    });
    const list = await new SyncdClient(HOST, TOKEN).listBackups();
    expect(list.map((b) => b.name)).toEqual([
      'sumrak-backup-20260823-030000Z.json',
      'sumrak-backup-20260822-030000Z.json',
    ]);
    // Timestamps come from the NAME (the T20 contract), not the server row.
    expect(list[0]!.timestamp).toBe(Date.UTC(2026, 7, 23, 3, 0, 0));
  });

  it('sends the bearer token in the Authorization header only', async () => {
    const fetchMock = mockFetchOnce({ jsonBody: { backups: [] } });
    await new SyncdClient(`${HOST}/`, TOKEN).listBackups();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${HOST}/backups`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('rejects a malformed response body with a typed error, token-free', async () => {
    mockFetchOnce({ jsonBody: { backups: [{ nope: true }] } });
    const err = await new SyncdClient(HOST, TOKEN).listBackups().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).code).toBe('syncd');
    expect((err as BackupError).message).not.toContain(TOKEN);
  });

  it('maps network failures to syncd-unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    const err = await new SyncdClient(HOST, TOKEN).listBackups().catch((e: unknown) => e);
    expect((err as BackupError).code).toBe('syncd-unreachable');
    expect((err as BackupError).message).not.toContain(TOKEN);
  });

  it('maps a 401 to a syncd error naming the token problem, value-free', async () => {
    mockFetchOnce({ ok: false, status: 401 });
    const err = await new SyncdClient(HOST, TOKEN).listBackups().catch((e: unknown) => e);
    expect((err as BackupError).code).toBe('syncd');
    expect((err as BackupError).message).toContain('401');
    expect((err as BackupError).message).not.toContain(TOKEN);
  });
});

describe('SyncdClient.putBackup', () => {
  it('PUTs the envelope verbatim and returns the validated result', async () => {
    const fetchMock = mockFetchOnce({
      jsonBody: { stored: 'sumrak-backup-20260823-030000Z.json', bytes: 12, pruned: 3 },
    });
    const result = await new SyncdClient(HOST, TOKEN).putBackup(
      'sumrak-backup-20260823-030000Z.json',
      '{"sealed":1}',
    );
    expect(result.pruned).toBe(3);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${HOST}/backup?name=sumrak-backup-20260823-030000Z.json`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"sealed":1}');
  });

  it('surfaces non-2xx statuses as typed syncd errors', async () => {
    mockFetchOnce({ ok: false, status: 409 });
    const err = await new SyncdClient(HOST, TOKEN)
      .putBackup('sumrak-backup-20260823-030000Z.json', '{}')
      .catch((e: unknown) => e);
    expect((err as BackupError).code).toBe('syncd');
    expect((err as BackupError).message).toContain('409');
  });
});

describe('SyncdClient.fetchBackup', () => {
  it('returns the archive text verbatim', async () => {
    mockFetchOnce({ textBody: '{"v":1,"cipher":{}}' });
    const text = await new SyncdClient(HOST, TOKEN).fetchBackup(
      'sumrak-backup-20260823-030000Z.json',
    );
    expect(text).toBe('{"v":1,"cipher":{}}');
  });
});
