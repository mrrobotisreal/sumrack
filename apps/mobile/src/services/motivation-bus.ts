/**
 * Tiny one-way event bridge (T19): the db layer emits domain moments the
 * motivation feature cares about without importing feature code (repos must
 * stay feature-free). The motivation service registers its handler at
 * bootstrap; events fired before that are dropped deliberately — bootstrap
 * runs an achievement sweep anyway, so nothing is missed.
 */
export type MotivationBusEvent = 'bank-item-added' | 'unit-completed';

type Handler = (event: MotivationBusEvent) => void;

let handler: Handler | null = null;

export function setMotivationHandler(h: Handler | null) {
  handler = h;
}

export function emitMotivationEvent(event: MotivationBusEvent) {
  handler?.(event);
}
