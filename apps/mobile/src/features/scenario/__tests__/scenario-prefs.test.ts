import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCENARIO_PREFS,
  parseScenarioPrefs,
  ScenarioPrefsSchema,
} from '../store/scenario-prefs-core';

describe('scenario.prefs sanitize (T62, §4.4)', () => {
  it('returns the defaults for null / garbage / wrong types', () => {
    expect(parseScenarioPrefs(null)).toEqual(DEFAULT_SCENARIO_PREFS);
    expect(parseScenarioPrefs(undefined)).toEqual(DEFAULT_SCENARIO_PREFS);
    expect(parseScenarioPrefs('nope')).toEqual(DEFAULT_SCENARIO_PREFS);
    expect(parseScenarioPrefs(42)).toEqual(DEFAULT_SCENARIO_PREFS);
    expect(parseScenarioPrefs([])).toEqual(DEFAULT_SCENARIO_PREFS);
  });

  it('accepts a fully valid object unchanged', () => {
    const valid = {
      v: 1,
      subtitles: true,
      holdToTalk: true,
      rescueOnline: false,
      endpointSensitivity: 'patient',
      bedVolume: 0.25,
    };
    expect(parseScenarioPrefs(valid)).toEqual(valid);
    expect(ScenarioPrefsSchema.safeParse(valid).success).toBe(true);
  });

  it('heals field-by-field: a bad field falls to its default, the good ones survive', () => {
    expect(
      parseScenarioPrefs({
        v: 1,
        subtitles: 'yes',
        holdToTalk: true,
        rescueOnline: 1,
        endpointSensitivity: 'instant',
        bedVolume: 7,
      }),
    ).toEqual({
      v: 1,
      subtitles: false,
      holdToTalk: true,
      rescueOnline: true,
      endpointSensitivity: 'normal',
      bedVolume: 0.6,
    });
  });

  it('rejects out-of-range and non-finite volumes', () => {
    expect(parseScenarioPrefs({ bedVolume: -0.1 }).bedVolume).toBe(0.6);
    expect(parseScenarioPrefs({ bedVolume: 1.01 }).bedVolume).toBe(0.6);
    expect(parseScenarioPrefs({ bedVolume: Number.NaN }).bedVolume).toBe(0.6);
    expect(parseScenarioPrefs({ bedVolume: Number.POSITIVE_INFINITY }).bedVolume).toBe(0.6);
    expect(parseScenarioPrefs({ bedVolume: 0 }).bedVolume).toBe(0);
    expect(parseScenarioPrefs({ bedVolume: 1 }).bedVolume).toBe(1);
  });

  it('ignores unknown keys and a wrong version (forward-compatible heal)', () => {
    const healed = parseScenarioPrefs({ v: 2, subtitles: true, lowPower: true });
    expect(healed).toEqual({ ...DEFAULT_SCENARIO_PREFS, subtitles: true });
    expect('lowPower' in healed).toBe(false);
  });

  it('the strict schema rejects what the healer accepts (the boundary is the healer)', () => {
    expect(ScenarioPrefsSchema.safeParse({ v: 1, subtitles: true }).success).toBe(false);
    expect(ScenarioPrefsSchema.safeParse({ ...DEFAULT_SCENARIO_PREFS, extra: 1 }).success).toBe(
      false,
    );
  });
});
