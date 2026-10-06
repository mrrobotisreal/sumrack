/**
 * JS endpointing (T60, SPEAKING_SCENARIOS §7.1, ADR-0019 decision 9): a
 * pure state machine over the native module's ~8 Hz `onRecordingLevel
 * {level, elapsedMs}` events after `startRecording`.
 *
 *   armed ──(level ≥ START_LEVEL for START_CONSECUTIVE events)──▶ speaking
 *   armed ──(NO_SPEECH_MS with no speech)──▶ stopped (no-speech)
 *   speaking ──(now − lastLoudAt ≥ TRAIL_MS[preset])──▶ stopped (silence)
 *   any ──(elapsed ≥ CAP_MS)──▶ stopped (cap)
 *   any ──(manual tap)──▶ stopped (manual) · hold-to-talk bypasses the
 *   machine entirely (`reason: 'hold'`).
 *
 * `speechStartMs` is the elapsed time of the first loud event, so the
 * debrief's waveform bar can start at speech (T63). Levels are the module's
 * normalized RMS 0..1; `START_LEVEL` / `LOUD_LEVEL` are the design's
 * starting constants — calibrated on the S25 in the T60 device pass and
 * recorded in the ticket row (the design doc is edited if they move).
 */

export type EndpointSensitivity = 'quick' | 'normal' | 'patient';

/** Trailing-silence window per preset (§7.1). */
export const TRAIL_MS: Record<EndpointSensitivity, number> = {
  quick: 800,
  normal: 1100,
  patient: 1600,
};
/** Absolute cap on one attempt (§7.1). T73 overrides it per exam task via `endpointConfig(…, {capMs})`. */
export const CAP_MS = 20_000;
/** Armed with no speech for this long ⇒ `no-speech` (§7.1). */
export const NO_SPEECH_MS = 6000;
/** Level that counts as the start of speech (§7.1 starting constant; device-calibrated). */
export const START_LEVEL = 0.08;
/** Level that keeps `lastLoudAt` fresh once speaking (§7.1 starting constant; device-calibrated). */
export const LOUD_LEVEL = 0.05;
/** Consecutive events ≥ START_LEVEL before speech is declared (a single click is not speech). */
export const START_CONSECUTIVE = 2;

export type EndpointReason = 'silence' | 'cap' | 'no-speech' | 'manual' | 'hold';

export interface EndpointConfig {
  sensitivity: EndpointSensitivity;
  startLevel: number;
  loudLevel: number;
  capMs: number;
  noSpeechMs: number;
  startConsecutive: number;
}

export function endpointConfig(
  sensitivity: EndpointSensitivity = 'normal',
  overrides: Partial<EndpointConfig> = {},
): EndpointConfig {
  return {
    sensitivity,
    startLevel: START_LEVEL,
    loudLevel: LOUD_LEVEL,
    capMs: CAP_MS,
    noSpeechMs: NO_SPEECH_MS,
    startConsecutive: START_CONSECUTIVE,
    ...overrides,
  };
}

export interface EndpointState {
  phase: 'armed' | 'speaking' | 'stopped';
  /** Elapsed ms of the first loud event once speaking (null while armed). */
  speechStartMs: number | null;
  /** Elapsed ms of the most recent loud event. */
  lastLoudAt: number | null;
  /** Consecutive events at or above the start level while armed. */
  loudRun: number;
  /** Elapsed ms of the last event seen. */
  elapsedMs: number;
  /** Peak level seen (the lab's calibration readout). */
  peak: number;
  reason: EndpointReason | null;
}

export const INITIAL_ENDPOINT: EndpointState = {
  phase: 'armed',
  speechStartMs: null,
  lastLoudAt: null,
  loudRun: 0,
  elapsedMs: 0,
  peak: 0,
  reason: null,
};

export interface LevelEvent {
  level: number;
  elapsedMs: number;
}

export interface EndpointDecision {
  state: EndpointState;
  /** Set exactly once, on the event that stopped the machine. */
  stop: { reason: EndpointReason; speechStartMs: number | null; speechMs: number } | null;
}

function stopped(
  state: EndpointState,
  reason: EndpointReason,
  elapsedMs: number,
): EndpointDecision {
  const next: EndpointState = { ...state, phase: 'stopped', reason, elapsedMs };
  const speechStartMs = state.speechStartMs;
  const speechMs =
    speechStartMs === null ? 0 : Math.max(0, (state.lastLoudAt ?? elapsedMs) - speechStartMs);
  return { state: next, stop: { reason, speechStartMs, speechMs } };
}

/** Feed one level event. Idempotent once stopped. */
export function endpointStep(
  state: EndpointState,
  event: LevelEvent,
  config: EndpointConfig,
): EndpointDecision {
  if (state.phase === 'stopped') return { state, stop: null };
  const { level, elapsedMs } = event;
  const peak = Math.max(state.peak, level);
  const base: EndpointState = { ...state, elapsedMs, peak };

  if (elapsedMs >= config.capMs) return stopped(base, 'cap', elapsedMs);

  if (base.phase === 'armed') {
    const loudRun = level >= config.startLevel ? base.loudRun + 1 : 0;
    if (loudRun >= config.startConsecutive) {
      // Speech started at the first event of the run.
      const startAt = base.lastLoudAt ?? elapsedMs;
      return {
        state: {
          ...base,
          phase: 'speaking',
          loudRun,
          speechStartMs: startAt,
          lastLoudAt: elapsedMs,
        },
        stop: null,
      };
    }
    if (loudRun === 0 && elapsedMs >= config.noSpeechMs) {
      return stopped({ ...base, loudRun }, 'no-speech', elapsedMs);
    }
    return {
      state: { ...base, loudRun, lastLoudAt: loudRun > 0 ? (base.lastLoudAt ?? elapsedMs) : null },
      stop: null,
    };
  }

  // speaking
  const loud = level >= config.loudLevel;
  const lastLoudAt = loud ? elapsedMs : (base.lastLoudAt ?? elapsedMs);
  const next: EndpointState = { ...base, lastLoudAt };
  if (!loud && elapsedMs - lastLoudAt >= TRAIL_MS[config.sensitivity]) {
    return stopped(next, 'silence', elapsedMs);
  }
  return { state: next, stop: null };
}

/** The user tapped the mic while recording, or released a hold. */
export function endpointManualStop(
  state: EndpointState,
  elapsedMs: number,
  reason: 'manual' | 'hold' = 'manual',
): EndpointDecision {
  if (state.phase === 'stopped') return { state, stop: null };
  return stopped({ ...state, elapsedMs }, reason, elapsedMs);
}

/**
 * Convenience for tests and the lab: run a whole synthetic stream and
 * return the first stop decision (or null when the stream ended armed/speaking).
 */
export function runEndpointStream(
  events: readonly LevelEvent[],
  config: EndpointConfig,
): { stop: EndpointDecision['stop']; state: EndpointState; stoppedAtIndex: number | null } {
  let state = INITIAL_ENDPOINT;
  for (let i = 0; i < events.length; i++) {
    const d = endpointStep(state, events[i]!, config);
    state = d.state;
    if (d.stop) return { stop: d.stop, state, stoppedAtIndex: i };
  }
  return { stop: null, state, stoppedAtIndex: null };
}
