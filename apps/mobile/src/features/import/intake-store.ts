import { create } from 'zustand';

/**
 * Ephemeral hand-off between the share-intent gate and the intake screen
 * (T28). Share payloads can be far larger than a route param comfortably
 * carries, so the gate stashes the normalized text here and navigates;
 * the screen consumes it on mount. Never persisted — a share that was
 * never saved is gone on restart by design (the durable record is the
 * import request the user explicitly saves).
 */
interface ImportIntakeState {
  sharedText: string | null;
  setSharedText: (text: string | null) => void;
}

export const useImportIntakeStore = create<ImportIntakeState>((set) => ({
  sharedText: null,
  setSharedText: (sharedText) => set({ sharedText }),
}));
