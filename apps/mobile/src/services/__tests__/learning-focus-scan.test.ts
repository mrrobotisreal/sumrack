import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * T78 guard: short learning-clip surfaces play through the focus wrapper.
 * `createAudioPlayer` users must import learning-focus; the speak() surfaces
 * ride the TTS service (which brackets focus). Long-form players are not listed.
 */
const SRC = join(__dirname, '..', '..');
const SLICE_PLAYERS = [
  'features/audio/use-slice-player.ts', // T79/T85: reader «в предложении» + popup sentence slice through this
  'features/torfl/items/use-exam-audio.ts',
];
const SPEAK_SURFACES = [
  'features/reader/word-popup.tsx',
  'features/reader/phrase-card-sheet.tsx',
  'features/review/games/numbers/numbers-screen.tsx',
  'features/pronunciation/pronunciation-view.tsx',
  'features/path/exercises/spec-pronunciation-view.tsx',
];

describe('learning clips take transient focus', () => {
  it.each(SLICE_PLAYERS)('%s uses the slice-focus wrapper', (f) => {
    const src = readFileSync(join(SRC, f), 'utf8');
    expect(src).toContain("from '@/services/learning-focus'");
    expect(src).toContain('createSliceFocus(');
  });

  it.each(SPEAK_SURFACES)('%s speaks only via the SpeechService (focus-bracketed)', (f) => {
    const src = readFileSync(join(SRC, f), 'utf8');
    expect(src).not.toMatch(/from 'expo-speech'/);
    expect(src).toMatch(/@\/services\/speech/);
  });

  it('the TTS service brackets system speech with the wrapper', () => {
    const src = readFileSync(join(SRC, 'features/tts/service.ts'), 'utf8');
    expect(src).toContain('holdLearningFocus(');
  });
});
