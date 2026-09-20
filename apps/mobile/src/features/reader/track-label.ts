import type { AudioTrackRow } from '@/db/repositories/content';
import { REGISTER_LABELS } from '@/features/library/categories';

/**
 * Audio-bar / lockscreen label (T10; M14 §5 register mapping in T46). A
 * `style` that is a narration register slug (§2.5 — `narrator`, `anchor`, …)
 * maps to its Russian name:
 *   "elevenlabs:Mr. Wintrow" + "narrator" → "Mr. Wintrow · Рассказчик".
 * Anything else keeps the pre-M14 output byte-for-byte (every track
 * published before the ADR-0016 flip goes through this branch):
 *   "elevenlabs:Elen Kuragina" + "creepy-whisper" → "Elen Kuragina · creepy whisper".
 */
export function trackLabel(track: Pick<AudioTrackRow, 'voice' | 'style'>): string {
  const voice = track.voice.replace(/^[^:]+:/, '');
  const register = Object.prototype.hasOwnProperty.call(REGISTER_LABELS, track.style)
    ? REGISTER_LABELS[track.style]
    : undefined;
  if (register) return `${voice} · ${register}`;
  const style = track.style.replace(/-/g, ' ');
  return `${voice} · ${style}`;
}
