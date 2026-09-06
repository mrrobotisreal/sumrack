export interface AmbientPrefs {
  enabled: boolean;
  volume: number;
}

export const DEFAULT_AMBIENT_PREFS: AmbientPrefs = { enabled: true, volume: 0.08 };

export function parseAmbientPrefs(raw: unknown): AmbientPrefs {
  const value = raw != null && typeof raw === 'object' ? (raw as Partial<AmbientPrefs>) : {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AMBIENT_PREFS.enabled,
    volume:
      typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.max(0, Math.min(0.2, value.volume))
        : DEFAULT_AMBIENT_PREFS.volume,
  };
}
