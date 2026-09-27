import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

import type { TurnState } from '../engine/turn-machine';

/**
 * The stage's state line (T62 §9.3): what is happening, never a transcript.
 * «{Host} говорит…» · «Слушаю…» · «Думаю…» · «{Host} переспрашивает…» ·
 * «(принято)» for a second after an online rescue.
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

export function StateLine({
  state,
  host,
  rescued,
}: {
  state: TurnState;
  host: string;
  /** True for ~1 s after an online rescue accepted the answer. */
  rescued: boolean;
}) {
  const text = stateLineText(state, host);
  return (
    <View className="min-h-6 flex-row items-center justify-center gap-2">
      <Text variant="muted" className="text-center" numberOfLines={1}>
        {text}
      </Text>
      {rescued && (
        <View className="rounded-full border border-success/50 bg-success/15 px-2 py-0.5">
          <Text className="text-xs text-success">(принято)</Text>
        </View>
      )}
    </View>
  );
}
