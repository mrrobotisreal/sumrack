import { beforeEach, describe, expect, it, vi } from 'vitest';

import SherpaSpeech from '../../../../modules/sherpa-speech';
import { track } from '@/services/analytics';

import {
  DEFAULT_OPUS_BITRATE_KBPS,
  OpusUnsupportedError,
  encodeOpusResultSchema,
  encodeWavToOpus,
  isOpusUnsupported,
} from '../opus-encoder';

vi.mock('../../../../modules/sherpa-speech', () => ({
  default: { encodeWavToOpus: vi.fn() },
}));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

/** T59: the Opus wrapper — Zod at the boundary, the 'unsupported' code, events. */

const native = vi.mocked(SherpaSpeech.encodeWavToOpus);

beforeEach(() => vi.clearAllMocks());

describe('encodeOpusResultSchema', () => {
  it('accepts the native contract and rejects extras / negatives', () => {
    expect(encodeOpusResultSchema.parse({ bytes: 13_000, durationMs: 5_000, ms: 80 })).toEqual({
      bytes: 13_000,
      durationMs: 5_000,
      ms: 80,
    });
    expect(() => encodeOpusResultSchema.parse({ bytes: -1, durationMs: 1, ms: 1 })).toThrow();
    expect(() => encodeOpusResultSchema.parse({ bytes: 1, durationMs: 1, ms: 1, x: 1 })).toThrow();
  });
});

describe('encodeWavToOpus', () => {
  it('passes the default bitrate, parses the result and emits opus_encode_done', async () => {
    native.mockResolvedValueOnce({ bytes: 12_900, durationMs: 5_000, ms: 71 });
    const res = await encodeWavToOpus('file:///a.wav', 'file:///a.ogg', { inBytes: 160_044 });
    expect(native).toHaveBeenCalledWith(
      'file:///a.wav',
      'file:///a.ogg',
      DEFAULT_OPUS_BITRATE_KBPS,
    );
    expect(res).toEqual({ bytes: 12_900, durationMs: 5_000, ms: 71 });
    expect(track).toHaveBeenCalledWith('opus_encode_done', {
      ms: 71,
      inBytes: 160_044,
      outBytes: 12_900,
      durationMs: 5_000,
    });
  });

  it('maps ERR_OPUS_UNSUPPORTED to OpusUnsupportedError (code "unsupported")', async () => {
    const err = Object.assign(new Error('no Opus encoder on this device'), {
      code: 'ERR_OPUS_UNSUPPORTED',
    });
    native.mockRejectedValueOnce(err);
    const thrown = await encodeWavToOpus('a', 'b').catch((e: unknown) => e);
    expect(isOpusUnsupported(thrown)).toBe(true);
    expect((thrown as OpusUnsupportedError).code).toBe('unsupported');
    expect(track).toHaveBeenCalledWith('opus_encode_failed', { code: 'unsupported' });
  });

  it('rethrows other native errors with their code in the event', async () => {
    native.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ERR_OPUS_ENCODE' }));
    await expect(encodeWavToOpus('a', 'b', { bitrateKbps: 24 })).rejects.toThrow('boom');
    expect(native).toHaveBeenCalledWith('a', 'b', 24);
    expect(track).toHaveBeenCalledWith('opus_encode_failed', { code: 'ERR_OPUS_ENCODE' });
  });

  it('rejects a malformed native result (Zod boundary)', async () => {
    native.mockResolvedValueOnce({ bytes: 'lots' } as never);
    await expect(encodeWavToOpus('a', 'b')).rejects.toThrow();
  });
});
