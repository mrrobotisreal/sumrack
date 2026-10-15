import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** T79 guard: no slice player hardcodes lead padding or its own timer stop. */
const SRC = join(__dirname, '..', '..', '..');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('slice players share playSlice', () => {
  it('T85: the listening quiz no longer slices story audio; the reader still does', () => {
    // Listening speaks the banked text through Piper (T85) — no story slices at all.
    expect(read('features/review/games/listening/use-listening-audio.ts')).not.toContain(
      'useSlicePlayer(',
    );
    expect(read('features/reader/use-narration.ts')).toContain('useSlicePlayer(');
  });

  it.each([
    'features/reader/use-narration.ts',
    'features/audio/use-slice-player.ts',
    'features/audio/slice-controller.ts',
  ])('%s has no hardcoded ±40/60 padding or slice setTimeout stop', (f) => {
    const src = read(f);
    expect(src).not.toMatch(/SEGMENT_LEAD_(IN|OUT)_MS/);
    expect(src).not.toMatch(/stamp\.(start|end)Ms\s*[-+]\s*(40|60)\b/);
    expect(src).not.toMatch(/segmentTimerRef/);
  });

  it('use-narration no longer owns a slice player (createAudioPlayer only for narration)', () => {
    const src = read('features/reader/use-narration.ts');
    expect(src.match(/createAudioPlayer\(/g)?.length).toBe(1);
  });
});
