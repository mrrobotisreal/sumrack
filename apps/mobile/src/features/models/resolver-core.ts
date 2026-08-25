import { safeParseModelsManifest, type ModelsManifest } from '@sumrak/schema';

/**
 * Pure model-source resolution (T23, V2 §2) — the one shared resolver both
 * the TTS voice catalog and the ASR catalog install through. Speech-model
 * archives are hosted in the private content repo (`models-manifest.json`
 * lists them); the k2-fsa release-asset URLs pinned in the catalogs stay as
 * the documented last-resort fallback.
 *
 * This module is pure planning logic (unit-tested in Node); the wired I/O —
 * manifest fetch/cache, PAT headers, native download + hash — lives in
 * `manifest-cache.ts` / `install-source.ts`.
 */

/** What a catalog pins about one installable model. */
export interface ModelRef {
  /** Stable id — must match a `models-manifest.json` entry id when mirrored. */
  id: string;
  /** The hardcoded upstream k2-fsa URL (the fallback, kept as-is per ticket). */
  fallbackUrl: string;
  /** The pinned sha256 for the upstream archive. */
  sha256: string;
  /** The pinned archive size. */
  bytes: number;
}

export type ModelSourceKind = 'content-repo' | 'upstream-fallback';

export type PlannedModelSource =
  | { source: 'content-repo'; path: string; sha256: string; bytes: number }
  | { source: 'upstream-fallback'; url: string; sha256: string; bytes: number };

/**
 * Order the sources to try for one model: content repo first when the
 * manifest lists the id, always ending with the pinned upstream fallback.
 * A null manifest (unreachable + no cache, or invalid) degrades cleanly to
 * fallback-only — a missing/corrupt manifest must never block installs.
 */
export function planModelSources(
  ref: ModelRef,
  manifest: ModelsManifest | null,
): PlannedModelSource[] {
  const upstream: PlannedModelSource = {
    source: 'upstream-fallback',
    url: ref.fallbackUrl,
    sha256: ref.sha256,
    bytes: ref.bytes,
  };
  const entry = manifest?.models.find((m) => m.id === ref.id);
  if (!entry) return [upstream];
  return [
    { source: 'content-repo', path: entry.file, sha256: entry.sha256, bytes: entry.bytes },
    upstream,
  ];
}

/**
 * Parse a cached copy of models-manifest.json (Zod at the I/O boundary).
 * Anything unreadable → null, never a throw — the cache is best-effort.
 */
export function parseCachedManifestText(text: string): ModelsManifest | null {
  try {
    const result = safeParseModelsManifest(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** What the gate needs to know about connectivity right now. */
export interface NetworkSnapshot {
  /** null = state unknown (query failed). */
  reachable: boolean | null;
  /** Wi-Fi or ethernet — the same "onWifi" definition content sync uses. */
  onWifi: boolean;
}

export type ModelDownloadGate =
  { allowed: true } | { allowed: false; reason: 'offline' | 'wifi-only'; message: string };

/**
 * The Wi-Fi-only gate for model downloads (ticket item 5): models are 10×
 * bigger than any pack file, so they respect the same "Wi-Fi only" toggle
 * pack audio uses. Unknown network type counts as not-Wi-Fi — the same
 * conservative reading sync's audio deferral applies.
 */
export function evaluateModelDownloadGate(
  wifiOnly: boolean,
  net: NetworkSnapshot,
): ModelDownloadGate {
  if (net.reachable === false) {
    return {
      allowed: false,
      reason: 'offline',
      message: 'No internet connection — model downloads need to be online.',
    };
  }
  if (wifiOnly && !net.onWifi) {
    return {
      allowed: false,
      reason: 'wifi-only',
      message:
        'Waiting for Wi-Fi — model downloads follow the "Wi-Fi only" setting (Settings → Content sync).',
    };
  }
  return { allowed: true };
}
