import { describe, expect, it, vi } from 'vitest';
import { copyCapturedTake } from '../capture-take';

describe('native capture cache copy', () => {
  it('normalizes the native absolute path and exposes a take only after its copy finishes', async () => {
    let finish!: () => void;
    const copying = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const copy = vi.fn(() => copying);
    let published = false;
    const pending = copyCapturedTake(
      { path: '/data/user/0/io.winapps.sumrak/cache/pron-attempt.wav', durationMs: 2400 },
      'file:///cache/listening-lab-test.wav',
      copy,
    ).then((take) => {
      published = true;
      return take;
    });
    await Promise.resolve();
    expect(published).toBe(false);
    expect(copy).toHaveBeenCalledWith(
      'file:///data/user/0/io.winapps.sumrak/cache/pron-attempt.wav',
      'file:///cache/listening-lab-test.wav',
    );
    finish();
    expect(await pending).toEqual({
      path: 'file:///cache/listening-lab-test.wav',
      durationMs: 2400,
    });
  });

  it('preserves an existing file URI and propagates copy failure instead of exposing missing audio', async () => {
    const error = new Error('copy failed');
    const copying = Promise.reject(error);
    // Observe the native rejection even when running against the old unawaited implementation.
    void copying.catch(() => {});
    const copy = vi.fn(() => copying);
    await expect(
      copyCapturedTake(
        { path: 'file:///cache/pron-attempt.wav', durationMs: 2400 },
        'file:///cache/retained-source.wav',
        copy,
      ),
    ).rejects.toThrow('copy failed');
    expect(copy).toHaveBeenCalledWith(
      'file:///cache/pron-attempt.wav',
      'file:///cache/retained-source.wav',
    );
  });
});
