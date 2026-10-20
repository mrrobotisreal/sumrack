import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { queryClient } from '@/lib/query-client';
import { track } from '@/services/analytics';
import {
  attemptFile,
  ensureRunDir,
  listRunDirs,
  runDir,
} from '@/features/scenario/recordings/paths';
import {
  bundlePracticeRecording,
  downloadPracticeRecording,
} from '@/features/scenario/recordings/bundle-service';
import { transcribeWav } from '@/features/pronunciation/asr-service';
import { ASR_MODEL } from '@/features/pronunciation/asr-catalog';
import { createPracticeMedia } from './media-core';
import { practiceStore } from './runtime-store';
import { confirmedTranscript, keptMedia, type PracticeContext } from './model';

export const practiceKey = ['practice-retelling'] as const;
export const refreshPractice = () => {
  void queryClient.invalidateQueries({ queryKey: practiceKey });
};
export const practiceFiles = {
  read: (uri: string) => new File(uri).bytes(),
  async write(mediaId: string, bytes: Uint8Array) {
    ensureRunDir(mediaId, 'practice');
    const file = attemptFile(mediaId, 'original.wav', 'practice');
    if (file.exists) file.delete();
    file.write(bytes);
  },
  async remove(mediaId: string) {
    const dir = runDir(mediaId, 'practice');
    if (dir.exists) dir.delete();
  },
  async usedBytes() {
    return listRunDirs('practice').reduce((n, d) => n + d.bytes, 0);
  },
};
const media = createPracticeMedia(practiceStore, practiceFiles);
export function practiceRecordingFile(mediaId: string) {
  return attemptFile(mediaId, 'original.wav', 'practice');
}
export async function keepPracticeTake(
  mediaId: string,
  uri: string,
  durationMs: number,
  context: PracticeContext,
) {
  const record = await media.keep({ mediaId, uri, durationMs, context, at: Date.now() });
  track('practice_recording_action', {
    action: 'kept',
    mediaId,
    context: context.kind,
    bytes: record.bytes,
  });
  refreshPractice();
  void bundlePracticeRecording(mediaId).finally(refreshPractice);
  return record;
}
export async function deletePracticeTake(mediaId: string) {
  await media.delete(mediaId, Date.now());
  track('practice_recording_action', { action: 'deleted', mediaId });
  refreshPractice();
}
export async function removePracticeLocal(mediaId: string) {
  await media.removeLocal(mediaId);
  track('practice_recording_action', { action: 'removed-local', mediaId });
  refreshPractice();
}
export async function restorePracticeTake(mediaId: string) {
  await downloadPracticeRecording(mediaId);
  refreshPractice();
}
export async function transcribePracticeTake(mediaId: string) {
  const events = await practiceStore.list();
  if (!keptMedia(events).some((e) => e.mediaId === mediaId))
    throw new Error('This recording is no longer retained.');
  const file = practiceRecordingFile(mediaId);
  if (!file.exists) throw new Error('Restore the recording before transcribing.');
  const result = await transcribeWav(file.uri);
  // An uncertain original is immutable. User confirmation is a separate record.
  const at = Date.now();
  const transcript = {
    v: 1 as const,
    id: randomUUID(),
    kind: 'transcript' as const,
    at,
    mediaId,
    text: result.text,
    source: 'asr-original' as const,
    originalId: null,
    model: ASR_MODEL.id,
  };
  await practiceStore.append(transcript);
  track('practice_recording_action', { action: 'transcribed', mediaId });
  refreshPractice();
  return transcript;
}
export async function confirmPracticeTranscript(originalId: string, text: string) {
  const events = await practiceStore.list();
  const original = events.find(
    (e) => e.kind === 'transcript' && e.id === originalId && e.source === 'asr-original',
  );
  if (!original || original.kind !== 'transcript' || !text.trim())
    throw new Error('Add the words you intended to say before confirming.');
  const correction = confirmedTranscript(original, text, randomUUID(), Date.now());
  await practiceStore.append(correction);
  track('practice_recording_action', { action: 'transcript-confirmed', mediaId: original.mediaId });
  refreshPractice();
  return correction;
}

/** Finish explicit deletions after a filesystem interruption or a synced tombstone. */
export async function cleanDeletedPracticeFiles() {
  for (const event of await practiceStore.list())
    if (event.kind === 'media-deleted') await practiceFiles.remove(event.mediaId);
}
