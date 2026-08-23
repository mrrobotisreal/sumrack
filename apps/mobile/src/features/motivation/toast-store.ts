import { create } from 'zustand';

import type { AchievementDef } from './achievements';

/**
 * Achievement unlock toast queue (T19). unlock paths push; the host
 * (<AchievementToastHost/> in the root layout) shows one at a time with the
 * §5 "reserved bigger moment" treatment and pops when done.
 */
interface ToastState {
  queue: AchievementDef[];
  push: (def: AchievementDef) => void;
  pop: () => void;
}

export const useAchievementToasts = create<ToastState>((set) => ({
  queue: [],
  push: (def) => set((s) => ({ queue: [...s.queue, def] })),
  pop: () => set((s) => ({ queue: s.queue.slice(1) })),
}));
