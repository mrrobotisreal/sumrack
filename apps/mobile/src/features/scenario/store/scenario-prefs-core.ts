import { z } from 'zod';

/**
 * The pure half of `scenario.prefs` (T62, SPEAKING_SCENARIOS §4.4): types,
 * defaults, the strict schema and the field-by-field healer. No DB/React
 * imports so the sanitize tests run in Node (the T19 goal-prefs split).
 */

export const ENDPOINT_SENSITIVITIES = ['quick', 'normal', 'patient'] as const;
export type EndpointSensitivityPref = (typeof ENDPOINT_SENSITIVITIES)[number];

export interface ScenarioPrefs {
  v: 1;
  /** «Subtitles (training wheels)»: host lines as karaoke-washed text (§1.3 decision 6). */
  subtitles: boolean;
  /** Hold-to-talk is the primary mic gesture (tap still endpoints). */
  holdToTalk: boolean;
  /** Let an online fast model rescue an offline miss (§1.3 decision 1). */
  rescueOnline: boolean;
  endpointSensitivity: EndpointSensitivityPref;
  /** Scene bed volume 0–1 before the 35 % speech duck. */
  bedVolume: number;
}

export const DEFAULT_SCENARIO_PREFS: ScenarioPrefs = {
  v: 1,
  subtitles: false,
  holdToTalk: false,
  rescueOnline: true,
  endpointSensitivity: 'normal',
  bedVolume: 0.6,
};

const FieldSchemas = {
  subtitles: z.boolean(),
  holdToTalk: z.boolean(),
  rescueOnline: z.boolean(),
  endpointSensitivity: z.enum(ENDPOINT_SENSITIVITIES),
  bedVolume: z.number().finite().min(0).max(1),
} as const;

export const ScenarioPrefsSchema = z.strictObject({ v: z.literal(1), ...FieldSchemas });

/** Heal any stored value to a valid prefs object, one field at a time. */
export function parseScenarioPrefs(raw: unknown): ScenarioPrefs {
  const whole = ScenarioPrefsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const value = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof typeof FieldSchemas>(key: K): ScenarioPrefs[K] => {
    const parsed = FieldSchemas[key].safeParse(value[key]);
    return (parsed.success ? parsed.data : DEFAULT_SCENARIO_PREFS[key]) as ScenarioPrefs[K];
  };
  return {
    v: 1,
    subtitles: pick('subtitles'),
    holdToTalk: pick('holdToTalk'),
    rescueOnline: pick('rescueOnline'),
    endpointSensitivity: pick('endpointSensitivity'),
    bedVolume: pick('bedVolume'),
  };
}
