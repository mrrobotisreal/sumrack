import { normalizeRu } from '@/db/normalize';

/**
 * Tolerant answer matching for typed game input (T13; design §7.3 mode 3:
 * "lenient diacritic/ё-tolerant matching"). Builds on the app-wide
 * `normalizeRu` (NFC, lowercase, ё→е — T03) and additionally strips stress
 * accents and collapses whitespace, so a typed answer is judged on the word
 * itself, never on casing, ё vs е, or a pasted stress mark.
 *
 * Shared, standalone, and unit-tested per the T13 ticket — any future typed
 * mode (T14 listening) compares through here rather than growing its own
 * comparator. Pronunciation's `wordsMatch` (T12) is deliberately different:
 * it adds edit-distance leniency because the ASR channel is noisy; typed
 * input has no such excuse, so equality here is exact after folding.
 */

/** Fold text to its tolerant comparison form: NFC → strip stress accents → normalizeRu → collapse whitespace. */
export function foldForAnswer(text: string): string {
  // U+0300/U+0301 = combining grave/acute (Russian stress marks). NFC keeps
  // й/ё precomposed, so stripping these never mangles a real letter.
  const stripped = text.normalize('NFC').replace(/[̀́]/g, '');
  return normalizeRu(stripped).replace(/\s+/g, ' ').trim();
}

/** Case-insensitive, ё/е- and stress-mark-tolerant equality for typed answers. */
export function answersMatch(expected: string, typed: string): boolean {
  return foldForAnswer(expected) === foldForAnswer(typed);
}
