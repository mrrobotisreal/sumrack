import * as Haptics from 'expo-haptics';

import { logError } from '@/services/error-log';

/**
 * Haptics (T62, SPEAKING_SCENARIOS §9.3): the thin wrapper over
 * `expo-haptics` (the one new M17 dependency) so screens call named moments,
 * tests can stub one module, and a device without a vibrator is a no-op.
 * Light on arm · medium on endpoint · success on `matched` · a soft
 * double-tick on a miss · selection tick on «Начать».
 */

let enabled = true;

/** Tests / future «lowPower» pref: silence every haptic. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function fire(run: () => Promise<void>): void {
  if (!enabled) return;
  run().catch((err) => logError('manual', err));
}

export const haptics = {
  /** The mic armed (recording started). */
  arm: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Endpointing stopped the recording (silence / cap / manual / hold end). */
  endpoint: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** The judge accepted the answer. */
  matched: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** A miss: two soft ticks ~90 ms apart. */
  miss: () =>
    fire(async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      await new Promise((r) => setTimeout(r, 90));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    }),
  /** «Начать» and other deliberate taps. */
  select: () => fire(() => Haptics.selectionAsync()),
};
