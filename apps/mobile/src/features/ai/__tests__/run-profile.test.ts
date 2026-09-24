import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTING_KEYS } from '@/db/repositories/settings';

import {
  DEFAULT_GRAMMAR_PRESET,
  DEFAULT_MODEL_TABLE,
  EFFORT_ORDER,
  EFFORT_TO_ANTHROPIC,
  EFFORT_TO_OPENAI,
  EMPTY_GRAMMAR_STATS,
  estimateFromStats,
  estimateRun,
  formatEstimate,
  getGrammarPreset,
  getModelTable,
  LESSON_MAX_TOKENS,
  MODEL_HINTS,
  ModelTableSchema,
  PROFILE_MAX_TOKENS,
  QUALITY_ORDER,
  recordRunReceipt,
  resolveRun,
  sanitizeModelTable,
  sanitizeProfile,
  sanitizeStats,
  setGrammarPreset,
  setModelTable,
  statsKey,
  timeoutFor,
  type AiEffort,
  type AiRunProfile,
  type GrammarStats,
} from '../run-profile';

const settingsStore = vi.hoisted(() => new Map<string, unknown>());

// config.ts (ModelSchema) pulls expo-secure-store → react-native; stub it out.
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

const P = (patch: Partial<AiRunProfile>): AiRunProfile => ({ ...DEFAULT_GRAMMAR_PRESET, ...patch });

describe('resolveRun (WORD_FORMS §4.2)', () => {
  it.each(EFFORT_ORDER)('anthropic × %s → verbosity + reasoning.exclude + usage', (effort) => {
    const run = resolveRun(P({ provider: 'anthropic', effort }), DEFAULT_MODEL_TABLE);
    expect(run.model).toBe('anthropic/claude-opus-5.5');
    expect(run.extras).toEqual({
      verbosity: EFFORT_TO_ANTHROPIC[effort],
      reasoning: { enabled: true, exclude: true },
      usage: { include: true },
    });
    expect(run.profile).toEqual(P({ provider: 'anthropic', effort }));
  });

  it.each(EFFORT_ORDER)('openai × %s → reasoning.effort + usage, no verbosity', (effort) => {
    const run = resolveRun(P({ provider: 'openai', effort }), DEFAULT_MODEL_TABLE);
    expect(run.model).toBe('openai/gpt-6-sol-pro');
    expect(run.extras).toEqual({
      reasoning: { effort: EFFORT_TO_OPENAI[effort], exclude: true },
      usage: { include: true },
    });
    expect(run.extras).not.toHaveProperty('verbosity');
  });

  it('ultra maps to the shared xhigh value on both providers', () => {
    expect(EFFORT_TO_ANTHROPIC.ultra).toBe('xhigh');
    expect(EFFORT_TO_OPENAI.ultra).toBe('xhigh');
    const effortsAll: AiEffort[] = ['low', 'medium', 'high', 'ultra'];
    expect(effortsAll.map((e) => EFFORT_TO_OPENAI[e])).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('reads the model from the (possibly edited) table, per quality notch', () => {
    const table = structuredClone(DEFAULT_MODEL_TABLE);
    table.openai.fast = 'openai/gpt-6-terra';
    expect(resolveRun(P({ provider: 'openai', quality: 'fast' }), table).model).toBe(
      'openai/gpt-6-terra',
    );
    for (const quality of QUALITY_ORDER) {
      expect(resolveRun(P({ quality }), DEFAULT_MODEL_TABLE).model).toBe(
        DEFAULT_MODEL_TABLE.anthropic[quality],
      );
    }
  });

  it('defaults + hints follow decision 3', () => {
    expect(DEFAULT_GRAMMAR_PRESET).toEqual({
      provider: 'anthropic',
      quality: 'normal',
      effort: 'high',
    });
    expect(DEFAULT_MODEL_TABLE.anthropic.best).toBe('anthropic/claude-fable-5.1');
    expect(DEFAULT_MODEL_TABLE.openai.fastest).toBe('openai/gpt-6-luna');
    expect(MODEL_HINTS.openai.best).toBe('GPT-6 Astra');
    // Prices are never hardcoded (they drift).
    for (const row of Object.values(MODEL_HINTS)) {
      for (const hint of Object.values(row)) expect(hint).not.toMatch(/\$/);
    }
  });
});

describe('timeouts + token budgets (§4.3)', () => {
  it('240 s for Best or Ultra, 150 s otherwise', () => {
    expect(timeoutFor(P({ quality: 'best', effort: 'low' }))).toBe(240_000);
    expect(timeoutFor(P({ quality: 'fastest', effort: 'ultra' }))).toBe(240_000);
    expect(timeoutFor(P({ quality: 'best', effort: 'ultra' }))).toBe(240_000);
    expect(timeoutFor(P({ quality: 'normal', effort: 'high' }))).toBe(150_000);
    expect(timeoutFor(P({ quality: 'fastest', effort: 'low' }))).toBe(150_000);
  });

  it('exposes the budget constants', () => {
    expect(PROFILE_MAX_TOKENS).toBe(16_384);
    expect(LESSON_MAX_TOKENS).toBe(12_288);
  });
});

describe('preset healing (§2.4, field-by-field)', () => {
  it('heals one bad field to its default only', () => {
    expect(sanitizeProfile({ provider: 'openai', quality: 'fast', effort: 'huge' })).toEqual({
      provider: 'openai',
      quality: 'fast',
      effort: 'high',
    });
    expect(sanitizeProfile({ provider: 'google', quality: 'best', effort: 'low' })).toEqual({
      provider: 'anthropic',
      quality: 'best',
      effort: 'low',
    });
    expect(sanitizeProfile('garbage')).toEqual(DEFAULT_GRAMMAR_PRESET);
    expect(sanitizeProfile(null)).toEqual(DEFAULT_GRAMMAR_PRESET);
  });

  it('getGrammarPreset defaults without a row; set writes { v: 1, … }', async () => {
    expect(await getGrammarPreset()).toEqual(DEFAULT_GRAMMAR_PRESET);
    await setGrammarPreset(P({ provider: 'openai', effort: 'ultra' }));
    expect(settingsStore.get(SETTING_KEYS.aiGrammarPreset)).toEqual({
      v: 1,
      provider: 'openai',
      quality: 'normal',
      effort: 'ultra',
    });
    expect(await getGrammarPreset()).toEqual(P({ provider: 'openai', effort: 'ultra' }));
  });

  it('a corrupt stored row heals on read', async () => {
    settingsStore.set(SETTING_KEYS.aiGrammarPreset, { v: 1, provider: 'openai', quality: 7 });
    expect(await getGrammarPreset()).toEqual({
      provider: 'openai',
      quality: 'normal',
      effort: 'high',
    });
  });
});

describe('model table healing (§2.4, slug-by-slug)', () => {
  it('one bad slug heals to that slug’s default only', () => {
    const raw = structuredClone(DEFAULT_MODEL_TABLE) as Record<string, Record<string, unknown>>;
    raw.anthropic!.fast = 'not a slug';
    raw.openai!.best = 'openai/gpt-6-terra';
    const healed = sanitizeModelTable(raw);
    expect(healed.anthropic.fast).toBe(DEFAULT_MODEL_TABLE.anthropic.fast);
    expect(healed.openai.best).toBe('openai/gpt-6-terra'); // well-formed unknown slug is kept
    expect(healed.anthropic.normal).toBe(DEFAULT_MODEL_TABLE.anthropic.normal);
    expect(healed.openai.fast).toBe(DEFAULT_MODEL_TABLE.openai.fast);
  });

  it('a missing provider row or non-object heals to defaults entirely', () => {
    expect(sanitizeModelTable({ anthropic: { best: 'anthropic/claude-fable-5.1' } })).toEqual({
      anthropic: DEFAULT_MODEL_TABLE.anthropic,
      openai: DEFAULT_MODEL_TABLE.openai,
    });
    expect(sanitizeModelTable(42)).toEqual(DEFAULT_MODEL_TABLE);
  });

  it('getModelTable defaults (a fresh copy) without a row; set refuses a malformed slug', async () => {
    const table = await getModelTable();
    expect(table).toEqual(DEFAULT_MODEL_TABLE);
    expect(table).not.toBe(DEFAULT_MODEL_TABLE);

    table.openai.fast = 'nope';
    expect(await setModelTable(table)).toBe(false);
    expect(settingsStore.has(SETTING_KEYS.aiModelTable)).toBe(false);

    table.openai.fast = 'openai/gpt-6-sol';
    table.anthropic.best = 'anthropic/claude-fable-5.2';
    expect(await setModelTable(table)).toBe(true);
    expect(settingsStore.get(SETTING_KEYS.aiModelTable)).toEqual({ v: 1, ...table });
    expect((await getModelTable()).anthropic.best).toBe('anthropic/claude-fable-5.2');
  });

  it('ModelTableSchema requires v:1 and all eight slugs', () => {
    expect(ModelTableSchema.safeParse({ v: 1, ...DEFAULT_MODEL_TABLE }).success).toBe(true);
    expect(ModelTableSchema.safeParse({ v: 2, ...DEFAULT_MODEL_TABLE }).success).toBe(false);
    const partial = structuredClone(DEFAULT_MODEL_TABLE) as Record<string, Record<string, unknown>>;
    delete partial.openai!.luna;
    delete partial.openai!.fastest;
    expect(ModelTableSchema.safeParse({ v: 1, ...partial }).success).toBe(false);
  });
});

describe('receipts + estimate (§2.4 grammar.stats)', () => {
  const profile = P({ provider: 'openai', quality: 'fast', effort: 'low' });

  it('statsKey is provider:quality:effort:purpose', () => {
    expect(statsKey('profile', profile)).toBe('openai:fast:low:profile');
    expect(statsKey('lesson', DEFAULT_GRAMMAR_PRESET)).toBe('anthropic:normal:high:lesson');
  });

  it('recordRunReceipt accumulates per bucket and is pure', () => {
    const s1 = recordRunReceipt(EMPTY_GRAMMAR_STATS, 'profile', profile, {
      ms: 40_000,
      costUsd: 0.1,
      completionTokens: 3000,
    });
    expect(EMPTY_GRAMMAR_STATS.runs).toEqual({});
    const s2 = recordRunReceipt(s1, 'profile', profile, { ms: 50_000, costUsd: 0.12 });
    const s3 = recordRunReceipt(s2, 'lesson', profile, { ms: 10_000, costUsd: 0.02 });
    expect(s1.runs['openai:fast:low:profile']).toEqual({
      n: 1,
      totalMs: 40_000,
      totalCostUsd: 0.1,
      totalCompletionTokens: 3000,
    });
    expect(s3.runs['openai:fast:low:profile']).toEqual({
      n: 2,
      totalMs: 90_000,
      totalCostUsd: 0.22,
      totalCompletionTokens: 3000,
    });
    expect(s3.runs['openai:fast:low:lesson']!.n).toBe(1);
    expect(Object.keys(s3.runs)).toHaveLength(2);
  });

  it('estimateFromStats averages and returns null for an empty bucket', () => {
    const stats = recordRunReceipt(
      recordRunReceipt(EMPTY_GRAMMAR_STATS, 'profile', profile, { ms: 30_000, costUsd: 0.1 }),
      'profile',
      profile,
      { ms: 60_000, costUsd: 0.12 },
    );
    expect(estimateFromStats(stats, 'profile', profile)).toEqual({
      ms: 45_000,
      costUsd: 0.11,
      n: 2,
    });
    expect(estimateFromStats(stats, 'lesson', profile)).toBeNull();
    expect(estimateFromStats(stats, 'profile', DEFAULT_GRAMMAR_PRESET)).toBeNull();
    const zero: GrammarStats = {
      v: 1,
      runs: {
        [statsKey('profile', profile)]: {
          n: 0,
          totalMs: 0,
          totalCostUsd: 0,
          totalCompletionTokens: 0,
        },
      },
    };
    expect(estimateFromStats(zero, 'profile', profile)).toBeNull();
  });

  it('estimateRun reads grammar.stats and heals a malformed bucket', async () => {
    expect(await estimateRun('profile', profile)).toBeNull();
    settingsStore.set(SETTING_KEYS.grammarStats, {
      v: 1,
      runs: {
        'openai:fast:low:profile': {
          n: 3,
          totalMs: 90_000,
          totalCostUsd: 0.3,
          totalCompletionTokens: 9,
        },
        'anthropic:normal:high:profile': { n: 'x' },
      },
    });
    const est = await estimateRun('profile', profile);
    expect(est?.ms).toBe(30_000);
    expect(est?.n).toBe(3);
    expect(est?.costUsd).toBeCloseTo(0.1, 10);
    expect(await estimateRun('profile', DEFAULT_GRAMMAR_PRESET)).toBeNull();
    expect(sanitizeStats('junk')).toEqual({ v: 1, runs: {} });
  });

  it('formatEstimate renders the sheet line and never a number without receipts', () => {
    expect(formatEstimate(null)).toBe('No data for this setting yet — the first run measures it');
    expect(formatEstimate({ ms: 45_000, costUsd: 0.11, n: 6 })).toBe(
      '~$0.11 · ~45 s · from 6 runs',
    );
    expect(formatEstimate({ ms: 4_000, costUsd: 0.002, n: 1 })).toBe('< $0.01 · ~4 s · from 1 run');
    // Batch: multiplied by the count.
    expect(formatEstimate({ ms: 45_000, costUsd: 0.11, n: 6 }, 37)).toBe(
      '~$4.07 · ~28 min · from 6 runs',
    );
  });
});
