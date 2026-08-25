import type { ModelsManifest } from '@sumrak/schema';
import { describe, expect, it } from 'vitest';

import {
  evaluateModelDownloadGate,
  parseCachedManifestText,
  planModelSources,
  type ModelRef,
} from '../resolver-core';

const REF: ModelRef = {
  id: 'piper-ru-ruslan',
  fallbackUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/x.tar.bz2',
  sha256: 'a'.repeat(64),
  bytes: 67_000_000,
};

const MANIFEST: ModelsManifest = {
  schemaVersion: 1,
  models: [
    {
      id: 'piper-ru-ruslan',
      kind: 'tts-voice',
      file: 'models/tts/x.tar.bz2',
      bytes: 67_000_001,
      sha256: 'b'.repeat(64),
      displayName: 'Руслан',
    },
  ],
};

describe('planModelSources', () => {
  it('is manifest-first with the pinned upstream always last', () => {
    const sources = planModelSources(REF, MANIFEST);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      source: 'content-repo',
      path: 'models/tts/x.tar.bz2',
      // sha256/bytes come FROM THE MANIFEST (ticket item 3), not the pins.
      sha256: 'b'.repeat(64),
      bytes: 67_000_001,
    });
    expect(sources[1]).toEqual({
      source: 'upstream-fallback',
      url: REF.fallbackUrl,
      sha256: REF.sha256,
      bytes: REF.bytes,
    });
  });

  it('degrades to fallback-only when the manifest is unavailable', () => {
    expect(planModelSources(REF, null)).toEqual([
      { source: 'upstream-fallback', url: REF.fallbackUrl, sha256: REF.sha256, bytes: REF.bytes },
    ]);
  });

  it('degrades to fallback-only when the manifest does not list the id', () => {
    const sources = planModelSources({ ...REF, id: 'piper-ru-unlisted' }, MANIFEST);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.source).toBe('upstream-fallback');
  });
});

describe('parseCachedManifestText', () => {
  it('parses a valid cached manifest', () => {
    const parsed = parseCachedManifestText(JSON.stringify(MANIFEST));
    expect(parsed?.models[0]!.id).toBe('piper-ru-ruslan');
  });

  it('returns null (never throws) for broken JSON and schema-invalid content', () => {
    expect(parseCachedManifestText('{not json')).toBeNull();
    expect(parseCachedManifestText('{"schemaVersion":2,"models":[]}')).toBeNull();
    expect(parseCachedManifestText('null')).toBeNull();
  });
});

describe('evaluateModelDownloadGate (Wi-Fi-only, ticket item 5)', () => {
  it('blocks when provably offline, whatever the toggle', () => {
    for (const wifiOnly of [true, false]) {
      const gate = evaluateModelDownloadGate(wifiOnly, { reachable: false, onWifi: false });
      expect(gate.allowed).toBe(false);
      if (!gate.allowed) expect(gate.reason).toBe('offline');
    }
  });

  it('blocks on cellular when Wi-Fi-only is on, with a settings-pointing message', () => {
    const gate = evaluateModelDownloadGate(true, { reachable: true, onWifi: false });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toBe('wifi-only');
      expect(gate.message).toContain('Wi-Fi');
    }
  });

  it('treats unknown network type as not-Wi-Fi (sync-consistent conservative read)', () => {
    const gate = evaluateModelDownloadGate(true, { reachable: null, onWifi: false });
    expect(gate.allowed).toBe(false);
  });

  it('allows on Wi-Fi with the toggle on, and on cellular with the toggle off', () => {
    expect(evaluateModelDownloadGate(true, { reachable: true, onWifi: true }).allowed).toBe(true);
    expect(evaluateModelDownloadGate(false, { reachable: true, onWifi: false }).allowed).toBe(true);
    expect(evaluateModelDownloadGate(false, { reachable: null, onWifi: false }).allowed).toBe(true);
  });
});
