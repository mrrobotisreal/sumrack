import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import { DEFAULT_MODEL, getModel, MODEL_OPTIONS, setModel } from '../config';

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
    },
  },
}));

beforeEach(() => settingsStore.clear());

describe('legacy AI model picker (T16; defaults 2026-10-05)', () => {
  it('defaults to Opus 5.5 and offers Opus 5.5 · Sonnet 5.5 · Haiku 4.5 in that order', async () => {
    expect(DEFAULT_MODEL).toBe('anthropic/claude-opus-5.5');
    expect(MODEL_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ['anthropic/claude-opus-5.5', 'Claude Opus 5.5'],
      ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5'],
      ['anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'],
    ]);
    expect(await getModel()).toBe(DEFAULT_MODEL);
  });

  it('maps a stored retired id onto its curated successor', async () => {
    settingsStore.set(SETTING_KEYS.aiModel, 'anthropic/claude-sonnet-5');
    expect(await getModel()).toBe('anthropic/claude-opus-5.5');
    settingsStore.set(SETTING_KEYS.aiModel, 'anthropic/claude-opus-5');
    expect(await getModel()).toBe('anthropic/claude-opus-5.5');
  });

  it('keeps a curated or custom stored id as is; a malformed one falls back to the default', async () => {
    expect(await setModel('anthropic/claude-sonnet-5.5')).toBe(true);
    expect(await getModel()).toBe('anthropic/claude-sonnet-5.5');
    settingsStore.set(SETTING_KEYS.aiModel, 'openai/gpt-6-sol');
    expect(await getModel()).toBe('openai/gpt-6-sol');
    settingsStore.set(SETTING_KEYS.aiModel, 'not a slug');
    expect(await getModel()).toBe(DEFAULT_MODEL);
  });
});
