/** Russian plural: 1 часть · 2–4 части · 5+ частей (11–14 → частей). */
export function partsLabel(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'часть'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'части'
        : 'частей';
  return `${n} ${word}`;
}

/** Minutes rounded; below 60 s → «< 1 мин». */
export function minutesLabel(ms: number): string {
  if (ms < 60_000) return '< 1 мин';
  return `${Math.round(ms / 60_000)} мин`;
}

/** «elevenlabs:Mr. Wintrow» → «Mr. Wintrow». */
export function voiceLabel(voice: string): string {
  return voice.replace(/^[^:]+:/, '');
}

/** «8 частей · 17 мин · Mr. Wintrow» (voice omitted when empty). */
export function listenCaption(a: { parts: number; durationMs: number; voice: string }): string {
  const voice = voiceLabel(a.voice);
  return [partsLabel(a.parts), minutesLabel(a.durationMs), voice].filter(Boolean).join(' · ');
}
