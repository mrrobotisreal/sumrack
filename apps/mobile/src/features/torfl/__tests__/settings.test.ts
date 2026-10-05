import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import {
  DEFAULT_EXAM_GRADING_PRESET,
  DEFAULT_TORFL_PREFS,
  parseExamDate,
  parseTorflPrefs,
  sanitizeExamGradingPreset,
} from '../settings-core';
import {
  getExamDate,
  getExamGradingPreset,
  getTorflPrefs,
  setExamDate,
  setExamGradingPreset,
  setTorflPrefs,
} from '../settings';

const settingsStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('@/db', () => ({
  repos: {
    settings: {
      get: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        settingsStore.set(key, value);
      }),
      remove: vi.fn(async (key: string) => {
        settingsStore.delete(key);
      }),
    },
  },
}));

beforeEach(() => settingsStore.clear());

describe('SETTING_KEYS (T68)', () => {
  it('declares the three torfl keys', () => {
    expect(SETTING_KEYS.torflPrefs).toBe('torfl.prefs');
    expect(SETTING_KEYS.torflExamDate).toBe('torfl.examDate');
    expect(SETTING_KEYS.torflGradingPreset).toBe('torfl.gradingPreset');
  });
});

describe('torfl.prefs healing', () => {
  it('defaults match TORFL §4.4', () => {
    expect(DEFAULT_TORFL_PREFS).toEqual({
      v: 1,
      showEnglishInstructions: true,
      drillTimer: 'off',
      breakBetweenSubtests: true,
      allowLookupInMockReading: true,
    });
  });

  it.each([null, undefined, 'garbage', 42, [], '{"v":1'])('%j heals to the defaults', (raw) => {
    expect(parseTorflPrefs(raw)).toEqual(DEFAULT_TORFL_PREFS);
  });

  it('heals field-by-field: a bad drillTimer never resets the other fields', () => {
    expect(
      parseTorflPrefs({
        v: 7,
        showEnglishInstructions: false,
        drillTimer: 'turbo',
        breakBetweenSubtests: 'yes',
        allowLookupInMockReading: false,
        extra: 1,
      }),
    ).toEqual({
      v: 1,
      showEnglishInstructions: false,
      drillTimer: 'off',
      breakBetweenSubtests: true,
      allowLookupInMockReading: false,
    });
  });

  it('a valid value passes through untouched', () => {
    const v = { ...DEFAULT_TORFL_PREFS, drillTimer: 'exam-pace' as const };
    expect(parseTorflPrefs(v)).toEqual(v);
  });

  it('accessor reads healed and writes merged patches', async () => {
    expect(await getTorflPrefs()).toEqual(DEFAULT_TORFL_PREFS);
    settingsStore.set('torfl.prefs', { drillTimer: 99, showEnglishInstructions: false });
    expect(await getTorflPrefs()).toMatchObject({
      drillTimer: 'off',
      showEnglishInstructions: false,
    });
    const next = await setTorflPrefs({ drillTimer: 'exam-pace' });
    expect(next).toMatchObject({ drillTimer: 'exam-pace', showEnglishInstructions: false });
    expect(settingsStore.get('torfl.prefs')).toEqual(next);
  });
});

describe('torfl.examDate healing', () => {
  it.each([
    ['2026-12-05', '2026-12-05'],
    ['2026-02-30', null],
    ['2026-1-5', null],
    ['tomorrow', null],
    [20261205, null],
    [null, null],
    [{ date: '2026-12-05' }, null],
  ])('%j → %j', (raw, expected) => {
    expect(parseExamDate(raw)).toBe(expected);
  });

  it('accessor sets, heals and clears', async () => {
    expect(await getExamDate()).toBeNull();
    await setExamDate('2026-12-05');
    expect(await getExamDate()).toBe('2026-12-05');
    await expect(setExamDate('2026-13-01')).rejects.toThrow();
    settingsStore.set('torfl.examDate', 'garbage');
    expect(await getExamDate()).toBeNull();
    await setExamDate(null);
    expect(settingsStore.has('torfl.examDate')).toBe(false);
  });
});

describe('torfl.gradingPreset healing', () => {
  it('default = Anthropic · normal · high (ADR-0020 decision 10)', () => {
    expect(DEFAULT_EXAM_GRADING_PRESET).toEqual({
      provider: 'anthropic',
      quality: 'normal',
      effort: 'high',
    });
  });

  it('heals field-by-field against the given fallback; stores only the triple', () => {
    const fallback = {
      provider: 'openai' as const,
      quality: 'normal' as const,
      effort: 'high' as const,
    };
    expect(sanitizeExamGradingPreset('nope', fallback)).toEqual(fallback);
    expect(
      sanitizeExamGradingPreset(
        { provider: 'mistral', quality: 'best', effort: 9, model: 'x' },
        fallback,
      ),
    ).toEqual({ provider: 'openai', quality: 'best', effort: 'high' });
  });

  it('accessor: absent → provider follows the grammar preset, quality normal, effort high', async () => {
    expect(await getExamGradingPreset()).toEqual(DEFAULT_EXAM_GRADING_PRESET);
    settingsStore.set('ai.grammarPreset', {
      v: 1,
      provider: 'openai',
      quality: 'fast',
      effort: 'low',
    });
    expect(await getExamGradingPreset()).toEqual({
      provider: 'openai',
      quality: 'normal',
      effort: 'high',
    });
    settingsStore.set('torfl.gradingPreset', { v: 1, provider: 'anthropic', quality: 'zzz' });
    expect(await getExamGradingPreset()).toEqual({
      provider: 'anthropic',
      quality: 'normal',
      effort: 'high',
    });
    await setExamGradingPreset({ provider: 'anthropic', quality: 'best', effort: 'ultra' });
    expect(settingsStore.get('torfl.gradingPreset')).toEqual({
      v: 1,
      provider: 'anthropic',
      quality: 'best',
      effort: 'ultra',
    });
  });
});
