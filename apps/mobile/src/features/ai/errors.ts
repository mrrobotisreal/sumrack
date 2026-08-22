/**
 * AI error taxonomy (T16). Mirrors the T07 SyncError approach: a typed
 * code drives retry/UX decisions, `friendlyAiMessage` renders the
 * plain-language line the user sees. Messages and error payloads must
 * NEVER contain the OpenRouter key or the request body (secrets rule).
 */
export type AiErrorCode =
  | 'no-key' // no OpenRouter key configured — settings problem, not retriable
  | 'offline' // no connectivity — request stays queued
  | 'timeout' // request hit the client-side deadline — retriable
  | 'http-auth' // 401/403 — key invalid/revoked, not retriable until re-entered
  | 'http-rate' // 429 — retriable after backoff
  | 'http-client' // other 4xx — a bug in our request, not retriable
  | 'http-server' // 5xx — provider hiccup, retriable
  | 'invalid-response' // model output failed JSON parse / Zod — retriable once
  | 'network' // fetch threw (DNS, socket reset) — retriable
  | 'unknown';

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** HTTP status when the code came from a response. */
  readonly status?: number;

  constructor(code: AiErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
  }
}

/** Transient failures worth an automatic retry (backoff) or auto-resubmit. */
export function isRetriable(err: unknown): boolean {
  if (!(err instanceof AiError)) return false;
  return (
    err.code === 'offline' ||
    err.code === 'timeout' ||
    err.code === 'http-rate' ||
    err.code === 'http-server' ||
    err.code === 'invalid-response' ||
    err.code === 'network'
  );
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new AiError('timeout', 'The request timed out.');
    // RN fetch network failures: TypeError on web/Node, but a plain Error
    // with this message under Hermes/whatwg-fetch (observed on the S24U).
    if (err.name === 'TypeError' || /network request failed/i.test(err.message)) {
      return new AiError('network', 'Network request failed.');
    }
    return new AiError('unknown', err.message);
  }
  return new AiError('unknown', 'Something went wrong.');
}

export function fromHttpStatus(status: number): AiError {
  if (status === 401 || status === 403)
    return new AiError('http-auth', 'OpenRouter rejected the API key.', status);
  if (status === 429) return new AiError('http-rate', 'Rate limited — will retry.', status);
  if (status >= 500) return new AiError('http-server', `OpenRouter error (${status}).`, status);
  return new AiError('http-client', `Request rejected (${status}).`, status);
}

/** Plain-language, secret-free message for banners/cards. */
export function friendlyAiMessage(err: unknown): string {
  const e = toAiError(err);
  switch (e.code) {
    case 'no-key':
      return 'No OpenRouter API key — add one in Settings → AI.';
    case 'offline':
      return 'Offline — will send when you reconnect.';
    case 'timeout':
      return 'The request timed out. Tap to retry.';
    case 'http-auth':
      return 'The API key was rejected — check it in Settings → AI.';
    case 'http-rate':
      return 'Rate limited by OpenRouter. Try again in a minute.';
    case 'http-client':
      return 'The request was rejected. If this keeps happening, check the model in Settings → AI.';
    case 'http-server':
      return 'OpenRouter had a hiccup. Tap to retry.';
    case 'invalid-response':
      return 'The model returned something unreadable. Tap to retry.';
    case 'network':
      return 'Network trouble. Tap to retry.';
    default:
      return 'Something went wrong. Tap to retry.';
  }
}
