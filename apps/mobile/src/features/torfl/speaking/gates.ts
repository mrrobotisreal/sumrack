import type { HubGates } from '@/features/scenario/hub-gates';

/**
 * The speaking subtest's start gate (T73, TORFL §12): the M17 hub gates
 * (`useHubGates`) decide — no ASR model or a denied mic blocks the subtest
 * with the reason; an undetermined mic is NOT a block (the system dialog
 * comes up on the instruction screen). Pure over the gate shape.
 */
export function speakingGateMessage(gates: Pick<HubGates, 'gate' | 'mic'>): string | null {
  if (gates.gate === 'asr-missing') {
    return 'Нет модели распознавания речи: без неё ответы не оцениваются. Установи «Russian speech recognition» в настройках и вернись — или пропусти субтест.';
  }
  if (gates.gate === 'mic-denied' || gates.mic === 'denied') {
    return 'Микрофон запрещён: разреши запись звука для Сумрака в настройках системы и вернись — или пропусти субтест.';
  }
  return null;
}
