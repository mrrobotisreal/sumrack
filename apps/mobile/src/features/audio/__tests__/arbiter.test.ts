import { describe, expect, it, vi } from 'vitest';

import { claim, pauseAll, registerOwner } from '../arbiter';

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
  it('a learning capture can pause all registered owners without claiming or replacing either', () => {
    const listen = vi.fn(),
      narration = vi.fn();
    const offListen = registerOwner('listen', listen);
    const offNarration = registerOwner('narration', narration);
    pauseAll();
    expect(listen).toHaveBeenCalledOnce();
    expect(narration).toHaveBeenCalledOnce();
    claim('listen');
    expect(listen).toHaveBeenCalledOnce();
    expect(narration).toHaveBeenCalledTimes(2);
    offListen();
    offNarration();
    pauseAll();
    expect(listen).toHaveBeenCalledOnce();
  });
  it('unregistered owners are not paused', () => {
    const pause = vi.fn();
    registerOwner('narration', pause)();
    claim('listen');
    expect(pause).not.toHaveBeenCalled();
  });
});
