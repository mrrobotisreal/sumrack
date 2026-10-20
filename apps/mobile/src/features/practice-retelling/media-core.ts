import { sha256Hex, type BundleInput } from '@/features/scenario/recordings/media-bundle';
import {
  keptMedia,
  KeptMediaSchema,
  PRACTICE_QUOTA_BYTES,
  type KeptMedia,
  type PracticeContext,
} from './model';
import type { PracticeStore } from './store';
export interface PracticeFiles {
  read(uri: string): Promise<Uint8Array>;
  write(mediaId: string, bytes: Uint8Array): Promise<void>;
  remove(mediaId: string): Promise<void>;
  usedBytes(): Promise<number>;
}
export function createPracticeMedia(store: PracticeStore, files: PracticeFiles) {
  let pending = Promise.resolve();
  return {
    keep(input: {
      mediaId: string;
      uri: string;
      durationMs: number;
      context: PracticeContext;
      at: number;
    }): Promise<KeptMedia> {
      const result = pending
        .catch(() => undefined)
        .then(async () => {
          const events = await store.list();
          const existing = keptMedia(events).find((e) => e.mediaId === input.mediaId);
          if (existing) return existing;
          if (events.some((e) => e.kind === 'media-deleted' && e.mediaId === input.mediaId))
            throw new Error('This take was deleted. Record another take to keep it.');
          const bytes = await files.read(input.uri);
          const record = KeptMediaSchema.parse({
            v: 1,
            id: `${input.mediaId}:kept`,
            kind: 'media-kept',
            at: input.at,
            mediaId: input.mediaId,
            context: input.context,
            file: 'original.wav',
            bytes: bytes.length,
            sha256: sha256Hex(bytes),
            durationMs: input.durationMs,
          });
          if ((await files.usedBytes()) + bytes.length > PRACTICE_QUOTA_BYTES)
            throw new Error(
              'The 128 MiB practice-recording limit is full. Remove a local recording before keeping another.',
            );
          await files.write(input.mediaId, bytes);
          try {
            await store.append(record);
          } catch (error) {
            await files.remove(input.mediaId);
            throw error;
          }
          return record;
        });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    delete(mediaId: string, at: number) {
      const result = pending.then(async () => {
        const prior = (await store.list()).find(
          (e) => e.kind === 'media-deleted' && e.mediaId === mediaId,
        );
        if (!prior)
          await store.append({
            v: 1,
            id: `${mediaId}:deleted`,
            kind: 'media-deleted',
            mediaId,
            at,
          });
        await files.remove(mediaId);
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    removeLocal: (mediaId: string) => files.remove(mediaId),
  };
}

/** Shared by the production lazy restore and roundtrip tests, before any filesystem write. */
export function validatePracticeBundle(
  expected: KeptMedia | undefined,
  files: readonly BundleInput[],
  usedBytes: number,
) {
  if (!expected) throw new Error('This retained recording was deleted.');
  const [file] = files;
  if (
    files.length !== 1 ||
    !file ||
    file.name !== expected.file ||
    file.data.length !== expected.bytes ||
    sha256Hex(file.data) !== expected.sha256
  )
    throw new Error('The bundle does not match the original retained recording.');
  if (usedBytes + file.data.length > PRACTICE_QUOTA_BYTES)
    throw new Error(
      'The 128 MiB practice-recording limit is full. Remove a local recording before restoring.',
    );
}
