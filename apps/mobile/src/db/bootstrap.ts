import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

import pack1 from '@sumrak/schema/fixtures/packs/a1-creepypasta-001/pack.json';
import pack2 from '@sumrak/schema/fixtures/packs/a1-creepypasta-002/pack.json';
import pack3 from '@sumrak/schema/fixtures/packs/a1-prompts-001/pack.json';

import { initAnalyticsSink, track } from '@/services/analytics';

import { importPack } from './importer';
import type { Repositories } from './repositories';
import { SETTING_KEYS } from './repositories/settings';
import type { SumrakDB } from './types';

/** Bundled narration audio, keyed by pack id → AudioTrack.file relative path. */
const BUNDLED_AUDIO: Record<string, Record<string, number>> = {
  'a1-creepypasta-001': {
    'audio/knock-in-the-wall-anton-creepy.opus':
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@sumrak/schema/fixtures/packs/a1-creepypasta-001/audio/knock-in-the-wall-anton-creepy.opus'),
  },
};

const LEGACY_THEME_STORAGE_KEY = 'sumrak-theme';

/**
 * First-run (and every-run, idempotently) bootstrap, called once migrations
 * have applied:
 *
 * 1. wire the analytics sink so track() persists to analytics_events;
 * 2. migrate the T01 AsyncStorage theme setting into the settings table;
 * 3. auto-import the two bundled T02 sample packs (no-op when already at
 *    the bundled version — the importer is idempotent; a bumped bundled
 *    version upgrades in place and user refs survive by design);
 * 4. backfill FSRS cards for bank items that predate T06 (or predate a
 *    direction activating in T12/T14) — idempotent, no-op when healthy.
 */
export async function runBootstrap(db: SumrakDB, repos: Repositories): Promise<void> {
  initAnalyticsSink((event, props) => void repos.stats.logEvent(event, props));

  await migrateLegacyThemeSetting(repos);

  try {
    const backfilled = await repos.reviews.backfillCards();
    if (backfilled > 0) {
      console.log(`[bootstrap] backfilled ${backfilled} FSRS cards for pre-existing bank items`);
      track('cards_backfilled', { count: backfilled });
    }
  } catch (err) {
    console.error('[bootstrap] FSRS card backfill failed (non-fatal)', err);
  }

  for (const rawPack of [pack1, pack2, pack3]) {
    const packId = (rawPack as { id: string }).id;
    try {
      const audioFiles = await stageBundledAudio(packId);
      const result = await importPack(db, rawPack, { source: 'bundled', audioFiles });
      if (result.action === 'installed' || result.action === 'updated') {
        console.log(
          `[bootstrap] pack ${result.packId}@v${result.version} ${result.action}: ` +
            `${result.counts.stories} stories, ${result.counts.sentences} sentences, ${result.counts.tokens} tokens`,
        );
        track('pack_imported', {
          packId: result.packId,
          version: result.version,
          action: result.action,
          source: 'bundled',
        });
      }
    } catch (err) {
      // A broken bundled pack must never brick app start; surface loudly in dev.
      console.error(`[bootstrap] failed to import bundled pack ${packId}`, err);
    }
  }

  await repos.settings.set(SETTING_KEYS.bootstrapDone, true);
}

/** T01 stored theme via zustand persist over AsyncStorage — move it into settings. */
async function migrateLegacyThemeSetting(repos: Repositories): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!raw) return;
    const existing = await repos.settings.get<string>(SETTING_KEYS.themeMode);
    if (!existing) {
      const parsed = JSON.parse(raw) as { state?: { mode?: string } };
      const mode = parsed.state?.mode;
      if (mode === 'dark' || mode === 'light' || mode === 'system') {
        await repos.settings.set(SETTING_KEYS.themeMode, mode);
        console.log(`[bootstrap] migrated theme mode "${mode}" from AsyncStorage into settings`);
      }
    }
    await AsyncStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch (err) {
    console.warn('[bootstrap] legacy theme migration failed (non-fatal)', err);
  }
}

/**
 * Copy bundled narration audio into app-scoped storage
 * (documentDirectory/packs/<packId>/audio/…, design §4.3) and return the
 * localUri map for the importer. Audio is not load-bearing until T10 —
 * failures log and return what succeeded.
 */
async function stageBundledAudio(packId: string): Promise<Record<string, string>> {
  const bundled = BUNDLED_AUDIO[packId];
  if (!bundled) return {};
  const staged: Record<string, string> = {};
  for (const [relPath, moduleId] of Object.entries(bundled)) {
    try {
      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync();
      if (!asset.localUri) continue;
      const parts = relPath.split('/');
      const fileName = parts.pop()!;
      const dir = new Directory(Paths.document, 'packs', packId, ...parts);
      if (!dir.exists) dir.create({ intermediates: true });
      const dest = new File(dir, fileName);
      if (!dest.exists) new File(asset.localUri).copy(dest);
      staged[relPath] = dest.uri;
    } catch (err) {
      console.warn(`[bootstrap] audio staging failed for ${packId}/${relPath}`, err);
    }
  }
  return staged;
}
