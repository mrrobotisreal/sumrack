import { z } from 'zod';
import { SyncError } from './errors';

const GithubDirEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number().int().nonnegative().catch(0),
  type: z.string().catch('file'),
});
const GithubDirListingSchema = z.array(GithubDirEntrySchema);

/**
 * Minimal GitHub contents-API client (design §3.3: "the app reads via the
 * GitHub REST API (raw content + manifest) using a fine-grained PAT").
 * T07 built the read path (content sync); T20 added directory listing,
 * upload, and delete for the `backups/` target — same repo, same PAT (which
 * therefore needs read-write Contents permission once backups are enabled).
 *
 * SECURITY: the token is held in memory only for the duration of a request
 * and must never appear in logs, errors, analytics, or thrown values —
 * errors carry repo path + HTTP status only.
 */
export interface GithubRepoConfig {
  owner: string;
  repo: string;
  /** Defaults to the repo's default branch when omitted. */
  branch?: string;
}

export interface GithubDirEntry {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: string;
}

const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 60_000;

export class GithubContentClient {
  private readonly config: GithubRepoConfig;
  private readonly token: string;

  constructor(config: GithubRepoConfig, token: string) {
    this.config = config;
    this.token = token;
  }

  private contentsUrl(path: string, withRef: boolean): string {
    const { owner, repo, branch } = this.config;
    const ref = withRef && branch ? `?ref=${encodeURIComponent(branch)}` : '';
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}${ref}`;
  }

  /** Shared fetch with timeout + PAT-free typed error mapping. */
  private async request(
    url: string,
    path: string,
    init: { method: string; accept: string; body?: string },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: init.accept,
          'X-GitHub-Api-Version': API_VERSION,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
        signal: controller.signal,
      });
    } catch {
      // Fetch rejections (DNS, timeout, TLS) never carry the request headers,
      // but rethrow a clean typed error anyway rather than the raw cause.
      throw new SyncError('network', `network failure for ${path}`, { path });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      if (res.status === 401) {
        throw new SyncError('auth', 'GitHub rejected the token', { path, status: 401 });
      }
      if (res.status === 404) {
        // Fine-grained PATs without access also produce 404 for private repos.
        throw new SyncError(
          'not-found',
          `${path} not found in ${this.config.owner}/${this.config.repo}`,
          { path, status: 404 },
        );
      }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        if (remaining === '0' || res.status === 429) {
          throw new SyncError('rate-limited', 'GitHub rate limit exceeded', {
            path,
            status: res.status,
          });
        }
        throw new SyncError('auth', 'GitHub denied access (403)', { path, status: 403 });
      }
      throw new SyncError('http', `GitHub returned ${res.status} for ${path}`, {
        path,
        status: res.status,
      });
    }
    return res;
  }

  /**
   * Fetch one file's raw bytes via the contents API. The raw media type
   * serves files up to ~100 MB — far beyond the ~25 MB per-pack budget
   * (design §3.3), so no LFS/Releases handling is needed here.
   */
  async fetchRawFile(path: string): Promise<Uint8Array> {
    const res = await this.request(this.contentsUrl(path, true), path, {
      method: 'GET',
      accept: 'application/vnd.github.raw+json',
    });
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * List a directory (T20: `backups/`). A missing directory is an empty
   * list, not an error — the first backup ever creates it.
   */
  async listDirectory(path: string): Promise<GithubDirEntry[]> {
    let res: Response;
    try {
      res = await this.request(this.contentsUrl(path, true), path, {
        method: 'GET',
        accept: 'application/vnd.github+json',
      });
    } catch (err) {
      if (err instanceof SyncError && err.code === 'not-found') return [];
      throw err;
    }
    const json = (await res.json()) as unknown;
    // T22: Zod at the boundary (every other network response in the app is
    // schema-parsed; this one silently coerced — a malformed entry could
    // feed a garbage sha into backup-retention deleteFile).
    const parsed = GithubDirListingSchema.safeParse(json);
    if (!parsed.success) {
      throw new SyncError('http', `${path} is not a directory listing`, { path });
    }
    return parsed.data;
  }

  /**
   * Create a file (T20 backup upload). Content must already be base64.
   * Deliberately create-only (no update `sha`): backup names are unique per
   * second, so an unexpected collision should fail loudly, not overwrite.
   */
  async putFile(path: string, contentB64: string, message: string): Promise<void> {
    const body: Record<string, string> = { message, content: contentB64 };
    if (this.config.branch) body.branch = this.config.branch;
    await this.request(this.contentsUrl(path, false), path, {
      method: 'PUT',
      accept: 'application/vnd.github+json',
      body: JSON.stringify(body),
    });
  }

  /** Delete a file by its blob sha (T20 retention pruning). */
  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    const body: Record<string, string> = { message, sha };
    if (this.config.branch) body.branch = this.config.branch;
    await this.request(this.contentsUrl(path, false), path, {
      method: 'DELETE',
      accept: 'application/vnd.github+json',
      body: JSON.stringify(body),
    });
  }
}
