import { describe, expect, it } from 'vitest';
import { createDraftStore, newDraft, type DraftStorage } from '../draft';
import { catalog, SegmentSchema } from '../catalog';

describe('local listening drafts', () => {
  it('preserves typed work and grading/help snapshots across a restart', async () => {
    const saved = new Map<string, string>();
    const storage: DraftStorage = {
      getItem: async (k) => saved.get(k) ?? null,
      setItem: async (k, v) => {
        saved.set(k, v);
      },
      removeItem: async (k) => {
        saved.delete(k);
      },
    };
    const store = createDraftStore(storage),
      segment = SegmentSchema.parse(catalog.segments[0]);
    const d = newDraft(segment, 'session-1', 100, 2, true);
    d.dictationText = 'Я хочу';
    d.retellingText = 'Он говорит…';
    d.attempt.assistance.plays = 3;
    await store.write(d);
    expect(await createDraftStore(storage).read(segment.id)).toEqual(d);
    await store.remove(segment.id);
    expect(await store.read(segment.id)).toBeNull();
  });
  it('keeps ordering when a final save removes a still-writing draft', async () => {
    const saved = new Map<string, string>();
    const storage: DraftStorage = {
      getItem: async (k) => saved.get(k) ?? null,
      setItem: async (k, v) => {
        await Promise.resolve();
        saved.set(k, v);
      },
      removeItem: async (k) => {
        saved.delete(k);
      },
    };
    const store = createDraftStore(storage);
    const d = newDraft(SegmentSchema.parse(catalog.segments[0]), 'x', 100, 0, true);
    const writing = store.write(d);
    const removing = store.remove(d.segmentId);
    await writing;
    await removing;
    expect(await store.read(d.segmentId)).toBeNull();
  });
  it('does not silently overwrite malformed persisted work', async () => {
    const storage: DraftStorage = {
      getItem: async () => '{"version":999}',
      setItem: async () => {},
      removeItem: async () => {},
    };
    await expect(createDraftStore(storage).read('lab-01')).rejects.toThrow('kept for recovery');
  });
});
