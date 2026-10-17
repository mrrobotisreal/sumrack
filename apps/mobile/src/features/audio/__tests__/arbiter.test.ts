import { describe, expect, it, vi } from 'vitest';

import { claim, registerOwner } from '../arbiter';

describe('audio arbiter', () => {
  it('claiming listen pauses narration and vice versa, never the claimer', () => {
    const pauseListen = vi.fn();
    const pauseNarration = vi.fn();
    const off1 = registerOwner('listen', pauseListen);
    const off2 = registerOwner('narration', pauseNarration);
    claim('listen');
    expect(pauseNarration).toHaveBeenCalledTimes(1);
    expect(pauseListen).not.toHaveBeenCalled();
    claim('narration');
    expect(pauseListen).toHaveBeenCalledTimes(1);
    expect(pauseNarration).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });
  it('unregistered owners are not paused', () => {
    const pause = vi.fn();
    registerOwner('narration', pause)();
    claim('listen');
    expect(pause).not.toHaveBeenCalled();
  });
});
