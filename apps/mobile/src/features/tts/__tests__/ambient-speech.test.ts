import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Speech from 'expo-speech';

import { speakWithInfo, stopSpeaking } from '../service';
import { useTtsStore } from '../store';

vi.mock('expo-speech', () => ({ speak: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../../modules/sherpa-speech', () => ({ default: { stop: vi.fn() } }));
vi.mock('@/db', () => ({ repos: {} }));
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));
vi.mock('../manager', () => ({
  isVoiceInstalled: vi.fn(),
  refreshInstalledVoices: vi.fn(),
  voiceModelPaths: vi.fn(),
}));

describe('system speech suppresses study music', () => {
  beforeEach(async () => {
    await stopSpeaking();
    vi.clearAllMocks();
  });

  it('keeps music suppressed when an older utterance finishes', async () => {
    await speakWithInfo('один');
    const first = vi.mocked(Speech.speak).mock.calls[0]![1]!;
    await speakWithInfo('два');
    const second = vi.mocked(Speech.speak).mock.calls[1]![1]!;
    first.onStopped?.();
    expect(useTtsStore.getState().systemSpeaking).toBe(true);
    second.onDone?.();
    expect(useTtsStore.getState().systemSpeaking).toBe(false);
  });

  it('releases music on a speech error or explicit stop', async () => {
    await speakWithInfo('один');
    vi.mocked(Speech.speak).mock.calls[0]![1]!.onError?.(new Error('speech failed'));
    expect(useTtsStore.getState().systemSpeaking).toBe(false);
    await speakWithInfo('два');
    await stopSpeaking();
    expect(useTtsStore.getState().systemSpeaking).toBe(false);
  });

  it('does not let a pending stop unmute a new utterance', async () => {
    let resolve!: () => void;
    vi.mocked(Speech.stop).mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = stopSpeaking();
    await speakWithInfo('три');
    resolve();
    await pending;
    expect(useTtsStore.getState().systemSpeaking).toBe(true);
  });
});
