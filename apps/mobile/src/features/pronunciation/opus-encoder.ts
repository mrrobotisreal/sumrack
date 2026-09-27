import { z } from 'zod';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { track } from '@/services/analytics';

/**
 * WAV → Ogg/Opus over the native transcoder (T59, ADR-0019 decision 7):
 * scenario attempts are recorded as the T12 16 kHz WAV and kept as Opus
 * (~10× smaller). The platform may lack an Opus encoder (design §12
 * "encoder unsupported") — that surfaces as `OpusUnsupportedError` with
 * `code: 'unsupported'` so the caller keeps the WAV instead of failing the
 * attempt. Everything else is a plain error.
 */

export const DEFAULT_OPUS_BITRATE_KBPS = 20;

export const encodeOpusResultSchema = z.strictObject({
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative(),
});
export type EncodeOpusResult = z.infer<typeof encodeOpusResultSchema>;

export class OpusUnsupportedError extends Error {
  readonly code = 'unsupported' as const;
  constructor(message = 'Ogg/Opus encoding is not supported on this device') {
    super(message);
    this.name = 'OpusUnsupportedError';
  }
}

/** The native module's rejection codes that mean "no encoder here". */
const UNSUPPORTED_CODES = new Set(['ERR_OPUS_UNSUPPORTED']);

function nativeCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    return err.code;
  }
  return null;
}

export interface EncodeOpusOptions {
  bitrateKbps?: number;
  /** For the `opus_encode_done` inBytes prop; the WAV size when known. */
  inBytes?: number;
}

/**
 * Transcode `wavPath` to `outPath` (an `.ogg`). Resolves with the Zod-parsed
 * native result; rejects with OpusUnsupportedError (code 'unsupported') or
 * an Error. Never logs paths.
 */
export async function encodeWavToOpus(
  wavPath: string,
  outPath: string,
  opts: EncodeOpusOptions = {},
): Promise<EncodeOpusResult> {
  const bitrateKbps = opts.bitrateKbps ?? DEFAULT_OPUS_BITRATE_KBPS;
  try {
    const raw = await SherpaSpeech.encodeWavToOpus(wavPath, outPath, bitrateKbps);
    const parsed = encodeOpusResultSchema.parse(raw);
    track('opus_encode_done', {
      ms: parsed.ms,
      inBytes: opts.inBytes ?? 0,
      outBytes: parsed.bytes,
      durationMs: parsed.durationMs,
    });
    return parsed;
  } catch (err) {
    const code = nativeCode(err) ?? 'error';
    track('opus_encode_failed', { code: UNSUPPORTED_CODES.has(code) ? 'unsupported' : code });
    if (UNSUPPORTED_CODES.has(code)) {
      throw new OpusUnsupportedError(err instanceof Error ? err.message : undefined);
    }
    throw err instanceof Error ? err : new Error('opus encode failed');
  }
}

export function isOpusUnsupported(err: unknown): err is OpusUnsupportedError {
  return err instanceof OpusUnsupportedError;
}
