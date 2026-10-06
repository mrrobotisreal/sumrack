import { describe, expect, it } from 'vitest';

import { speakingGateMessage } from '../speaking/gates';

/** T73 (TORFL §12): the speaking subtest refuses to start without the ASR model or with the mic denied. */
describe('speakingGateMessage', () => {
  it('no ASR model → the model reason; mic denied → the mic reason; otherwise null', () => {
    expect(speakingGateMessage({ gate: 'asr-missing', mic: 'granted' })).toContain('модели');
    expect(speakingGateMessage({ gate: 'mic-denied', mic: 'denied' })).toContain('Микрофон');
    expect(speakingGateMessage({ gate: null, mic: 'denied' })).toContain('Микрофон');
    expect(speakingGateMessage({ gate: null, mic: 'granted' })).toBeNull();
    // undetermined is not a block: the system dialog comes up on the instruction screen
    expect(speakingGateMessage({ gate: null, mic: 'undetermined' })).toBeNull();
    expect(speakingGateMessage({ gate: null, mic: 'unknown' })).toBeNull();
  });
});
