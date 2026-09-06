export interface AmbientPrefs {
  enabled: boolean;
  volume: number;
}

export const DEFAULT_AMBIENT_PREFS: AmbientPrefs = { enabled: true, volume: 0.08 };
export const SOFT_AMBIENT_VOLUME = 0.2;

export function parseAmbientPrefs(raw: unknown): AmbientPrefs {
  const value = raw != null && typeof raw === 'object' ? (raw as Partial<AmbientPrefs>) : {};
  // Preserve the selected Soft preset when loading its previous 15% gain.
  const volume = value.volume === 0.15 ? SOFT_AMBIENT_VOLUME : value.volume;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AMBIENT_PREFS.enabled,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.max(0, Math.min(SOFT_AMBIENT_VOLUME, volume))
        : DEFAULT_AMBIENT_PREFS.volume,
  };
}
