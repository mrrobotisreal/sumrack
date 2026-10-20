/** Coordinates the recorder and retained-take players without owning native resources. */
export function createPracticeAudioOwner() {
  let current: { id: symbol; stop(): Promise<void> } | null = null;
  return {
    async claim(id: symbol, stop: () => Promise<void>) {
      const previous = current;
      current = { id, stop };
      if (previous && previous.id !== id) await previous.stop();
    },
    release(id: symbol) {
      if (current?.id === id) current = null;
    },
  };
}
export const practiceAudioOwner = createPracticeAudioOwner();
