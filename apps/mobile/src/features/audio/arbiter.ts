/**
 * Audio arbiter (FULL_STORY_LISTEN §5.2): the long-form players (reader
 * narration, listen) register a pause callback; `claim(name)` pauses every
 * other owner so two never talk at once. Slices do not claim.
 */
export type AudioOwner = 'listen' | 'narration';

const owners = new Map<AudioOwner, () => void>();

/** Register (or replace) an owner; returns an unregister function. */
export function registerOwner(name: AudioOwner, pause: () => void): () => void {
  owners.set(name, pause);
  return () => {
    if (owners.get(name) === pause) owners.delete(name);
  };
}

/** Call right before `play()`: pauses every other registered owner. */
export function claim(name: AudioOwner): void {
  for (const [other, pause] of owners) {
    if (other !== name) pause();
  }
}
