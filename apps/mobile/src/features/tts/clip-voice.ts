import { useTtsStore } from './store';
import { pickClipVoiceId } from './engine';

/**
 * T85: the Piper voice for word/phrase clips, read from the live TTS store.
 * Kept in its own module (not `service.ts`) so pure listening logic can
 * import it without loading the native expo-speech / sherpa-speech modules.
 * undefined = no Piper voice installed → the normal system fallback.
 */
export function clipVoiceId(): string | undefined {
  const { selectedVoiceId, installed } = useTtsStore.getState();
  return pickClipVoiceId(selectedVoiceId, Object.keys(installed));
}
