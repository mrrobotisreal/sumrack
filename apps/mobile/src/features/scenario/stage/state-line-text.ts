import type { TurnState } from '../engine/turn-machine';

/**
 * The stage's state line text (T62 §9.3): what is happening, never a
 * transcript. Pure so the "no transcript" rule is unit-tested.
 */
export function stateLineText(state: TurnState, host: string): string {
  const p = state.phase;
  switch (p.kind) {
    case 'intro':
      return '';
    case 'saying':
      return `${host} говорит…`;
    case 'listening':
      return p.recording === 'idle' ? 'Твоя очередь — нажми и говори' : 'Слушаю…';
    case 'deciding':
      return 'Думаю…';
    case 'reacting':
      switch (p.reaction) {
        case 'confused':
        case 'react':
          return `${host} переспрашивает…`;
        case 'hint':
        case 'second':
        case 'dont-understand':
          return `${host} подсказывает…`;
        case 'repeat':
        case 'slower':
          return `${host} повторяет…`;
        case 'explain':
        case 'howtosay':
          return `${host} объясняет…`;
        default:
          return `${host} говорит…`;
      }
    case 'ending':
      return '';
    case 'paused':
      return 'Пауза';
  }
}
