import { describe, expect, it } from 'vitest';

import { missingAudioKeys } from '../engine/assets';
import type { ItemAssets } from '../items/exam-audio';

const assets = (audio: ItemAssets['audio']): ItemAssets => ({
  passage: null,
  audio,
  audioStoryId: audio ? 's' : null,
});
const real = { synthetic: false } as NonNullable<ItemAssets['audio']>;
const tts = { synthetic: true } as NonNullable<ItemAssets['audio']>;

describe('missingAudioKeys (mock refuses TTS fallback)', () => {
  it('flags synthetic and absent audio, not real files', () => {
    const m = new Map<string, ItemAssets>([
      ['a', assets(real)],
      ['b', assets(tts)],
      ['c', assets(null)],
    ]);
    expect(missingAudioKeys(m)).toEqual(['b', 'c']);
    expect(missingAudioKeys(new Map([['a', assets(real)]]))).toEqual([]);
  });
});
