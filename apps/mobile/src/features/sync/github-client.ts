import { SyncError } from './errors';

/**
 * Minimal GitHub raw-content client (design §3.3: "the app reads via the
 * GitHub REST API (raw content + manifest) using a fine-grained PAT").
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

const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 60_000;

export class GithubContentClient {
  private readonly config: GithubRepoConfig;
  private readonly token: string;

  constructor(config: GithubRepoConfig, token: string) {
    this.config = config;
    this.token = token;
  }

  /**
   * Fetch one file's raw bytes via the contents API. The raw media type
   * serves files up to ~100 MB — far beyond the ~25 MB per-pack budget
   * (design §3.3), so no LFS/Releases handling is needed here.
   */
  async fetchRawFile(path: string): Promise<Uint8Array> {
    const { owner, repo, branch } = this.config;
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}${ref}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': API_VERSION,
        },
        signal: controller.signal,
      });
    } catch {
      // Fetch rejections (DNS, timeout, TLS) never carry the request headers,
      // but rethrow a clean typed error anyway rather than the raw cause.
      throw new SyncError('network', `network failure fetching ${path}`, { path });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      if (res.status === 401) {
        throw new SyncError('auth', 'GitHub rejected the token', { path, status: 401 });
      }
      if (res.status === 404) {
        // Fine-grained PATs without access also produce 404 for private repos.
        throw new SyncError('not-found', `${path} not found in ${owner}/${repo}`, {
          path,
          status: 404,
        });
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

    return new Uint8Array(await res.arrayBuffer());
  }
}
