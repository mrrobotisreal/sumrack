import { describe, expect, it, vi } from 'vitest';

import { createTranscodeQueue } from '../transcode-queue';

vi.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
vi.mock('@/db', () => ({ repos: {} }));
vi.mock('@/features/pronunciation/opus-encoder', () => ({
  encodeWavToOpus: vi.fn(),
  isOpusUnsupported: (e: unknown) => (e as { code?: string })?.code === 'unsupported',
}));
vi.mock('@/services/error-log', () => ({ logError: vi.fn() }));

/**
 * T63 §10.1: the WAV → OGG queue over a fake filesystem + encoder — success
 * rewrites the row and deletes the WAV; `unsupported` keeps the WAV and
 * stops trying; other failures retry twice then give up; `whenIdle`
 * resolves per run.
 */

function harness(opts: { encode?: (wav: string, out: string) => Promise<void> } = {}) {
  const fs = new Map<string, number>();
  const rows = new Map<string, string>();
  const encode = vi.fn(async (wav: string, out: string) => {
    if (opts.encode) await opts.encode(wav, out);
    fs.set(out, Math.round((fs.get(wav) ?? 0) / 10));
  });
  const onUnsupported = vi.fn();
  const queue = createTranscodeQueue({
    encode: (wav, out) => encode(wav, out),
    isUnsupported: (e) => (e as { code?: string })?.code === 'unsupported',
    setAudioFile: async (id, name) => {
      rows.set(id, name);
    },
    fileExists: (uri) => fs.has(uri),
    fileSize: (uri) => fs.get(uri) ?? 0,
    deleteFile: (uri) => {
      fs.delete(uri);
    },
    filePath: (runId, name) => `${runId}/${name}`,
    onUnsupported,
  });
  return { fs, rows, encode, queue, onUnsupported };
}

describe('transcode queue', () => {
  it('encodes, rewrites the attempt row to .ogg and deletes the WAV', async () => {
    const h = harness();
    h.fs.set('r1/t02-a1.wav', 96_000);
    h.queue.enqueue({ runId: 'r1', attemptId: 'a1', wavName: 't02-a1.wav' });
    expect(h.queue.pendingFor('r1')).toBe(1);
    await h.queue.whenIdle('r1');
    expect(h.rows.get('a1')).toBe('t02-a1.ogg');
    expect(h.fs.has('r1/t02-a1.wav')).toBe(false);
    expect(h.fs.get('r1/t02-a1.ogg')).toBe(9_600);
    expect(h.queue.pendingFor('r1')).toBe(0);
  });

  it('runs one job at a time in order, across runs', async () => {
    const order: string[] = [];
    const h = harness({
      encode: async (wav) => {
        order.push(wav);
        await new Promise((r) => setTimeout(r, 2));
      },
    });
    for (const [run, name] of [
      ['r1', 't00-a1.wav'],
      ['r1', 't01-a1.wav'],
      ['r2', 't00-a1.wav'],
    ] as const) {
      h.fs.set(`${run}/${name}`, 10);
      h.queue.enqueue({ runId: run, attemptId: `${run}-${name}`, wavName: name });
    }
    await Promise.all([h.queue.whenIdle('r1'), h.queue.whenIdle('r2')]);
    expect(order).toEqual(['r1/t00-a1.wav', 'r1/t01-a1.wav', 'r2/t00-a1.wav']);
  });

  it('keeps the WAV on `unsupported`, warns once, and skips the encoder for later jobs', async () => {
    const h = harness({
      encode: async () => {
        throw Object.assign(new Error('no encoder'), { code: 'unsupported' });
      },
    });
    h.fs.set('r1/t00-a1.wav', 10);
    h.fs.set('r1/t01-a1.wav', 10);
    h.queue.enqueue({ runId: 'r1', attemptId: 'a', wavName: 't00-a1.wav' });
    h.queue.enqueue({ runId: 'r1', attemptId: 'b', wavName: 't01-a1.wav' });
    await h.queue.whenIdle('r1');
    expect(h.encode).toHaveBeenCalledTimes(1);
    expect(h.onUnsupported).toHaveBeenCalledTimes(1);
    expect(h.queue.encoderUnsupported).toBe(true);
    expect(h.fs.has('r1/t00-a1.wav')).toBe(true);
    expect(h.fs.has('r1/t01-a1.wav')).toBe(true);
    expect(h.rows.size).toBe(0);
  });

  it('retries a transient failure twice, then keeps the WAV and stops', async () => {
    const h = harness({
      encode: async () => {
        throw new Error('codec busy');
      },
    });
    h.fs.set('r1/t00-a1.wav', 10);
    h.queue.enqueue({ runId: 'r1', attemptId: 'a', wavName: 't00-a1.wav' });
    await h.queue.whenIdle('r1');
    expect(h.encode).toHaveBeenCalledTimes(3);
    expect(h.fs.has('r1/t00-a1.wav')).toBe(true);
    expect(h.fs.has('r1/t00-a1.ogg')).toBe(false);
    expect(h.rows.size).toBe(0);
    expect(h.queue.encoderUnsupported).toBe(false);
  });

  it('a missing WAV is a no-op (the row keeps whatever it had)', async () => {
    const h = harness();
    h.queue.enqueue({ runId: 'r1', attemptId: 'a', wavName: 't00-a1.wav' });
    await h.queue.whenIdle('r1');
    expect(h.encode).not.toHaveBeenCalled();
    expect(h.rows.size).toBe(0);
  });

  it('whenIdle resolves immediately for a run with nothing queued', async () => {
    const h = harness();
    await expect(h.queue.whenIdle('nope')).resolves.toBeUndefined();
  });
});
