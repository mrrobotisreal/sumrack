import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NodeAudio } from '@sumrak/schema';
import {
  DEFAULT_MODEL_ID,
  isTaggedModel,
  type ElevenLabsClient,
  type VoiceSettings,
} from './elevenlabs.ts';
import type { NarrationText } from './narration.ts';
import { encodeOpus, probeDurationMs } from './opus.ts';
import { mapAlignmentToStamps, type StampResult } from './stamps.ts';

/**
 * The per-line render core shared by dialogues (T26) and scenarios (T57):
 * ONE request for ONE short narration text in ONE voice → character
 * alignment → monotonic word stamps (the ≥95 % gate) → Opus → a
 * `.stamps.json` sidecar next to the MP3. Extracted from `dialogue-audio.ts`
 * with byte-identical behaviour on its recorded fixtures (T57 step 1); the
 * scenario renderer adds v2 steering (`previous_text` + settings deltas) on
 * top of the same spec, nothing else.
 *
 * Requests are serial with a small politeness gap and one retry on
 * rate-limit — a line renderer makes many small calls.
 */

/** What one line render needs from its caller. */
export interface LineRenderSpec {
  /** Provider-prefixed voice, e.g. "elevenlabs:Maxim". */
  voice: string;
  /** The speaking character's id (error messages only). */
  characterId: string;
  /** Exact text + token spans to synthesize (single sentence, or free text with no spans). */
  narration: NarrationText;
  /** Optional Eleven v3 / v4 audio tag(s) prepended to the text on tagged models only (`isTaggedModel`). */
  audioTag?: string;
  /** v2 steering: text "spoken before" the line (never rendered). Ignored on v3 / v4. */
  previousText?: string;
  /** v2 steering: voice settings for this line. */
  voiceSettings?: VoiceSettings;
  /** `language_code` override (the client defaults untagged (v2) requests to ru). */
  languageCode?: string;
}

export interface RenderedLine {
  /** MP3 bytes as returned by the provider. */
  audio: Buffer;
  /** The narration actually sent (tag prefix applied, spans shifted). */
  narration: NarrationText;
  /** Map the provider alignment onto word stamps once the final duration is known. */
  stampResultFor: (durationMs: number) => StampResult;
}

/** Delay between consecutive ElevenLabs requests (politeness, many small calls). */
export const REQUEST_GAP_MS = 400;
/** One retry after this wait when the provider rate-limits a request. */
export const RATE_LIMIT_RETRY_MS = 5_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serial request pacing: `await pacer.next()` before every provider call
 * sleeps {@link REQUEST_GAP_MS} except before the first one.
 */
export class RequestPacer {
  private first = true;
  async next(): Promise<void> {
    if (!this.first) await sleep(REQUEST_GAP_MS);
    this.first = false;
  }
}

/** The provider voice name after the `elevenlabs:` prefix; throws on any other provider. */
export function providerVoiceOf(voice: string, characterId: string): string {
  const voiceName = voice.split(':').slice(1).join(':');
  if (voiceName === '' || !voice.startsWith('elevenlabs:')) {
    throw new Error(
      `character "${characterId}": unsupported voice "${voice}" — only "elevenlabs:<name>" is implemented`,
    );
  }
  return voiceName;
}

/**
 * Render one line. On tagged models (v3 / v4) the audio tag becomes part of
 * the rendered text (every span shifts by the prefix length); on other
 * models the tag is not applied and `previousText` / `voiceSettings` steer
 * instead.
 */
export async function renderLine(
  client: ElevenLabsClient,
  spec: LineRenderSpec,
  seed: number,
  modelId: string | undefined,
): Promise<RenderedLine> {
  const base = spec.narration;
  const model = modelId ?? DEFAULT_MODEL_ID;
  const v3 = isTaggedModel(model);
  const prefix = v3 && spec.audioTag ? `${spec.audioTag} ` : '';
  const narration: NarrationText = prefix
    ? {
        text: prefix + base.text,
        spans: base.spans.map((s) => ({
          ...s,
          start: s.start + prefix.length,
          end: s.end + prefix.length,
        })),
      }
    : base;
  const voiceId = await client.resolveVoiceId(providerVoiceOf(spec.voice, spec.characterId));
  const render = async () =>
    client.renderWithTimestamps({
      voiceId,
      text: narration.text,
      modelId: model,
      seed,
      ...(!v3 && spec.previousText !== undefined && { previousText: spec.previousText }),
      ...(spec.languageCode !== undefined && { languageCode: spec.languageCode }),
      ...(spec.voiceSettings !== undefined && { voiceSettings: spec.voiceSettings }),
    });
  let result;
  try {
    result = await render();
  } catch (e) {
    // One retry on rate limiting — serial small calls occasionally trip 429.
    if (e instanceof Error && /\b429\b/.test(e.message)) {
      await sleep(RATE_LIMIT_RETRY_MS);
      result = await render();
    } else {
      throw e;
    }
  }
  const { audio, alignment } = result;
  return {
    audio,
    narration,
    stampResultFor: (durationMs: number) =>
      alignment
        ? mapAlignmentToStamps(narration, alignment, durationMs)
        : {
            stamps: [],
            trusted: false,
            wordTokens: narration.spans.filter((s) => !s.isPunct).length,
            stampedTokens: 0,
            coverage: 0,
            matchedCharRatio: 0,
            issues: ['provider returned no character alignment'],
          },
  };
}

export interface FinalizedLine {
  durationMs: number;
  opusBytes: number;
  stampResult: StampResult;
  /** `file` + `durationMs` (+ `timestamps` when the alignment was trusted and non-empty). */
  audio: NodeAudio;
}

/**
 * Finalize one rendered line: write the MP3, encode Opus to
 * `<outDir>/<file>`, probe the duration, map stamps, and write the
 * `<mp3>.stamps.json` sidecar (the same WordStamp[] shape a `sentenceAudio`
 * clip carries, so a finalized line can be spliced elsewhere). An untrusted
 * alignment ships NO stamps for that file (sentence-level highlight fallback).
 */
export function finalizeLine(
  rendered: RenderedLine,
  outDir: string,
  file: string,
  mp3File: string,
): FinalizedLine {
  mkdirSync(dirname(mp3File), { recursive: true });
  writeFileSync(mp3File, rendered.audio);
  const opusFile = join(outDir, file);
  mkdirSync(dirname(opusFile), { recursive: true });
  encodeOpus(mp3File, opusFile);
  const durationMs = probeDurationMs(opusFile);
  const stampResult = rendered.stampResultFor(durationMs);
  const audio: NodeAudio = { file, durationMs };
  if (stampResult.trusted && stampResult.stamps.length > 0) {
    audio.timestamps = stampResult.stamps;
  }
  writeFileSync(`${mp3File}.stamps.json`, `${JSON.stringify(stampResult.stamps)}\n`, 'utf8');
  return {
    durationMs,
    opusBytes: readFileSync(opusFile).byteLength,
    stampResult,
    audio,
  };
}
