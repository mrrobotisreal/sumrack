import { NativeModule, requireNativeModule } from 'expo';

/**
 * JS binding for the local sumrak-widget Expo module (T40). Import ONLY from
 * device code (requiring it in Node throws). Prefer the optional lookup in
 * `src/features/motivation/widget-sync.ts`, which no-ops on dev clients built
 * before this module existed.
 */
declare class SumrakWidgetNativeModule extends NativeModule {
  /** Writes the snapshot JSON (commit + widget refresh). Empty string = clear → Missing. */
  writeSnapshot(json: string): void;
  /** Debug/test only: the raw stored snapshot string, or null when absent. */
  readSnapshot(): string | null;
}

export default requireNativeModule<SumrakWidgetNativeModule>('SumrakWidget');
