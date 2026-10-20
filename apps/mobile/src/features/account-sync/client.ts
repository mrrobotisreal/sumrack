import { DEFAULT_SYNC_URL } from './config';
import {
  SyncHttpError,
  type SyncClient,
  type WireDeviceRequest,
  type WireMe,
  type WirePullResponse,
  type WirePushRequest,
  type WirePushResponse,
} from './wire';

/**
 * fetch wrapper for the four T103 endpoints. JSON both ways; the server may
 * gzip responses (the native stack inflates them transparently). Request gzip
 * is skipped on purpose: it would need a compression dep, and push bodies are
 * capped well under the server limit already (see engine.collectPush).
 */
export type TokenProvider = (forceRefresh: boolean) => Promise<string | null>;

export interface HttpClientOptions {
  baseUrl: string;
  token: TokenProvider;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function normalizeBaseUrl(url: string | null | undefined): string {
  const u = (url ?? '').trim().replace(/\/+$/, '');
  return u || DEFAULT_SYNC_URL;
}

export function isValidBaseUrl(url: string): boolean {
  return /^https?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/i.test(url.trim());
}

export class HttpSyncClient implements SyncClient {
  private readonly base: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpClientOptions) {
    this.base = normalizeBaseUrl(opts.baseUrl);
    this.timeout = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<T> {
    const token = await this.opts.token(false);
    if (!token) throw new SyncHttpError(401, 'not signed in');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeout);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SyncHttpError(0, e instanceof Error ? e.message : 'network');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 && retry) {
      // One forced token refresh, then a single retry; a second 401 is final.
      const fresh = await this.opts.token(true);
      if (fresh && fresh !== token) {
        return this.callWith<T>(method, path, body, fresh);
      }
    }
    return this.parse<T>(res);
  }

  private async callWith<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    token: string,
  ): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return await this.parse<T>(res);
    } catch (e) {
      if (e instanceof SyncHttpError) throw e;
      throw new SyncHttpError(0, e instanceof Error ? e.message : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  private async parse<T>(res: Response): Promise<T> {
    if (res.ok) return (await res.json()) as T;
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      // keep the status text
    }
    throw new SyncHttpError(res.status, msg);
  }

  registerDevice(req: WireDeviceRequest): Promise<WireMe> {
    return this.call('POST', '/v1/devices', req);
  }
  me(): Promise<WireMe> {
    return this.call('GET', '/v1/me');
  }
  push(req: WirePushRequest): Promise<WirePushResponse> {
    return this.call('POST', '/v1/sync/push', req);
  }
  pull(since: number, limit: number): Promise<WirePullResponse> {
    return this.call('GET', `/v1/sync/pull?since=${since}&limit=${limit}`);
  }
}
