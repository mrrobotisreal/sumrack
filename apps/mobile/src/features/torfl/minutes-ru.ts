import { ruPlural } from './hub-model';

/** Seconds → «8 минут» / «2 минуты» / «1 минута» (T75: monologue copy reads the item's own prep / answer window). */
export function minutesRu(sec: number): string {
  const n = Math.round(sec / 60);
  return `${n} ${ruPlural(n, ['минута', 'минуты', 'минут'])}`;
}
