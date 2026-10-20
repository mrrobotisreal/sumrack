import { describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '@/features/ai/client';
describe('explicit retelling request cancellation', () => {
  it('does not send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn();
    await expect(
      chatCompletion(
        { messages: [], signal: controller.signal },
        { getApiKey: async () => 'fixture-key', getModel: async () => 'fixture-model', fetchFn },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('forwards cancellation to the one in-flight fetch without retrying', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })),
          );
        }),
    );
    const result = chatCompletion(
      { messages: [], signal: controller.signal },
      { getApiKey: async () => 'fixture-key', getModel: async () => 'fixture-model', fetchFn },
    );
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    controller.abort();
    await assertion;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
