import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIRROR_MODELS } from '@sumrak/pipeline';
import { describe, expect, it } from 'vitest';

import { ASR_MODEL } from '@/features/pronunciation/asr-catalog';
import { ASSIST_MODEL } from '@/features/pronunciation/assist-catalog';
import { PIPER_VOICES } from '@/features/tts/catalog';

/**
 * T23 pin tests: the content-repo mirror (pipeline MIRROR_MODELS →
 * models-manifest.json) and the app catalogs' k2-fsa fallback constants
 * must claim the SAME sha256/bytes/upstream URL per model id — a drifted
 * pair would make one source unverifiable. Plus the shared-resolver wiring
 * proof: both managers install through features/models, not private copies.
 */

describe('mirror ↔ catalog pins', () => {
  it('covers exactly the app catalogs: 4 Piper voices + 1 ASR model + 1 assist model', () => {
    const mirrorIds = MIRROR_MODELS.map((m) => m.id).sort();
    const catalogIds = [...PIPER_VOICES.map((v) => v.id), ASR_MODEL.id, ASSIST_MODEL.id].sort();
    expect(mirrorIds).toEqual(catalogIds);
  });

  it('both sources claim the same sha256/bytes/upstream URL per voice id', () => {
    for (const voice of PIPER_VOICES) {
      const mirror = MIRROR_MODELS.find((m) => m.id === voice.id);
      expect(mirror, voice.id).toBeDefined();
      expect(mirror!.kind).toBe('tts-voice');
      expect(mirror!.sha256).toBe(voice.archiveSha256);
      expect(mirror!.bytes).toBe(voice.archiveBytes);
      expect(mirror!.upstreamUrl).toBe(voice.archiveUrl);
      expect(mirror!.displayName).toBe(voice.displayName);
    }
  });

  it('both sources claim the same sha256/bytes/upstream URL for the ASR model', () => {
    const mirror = MIRROR_MODELS.find((m) => m.id === ASR_MODEL.id);
    expect(mirror).toBeDefined();
    expect(mirror!.kind).toBe('asr');
    expect(mirror!.sha256).toBe(ASR_MODEL.archiveSha256);
    expect(mirror!.bytes).toBe(ASR_MODEL.archiveBytes);
    expect(mirror!.upstreamUrl).toBe(ASR_MODEL.archiveUrl);
  });

  it('both sources claim the same pins for the assist model, which is release-hosted (T59)', () => {
    const mirror = MIRROR_MODELS.find((m) => m.id === ASSIST_MODEL.id);
    expect(mirror).toBeDefined();
    expect(mirror!.kind).toBe('assist');
    expect(mirror!.sha256).toBe(ASSIST_MODEL.archiveSha256);
    expect(mirror!.bytes).toBe(ASSIST_MODEL.archiveBytes);
    expect(mirror!.upstreamUrl).toBe(ASSIST_MODEL.archiveUrl);
    expect(mirror!.displayName).toBe(ASSIST_MODEL.displayName);
    // 207 MB — over the tree limit, so it must ride the release path.
    expect(mirror!.release).toEqual({ tag: 'models' });
  });
});

describe('shared resolver wiring', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../../..', 'src', rel), 'utf8');

  it('both managers install through the ONE shared resolver, not private copies', () => {
    for (const manager of [
      'features/tts/manager.ts',
      'features/pronunciation/asr-manager.ts',
      'features/pronunciation/assist-manager.ts',
    ]) {
      const source = read(manager);
      expect(source, manager).toContain("from '@/features/models/install-source'");
      expect(source, manager).toContain('resolveModelDownloadSpecs');
      expect(source, manager).toContain('downloadModelArchive');
      expect(source, manager).toContain('assertModelDownloadAllowed');
      // The pre-T23 private download path is gone from the managers: the
      // stream-download + hash-verify now lives only in install-source.
      expect(source, manager).not.toContain('createDownloadResumable');
      expect(source, manager).not.toContain('sha256File');
    }
  });
});
