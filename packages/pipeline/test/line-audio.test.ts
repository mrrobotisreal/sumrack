import { describe, expect, it } from 'vitest';
import { ElevenLabsClient, isTaggedModel } from '../src/elevenlabs.ts';
import { renderLine, type LineRenderSpec } from '../src/line-audio.ts';

/**
 * T64 — the tagged-model gate and the request body per model family. The
 * v4 rows mirror the 2026-09-28 account probe (Stories/_build/_v4-probe/
 * verdict.json): v4 renders tags, and the pipeline sends it the v3 shape
 * (no previous_text, no language_code, no default speaker boost).
 */

const VOICE_ID = 'v'.repeat(20);
const MP3 = Buffer.from('ID3fake');

interface Captured {
  text: string;
  model_id: string;
  seed?: number;
  previous_text?: string;
  language_code?: string;
  voice_settings?: Record<string, unknown>;
}

function fakeFetch(captured: Captured[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v1/voices')) {
      return Response.json({ voices: [{ voice_id: VOICE_ID, name: 'Anton' }] });
    }
    const body = JSON.parse(String(init!.body)) as Captured;
    captured.push(body);
    const characters = Array.from(body.text);
    return Response.json({
      audio_base64: MP3.toString('base64'),
      alignment: {
        characters,
        character_start_times_seconds: characters.map((_, i) => i * 0.06),
        character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.06),
      },
    });
  }) as typeof fetch;
}

const SPEC: LineRenderSpec = {
  voice: 'elevenlabs:Anton',
  characterId: 'host',
  narration: {
    text: 'Так. Слушаю вас.',
    spans: [
      { sentenceId: 's1', tokenIndex: 0, start: 0, end: 3, isPunct: false },
      { sentenceId: 's1', tokenIndex: 1, start: 3, end: 4, isPunct: true },
      { sentenceId: 's1', tokenIndex: 2, start: 5, end: 11, isPunct: false },
      { sentenceId: 's1', tokenIndex: 3, start: 12, end: 15, isPunct: false },
      { sentenceId: 's1', tokenIndex: 4, start: 15, end: 16, isPunct: true },
    ],
  },
  audioTag: '[serious, commanding]',
  previousText: 'Ночь. Дежурная часть.',
  voiceSettings: { stability: 0.4 },
};

describe('isTaggedModel', () => {
  it.each([
    ['eleven_v3', true],
    ['eleven_v3_alpha', true],
    ['eleven_v4', true],
    ['eleven_multilingual_v2', false],
    ['eleven_turbo_v2_5', false],
    ['eleven_flash_v2_5', false],
  ])('%s → %s', (model, tagged) => {
    expect(isTaggedModel(model)).toBe(tagged);
  });

  it('refuses eleven_v4_turbo (realtime — not for rendering)', () => {
    expect(() => isTaggedModel('eleven_v4_turbo')).toThrow(/realtime model/);
  });
});

describe('renderLine request body per model family', () => {
  async function render(modelId: string) {
    const captured: Captured[] = [];
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(captured) });
    const rendered = await renderLine(client, SPEC, 7, modelId);
    return { req: captured[0]!, rendered };
  }

  it('eleven_v4: tag prefixed, spans shifted, no previous_text / language_code / boost default', async () => {
    const { req, rendered } = await render('eleven_v4');
    expect(req.model_id).toBe('eleven_v4');
    expect(req.text).toBe('[serious, commanding] Так. Слушаю вас.');
    expect(req.seed).toBe(7);
    expect(req.previous_text).toBeUndefined();
    expect(req.language_code).toBeUndefined();
    expect(req.voice_settings).toEqual({ stability: 0.4 });
    // Every span moved by the prefix length; the tag's own characters are never a token.
    const shift = '[serious, commanding] '.length;
    expect(rendered.narration.spans[0]).toMatchObject({ start: shift, end: shift + 3 });
    expect(rendered.narration.text.slice(shift)).toBe(SPEC.narration.text);
    const stamps = rendered.stampResultFor(3_000);
    expect(stamps.trusted).toBe(true);
    expect(stamps.stampedTokens).toBe(3);
  });

  it('eleven_v3: identical shape to v4 (the tagged branch)', async () => {
    const { req } = await render('eleven_v3');
    expect(req.text).toBe('[serious, commanding] Так. Слушаю вас.');
    expect(req.previous_text).toBeUndefined();
    expect(req.language_code).toBeUndefined();
    expect(req.voice_settings).toEqual({ stability: 0.4 });
  });

  it('eleven_multilingual_v2: no tag, previous_text sent, language_code ru, boost defaults on', async () => {
    const { req, rendered } = await render('eleven_multilingual_v2');
    expect(req.text).toBe('Так. Слушаю вас.');
    expect(req.previous_text).toBe('Ночь. Дежурная часть.');
    expect(req.language_code).toBe('ru');
    expect(req.voice_settings).toEqual({ stability: 0.4, use_speaker_boost: true });
    expect(rendered.narration).toBe(SPEC.narration);
  });

  it('eleven_v4_turbo is refused before any request is made', async () => {
    const captured: Captured[] = [];
    const client = new ElevenLabsClient('test-key', { fetchImpl: fakeFetch(captured) });
    await expect(renderLine(client, SPEC, 7, 'eleven_v4_turbo')).rejects.toThrow(/eleven_v4_turbo/);
    expect(captured).toHaveLength(0);
  });
});
