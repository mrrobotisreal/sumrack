import { File, Paths } from 'expo-file-system';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import SherpaSpeech from '../../../modules/sherpa-speech';
import { track } from '@/services/analytics';

/**
 * Mic-attempt recording (T12). The actual capture is native (AudioRecord →
 * 16 kHz mono WAV in the sherpa-speech module — the exact format the ASR
 * wants); this wrapper owns the RECORD_AUDIO permission flow and the attempt
 * file location. One attempt file, overwritten per attempt — attempts are
 * ephemeral (cache dir), only scores persist.
 */

export const MAX_ATTEMPT_MS = 30_000;

export type MicPermission = 'granted' | 'undetermined' | 'denied';

function toMicPermission(res: { granted: boolean; canAskAgain: boolean }): MicPermission {
  if (res.granted) return 'granted';
  return res.canAskAgain ? 'undetermined' : 'denied';
}

export async function getMicPermission(): Promise<MicPermission> {
  return toMicPermission(await getRecordingPermissionsAsync());
}

/** Request with the system dialog. Track denials — they gate a whole game mode. */
export async function requestMicPermission(): Promise<MicPermission> {
  const result = toMicPermission(await requestRecordingPermissionsAsync());
  if (result !== 'granted')
    track('pron_mic_permission_denied', { canAskAgain: result !== 'denied' });
  return result;
}

export function attemptWavPath(): string {
  return new File(Paths.cache, 'pron-attempt.wav').uri;
}

export async function startAttemptRecording(): Promise<void> {
  await SherpaSpeech.startRecording(attemptWavPath());
}

export async function stopAttemptRecording(): Promise<{ path: string; durationMs: number }> {
  return SherpaSpeech.stopRecording();
}

export async function cancelAttemptRecording(): Promise<void> {
  await SherpaSpeech.cancelRecording();
}
