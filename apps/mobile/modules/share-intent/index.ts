import { NativeModule, requireNativeModule } from 'expo';

/**
 * JS binding for the local share-intent Expo module (T28, design V2 §4.1).
 * Import this ONLY from device code paths — requiring it in Node (vitest)
 * throws (T11 convention). The payload is untrusted input: callers must
 * Zod-validate + NFC-normalize before doing anything with the text.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo's EventsMap constraint requires an any[] index signature (T11 precedent)
export type ShareIntentModuleEvents = Record<string, (...args: any[]) => void> & {
  /** Warm-start share delivery (activity relaunched over a running app). */
  onShareReceived: (payload: { text: string }) => void;
};

declare class ShareIntentNativeModule extends NativeModule<ShareIntentModuleEvents> {
  /**
   * One-shot: the stashed warm-start text if any, else (once) the text of
   * the activity's launch intent, else null. Never re-delivers.
   */
  consumePendingShare(): string | null;
}

export default requireNativeModule<ShareIntentNativeModule>('ShareIntent');
