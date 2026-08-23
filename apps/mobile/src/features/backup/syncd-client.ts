import { z } from 'zod';

import { BackupError } from './errors';
import { parseBackupFileName } from './naming';

/**
 * HTTP client for syncd, the home-server backup service (T21, design §9).
 * The contract is SumrakAPI's three endpoints; every response body is
 * Zod-validated before use. Requests carry the bearer token in memory only —
 * it never appears in errors, logs, or analytics (T07/T20 rule).
 *
 * Reachability is the defining failure mode: the host only exists inside
 * the tailnet, so DNS failures / refusals / timeouts are expected life
 * events ('syncd-unreachable'), never crashes.
 */

/** Tailnet peers answer fast when reachable; fail fast when not. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Normalize what Mitch types into a usable base URL: default the scheme to
 * http:// (plain HTTP inside the tailnet is the deploy contract — Tailscale
 * provides transport encryption) and drop trailing slashes.
 */
export function normalizeSyncdHost(raw: string): string | null {
  let host = raw.trim();
  if (host.length === 0) return null;
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`;
  host = host.replace(/\/+$/, '');
  try {
    const url = new URL(host);
    if (!url.hostname) return null;
  } catch {
    return null;
  }
  return host;
}

const ListedBackupSchema = z.object({
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  timestampMs: z.number().int(),
});
const ListResponseSchema = z.object({
  backups: z.array(ListedBackupSchema),
});
const PutResponseSchema = z.object({
  stored: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  pruned: z.number().int().nonnegative(),
});
export type SyncdPutResult = z.infer<typeof PutResponseSchema>;

export interface SyncdBackupListing {
  name: string;
  size: number;
  /** Snapshot moment parsed from the name (UTC) — the T20 contract. */
  timestamp: number;
}

export class SyncdClient {
  private readonly host: string;
  private readonly token: string;

  constructor(host: string, token: string) {
    this.host = host.replace(/\/+$/, '');
    this.token = token;
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.host}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: controller.signal,
      });
    } catch {
      // DNS failure, connection refused, timeout — the tailnet host is not
      // reachable from here right now. Expected whenever Tailscale is off.
      throw new BackupError('syncd-unreachable', 'home server not reachable');
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      if (res.status === 401) {
        throw new BackupError('syncd', 'the home server rejected the token (401)');
      }
      throw new BackupError('syncd', `home server returned ${res.status} for ${path}`);
    }
    return res;
  }

  private async parse<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new BackupError('syncd', `home server sent malformed JSON for ${what}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new BackupError('syncd', `home server sent an unexpected ${what} response`);
    }
    return parsed.data;
  }

  /** Stored backups, newest first; names that don't parse are dropped. */
  async listBackups(): Promise<SyncdBackupListing[]> {
    const res = await this.request('/backups', { method: 'GET' });
    const { backups } = await this.parse(res, ListResponseSchema, 'listing');
    return backups
      .map((b) => ({ row: b, parsed: parseBackupFileName(b.name) }))
      .filter((x): x is typeof x & { parsed: NonNullable<typeof x.parsed> } => x.parsed !== null)
      .map(({ row, parsed }) => ({ name: row.name, size: row.size, timestamp: parsed.timestamp }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Upload one sealed envelope (create-only server side; server prunes). */
  async putBackup(name: string, envelopeJson: string): Promise<SyncdPutResult> {
    const res = await this.request(`/backup?name=${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: envelopeJson,
    });
    return this.parse(res, PutResponseSchema, 'upload');
  }

  /** Download one backup envelope's text for restore. */
  async fetchBackup(name: string): Promise<string> {
    const res = await this.request(`/backup/${encodeURIComponent(name)}`, { method: 'GET' });
    return res.text();
  }
}
