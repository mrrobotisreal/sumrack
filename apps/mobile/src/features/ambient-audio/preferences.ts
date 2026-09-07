export interface AmbientPrefs {
  enabled: boolean;
  volume: number;
  playDuringNarration: boolean;
}

export const DEFAULT_AMBIENT_PREFS: AmbientPrefs = {
  enabled: true,
  volume: 0.2,
  playDuringNarration: true,
};

export function parseAmbientPrefs(raw: unknown): AmbientPrefs {
  const value = raw != null && typeof raw === 'object' ? (raw as Partial<AmbientPrefs>) : {};
  // Older preset settings lack the narration preference. Migrate their Soft
  // level once, but preserve a newly chosen 15% slider value on every reload.
  const volume =
    value.playDuringNarration === undefined && value.volume === 0.15 ? 0.2 : value.volume;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AMBIENT_PREFS.enabled,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.max(0, Math.min(1, volume))
        : DEFAULT_AMBIENT_PREFS.volume,
    playDuringNarration:
      typeof value.playDuringNarration === 'boolean'
        ? value.playDuringNarration
        : DEFAULT_AMBIENT_PREFS.playDuringNarration,
  };
}
