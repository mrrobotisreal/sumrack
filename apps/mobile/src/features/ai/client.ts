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
}

export interface ChatDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  getApiKey: () => Promise<string | null>;
  getModel: () => Promise<string>;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 90_000;

export interface ChatResult {
  /** The assistant message text. */
  content: string;
  /** The model that actually served the request (OpenRouter echoes it). */
  model: string;
}

export async function chatCompletion(req: ChatRequest, deps: ChatDeps): Promise<ChatResult> {
  const key = await deps.getApiKey();
  if (!key) throw new AiError('no-key', 'no OpenRouter key configured');
  const model = await deps.getModel();

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
      body: JSON.stringify({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
      }),
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

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AiError('invalid-response', 'response was not JSON');
  }
  const parsed = OpenRouterResponseSchema.safeParse(body);
  if (!parsed.success) throw new AiError('invalid-response', 'unexpected response shape');
  const content = parsed.data.choices[0]?.message.content;
  if (!content?.trim()) throw new AiError('invalid-response', 'empty completion');
  return { content, model: parsed.data.model ?? model };
}
