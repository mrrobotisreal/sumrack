import type { Take } from './audio-controller';

/** Crosses the native recorder's absolute-path → Expo File URI boundary. */
export async function copyCapturedTake(
  recording: Take,
  destinationUri: string,
  copy: (sourceUri: string, destinationUri: string) => Promise<void>,
): Promise<Take> {
  const sourceUri = recording.path.startsWith('/') ? `file://${recording.path}` : recording.path;
  await copy(sourceUri, destinationUri);
  return { path: destinationUri, durationMs: recording.durationMs };
}
