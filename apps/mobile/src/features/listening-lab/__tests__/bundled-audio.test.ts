import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { catalog } from '../catalog';
import manifest from '../bundled-audio-manifest.json';

describe('bounded bundled listening media', () => {
  it('has one intact small Opus asset for each catalog segment, cut before any neighbour', () => {
    expect(manifest.method).toBe('opus-packet-copy');
    expect(manifest.catalogVersion).toBe(catalog.version);
    expect(manifest.segments).toHaveLength(catalog.segments.length);
    let bytes = 0;
    for (const segment of catalog.segments) {
      const entry = manifest.segments.find((s) => s.id === segment.id);
      expect(entry).toBeDefined();
      if (!entry) throw new Error(`Missing bounded clip: ${segment.id}`);
      const data = readFileSync(resolve(process.cwd(), entry.asset));
      expect(data.subarray(0, 4).toString()).toBe('OggS');
      expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
      expect(data.length).toBe(entry.bytes);
      expect(entry.requestedEndMs).toBe(segment.source.endMs);
      expect(entry.durationMs).toBeGreaterThanOrEqual(entry.requestedEndMs);
      // At most one Opus packet of trailing silence; smallest published neighbour gap is 75 ms.
      expect(entry.packetTailMs).toBeLessThan(25);
      expect(entry.pcmEqualsSourcePrefix).toBe(true);
      bytes += data.length;
    }
    expect(bytes).toBeLessThan(1_000_000);
  });
});
