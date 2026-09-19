import type { CharAlignment } from './stamps.ts';

/**
 * Minimal ElevenLabs client for `pipeline audio` (T09, design §8 step 3).
 *
 * SECURITY: the API key is held in memory only and must never appear in
 * logs, errors, or files. Every error message produced here is scrubbed
 * against the key value as a defensive backstop, and response bodies are
 * truncated before being embedded in errors.
 */

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
/**
 * Eleven v3: the flagship expressive model (74 languages). Verified against
 * this account: supports character timestamps and seed, accepts continuous
 * voice settings, honors leading audio tags like "[whispers]" without
 * speaking them — but rejects previous_text (see isV3Model callers).
 * `eleven_multilingual_v2` remains available via --model for
 * consistency-critical renders.
 */
export const DEFAULT_MODEL_ID = 'eleven_v3';

/** v3-family models differ in accepted params (no previous_text). */
export function isV3Model(modelId: string): boolean {
  return modelId.startsWith('eleven_v3');
}
/**
 * Highest-quality MP3 the with-timestamps endpoint serves on the Creator tier
 * (PCM needs Pro). The Opus the app ships is transcoded from this.
 */
const OUTPUT_FORMAT = 'mp3_44100_192';
const REQUEST_TIMEOUT_MS = 180_000;

export interface VoiceSettings {
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
  useSpeakerBoost?: boolean;
}

export interface RenderRequest {
  voiceId: string;
  text: string;
  modelId?: string;
  /** Deterministic sampling seed — the audition/finalize handshake key. */
  seed?: number;
  /**
   * Text "spoken before" the request, conditioning prosody without being
   * rendered — we feed the draft's stylePrompt through this (multilingual v2
   * has no explicit style-prompt input).
   */
  previousText?: string;
  /** ISO 639-1 language enforcement (`language_code`) for models that accept it. */
  languageCode?: string;
  voiceSettings?: VoiceSettings;
}

export interface RenderResult {
  /** MP3 bytes (44.1kHz / 128kbps). */
  audio: Buffer;
  /** Character-level alignment for the exact input text (may be absent). */
  alignment: CharAlignment | null;
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category?: string;
}

export class ElevenLabsError extends Error {
  constructor(message: string, apiKey: string) {
    // Backstop: no error thrown from this module can carry the key value.
    super(message.split(apiKey).join('«redacted»'));
    this.name = 'ElevenLabsError';
  }
}

interface RawAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

function toCharAlignment(raw: RawAlignment | null | undefined): CharAlignment | null {
  if (!raw) return null;
  return {
    characters: raw.characters,
    startSeconds: raw.character_start_times_seconds,
    endSeconds: raw.character_end_times_seconds,
  };
}

export class ElevenLabsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private voiceCache: ElevenLabsVoice[] | null = null;

  constructor(apiKey: string, opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
    } catch (e) {
      throw new ElevenLabsError(
        `network failure calling ${path}: ${e instanceof Error ? e.message : String(e)}`,
        this.apiKey,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async errorFrom(path: string, res: Response): Promise<ElevenLabsError> {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      /* body unreadable — status alone will do */
    }
    return new ElevenLabsError(`${path} responded ${res.status}: ${detail}`, this.apiKey);
  }

  async listVoices(): Promise<ElevenLabsVoice[]> {
    if (this.voiceCache) return this.voiceCache;
    const path = '/v1/voices';
    const res = await this.request(path, { method: 'GET' });
    if (!res.ok) throw await this.errorFrom(path, res);
    const body = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string }[];
    };
    this.voiceCache = (body.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
    }));
    return this.voiceCache;
  }

  /**
   * Resolve a draft voice name to a voice id. Matches the full name exactly
   * (case-insensitive) or the short alias before the premade voices'
   * " - tagline" suffix ("Callum" → "Callum - Husky Trickster"); a raw
   * 20-character voice id passes through untouched. Ambiguous aliases fail
   * loudly rather than picking one.
   */
  async resolveVoiceId(name: string): Promise<string> {
    if (/^[A-Za-z0-9]{20,}$/.test(name)) return name; // already an id
    const voices = await this.listVoices();
    const wanted = name.toLowerCase();
    const exact = voices.filter((v) => v.name.toLowerCase() === wanted);
    // Library voice names carry taglines after a hyphen, en dash, or em dash
    // ("Kate - Calm…", "Elen Kuragina – Golden & Dangerous").
    const byAlias = exact.length
      ? exact
      : voices.filter(
          (v) =>
            v.name
              .split(/\s+[-–—]\s+/)[0]!
              .trim()
              .toLowerCase() === wanted,
        );
    if (byAlias.length === 1) return byAlias[0]!.voiceId;
    const available = voices.map((v) => v.name).join(', ') || '(none)';
    throw new ElevenLabsError(
      byAlias.length === 0
        ? `no voice named "${name}" in this ElevenLabs account — available: ${available}`
        : `voice name "${name}" is ambiguous (${byAlias.map((v) => v.name).join(' / ')}) — use the full name`,
      this.apiKey,
    );
  }

  /** Render text to speech with character-level timestamps. */
  async renderWithTimestamps(req: RenderRequest): Promise<RenderResult> {
    const path = `/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
    const settings = req.voiceSettings;
    const body: Record<string, unknown> = {
      text: req.text,
      model_id: req.modelId ?? DEFAULT_MODEL_ID,
    };
    if (req.seed !== undefined) body.seed = req.seed;
    if (req.previousText !== undefined) body.previous_text = req.previousText;
    if (req.languageCode !== undefined) body.language_code = req.languageCode;
    if (settings) {
      body.voice_settings = {
        ...(settings.stability !== undefined && { stability: settings.stability }),
        ...(settings.similarityBoost !== undefined && {
          similarity_boost: settings.similarityBoost,
        }),
        ...(settings.style !== undefined && { style: settings.style }),
        ...(settings.speed !== undefined && { speed: settings.speed }),
        ...(settings.useSpeakerBoost !== undefined && {
          use_speaker_boost: settings.useSpeakerBoost,
        }),
      };
    }

    const res = await this.request(path, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw await this.errorFrom(path, res);
    const json = (await res.json()) as {
      audio_base64?: string;
      alignment?: RawAlignment | null;
      normalized_alignment?: RawAlignment | null;
    };
    if (!json.audio_base64) {
      throw new ElevenLabsError(`${path} returned no audio_base64`, this.apiKey);
    }
    return {
      audio: Buffer.from(json.audio_base64, 'base64'),
      // Prefer the un-normalized alignment (it echoes our input text); fall
      // back to the normalized one — the tolerant mapper absorbs the drift.
      alignment: toCharAlignment(json.alignment ?? json.normalized_alignment),
    };
  }
}
