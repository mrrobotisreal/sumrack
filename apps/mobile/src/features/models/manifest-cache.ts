import { parseModelsManifest, type ModelsManifest } from '@sumrak/schema';
import { File, Paths } from 'expo-file-system';

import type { GithubContentClient } from '@/features/sync/github-client';

import { parseCachedManifestText } from './resolver-core';

/**
 * models-manifest.json fetch + cache (T23). The manifest is fetched via the
 * same authenticated raw-content path packs use and cached to a file so an
 * offline or failed fetch never blocks the fallback chain: fetch → on
 * success refresh the cache; on failure serve the last cached copy; with
 * neither, resolution degrades to the pinned upstream URLs.
 */

export const MODELS_MANIFEST_PATH = 'models-manifest.json';

/** Cached copy of the last successfully fetched + validated manifest. */
function cacheFile(): File {
  return new File(Paths.document, 'models-manifest-cache.json');
}

/** Read the cached manifest; anything missing/unreadable/invalid → null. */
export function readCachedModelsManifest(): ModelsManifest | null {
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    return parseCachedManifestText(file.textSync());
  } catch {
    return null;
  }
}

/**
 * Fetch the manifest from the content repo, validate, refresh the cache.
 * On any failure (network, auth, malformed JSON, schema) fall back to the
 * cached copy — the caller treats null as "resolve via upstream fallback".
 */
export async function getModelsManifest(
  client: GithubContentClient,
): Promise<ModelsManifest | null> {
  try {
    const bytes = await client.fetchRawFile(MODELS_MANIFEST_PATH);
    const manifest = parseModelsManifest(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
    try {
      cacheFile().write(JSON.stringify(manifest));
    } catch {
      // Cache write is best-effort; the fetched manifest still serves this install.
    }
    return manifest;
  } catch {
    return readCachedModelsManifest();
  }
}
