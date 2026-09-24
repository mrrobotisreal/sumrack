import { AiError, fromHttpStatus, toAiError } from './errors';
import { OpenRouterErrorSchema, OpenRouterResponseSchema } from './schemas';

/**
 * The OpenRouter client (T16): one focused function that turns messages
 * into the assistant's text. No UI coupling, no feature knowledge — the
 * journal/enrichment/explain layers (and T18's assessment) build on this.
 *
 * Secrets discipline: the API key exists only inside `send` as a local —
 * it is never logged, never attached to errors, never in analytics props.
 * Error paths surface status codes and friendly text only; the request
 * body is likewise never dumped (it contains Mitch's journal writing).
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Overrides `deps.getModel()` when present (T51 run profile; legacy features omit it). */
  model?: string;
  /**
   * Extra top-level OpenRouter body fields (T51: `verbosity`, `reasoning`,
   * `usage`). Merged after the standard fields and filtered so they can
   * never override `messages` / `model` / `max_tokens` / `temperature`.
   */
  extras?: Record<string, unknown>;
}

export interface ChatDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  getApiKey: () => Promise<string | null>;
  getModel: () => Promise<string>;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 90_000;

/** Token counts + cost from OpenRouter usage accounting (only with `usage.include`). */
export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export interface ChatResult {
  /** The assistant message text. */
  content: string;
  /** The model that actually served the request (OpenRouter echoes it). */
  model: string;
  /** Present when the response carried a `usage` block (T51). */
  usage?: ChatUsage;
  /** OpenRouter's `finish_reason` for the first choice, when given (T51). */
  finishReason?: string;
}

/** Body keys the request builder owns — `extras` may never shadow them. */
const RESERVED_BODY_KEYS = new Set(['model', 'messages', 'max_tokens', 'temperature']);

/** Pure: the JSON body for a request (exported for the decision-6 / extras tests). */
export function buildRequestBody(req: ChatRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.3,
  };
  for (const [key, value] of Object.entries(req.extras ?? {})) {
    if (!RESERVED_BODY_KEYS.has(key)) body[key] = value;
  }
  return body;
}

/**
 * `__DEV__`-only wire check for the run-profile extras (T51 acceptance):
 * logs the body with `messages` REDACTED (journal text, prompts) and never
 * touches headers (the key lives only in the Authorization header). Off by
 * default even in dev builds — the «Grammar & word forms» section exposes a
 * dev-only switch that flips it for one session; a no-op in release builds.
 */
let aiWireLog = false;
export function setAiWireLog(on: boolean): void {
  aiWireLog = on;
}
export function isAiWireLogOn(): boolean {
  return aiWireLog;
}
function logRequestBody(body: Record<string, unknown>): void {
  if (!aiWireLog || typeof __DEV__ === 'undefined' || !__DEV__) return;
  const { messages, ...rest } = body;
  const count = Array.isArray(messages) ? messages.length : 0;
  console.log('[ai] request body', JSON.stringify({ ...rest, messages: `<${count} redacted>` }));
}

export async function chatCompletion(req: ChatRequest, deps: ChatDeps): Promise<ChatResult> {
  const key = await deps.getApiKey();
  if (!key) throw new AiError('no-key', 'no OpenRouter key configured');
  const model = req.model ?? (await deps.getModel());
  const body = buildRequestBody(req, model);
  logRequestBody(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const fetchFn = deps.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw toAiError(err);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Body may carry a useful provider message — status-derived code wins,
    // provider text only refines the message (never echoed anywhere else).
    const base = fromHttpStatus(response.status);
    const detail = await response
      .json()
      .then((body) => OpenRouterErrorSchema.safeParse(body))
      .then((p) => (p.success ? p.data.error?.message : undefined))
      .catch(() => undefined);
    throw detail ? new AiError(base.code, detail, response.status) : base;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiError('invalid-response', 'response was not JSON');
  }
  const parsed = OpenRouterResponseSchema.safeParse(payload);
  if (!parsed.success) throw new AiError('invalid-response', 'unexpected response shape');
  const choice = parsed.data.choices[0];
  const content = choice?.message.content;
  const finishReason = choice?.finish_reason ?? undefined;
  if (!content?.trim()) {
    // Reasoning ate the whole budget (T51 §4.3): name it, before the generic throw.
    if (finishReason === 'length') {
      throw new AiError(
        'invalid-response',
        'the model ran out of room — reasoning consumed the token budget',
      );
    }
    throw new AiError('invalid-response', 'empty completion');
  }
  const usage = parsed.data.usage;
  return {
    content,
    model: parsed.data.model ?? model,
    finishReason,
    usage: usage
      ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
          costUsd: usage.cost,
        }
      : undefined,
  };
}
