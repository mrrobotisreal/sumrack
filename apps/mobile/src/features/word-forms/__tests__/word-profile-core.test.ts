import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { AiError } from '@/features/ai/errors';
import { statsKey, type AiRunProfile } from '@/features/ai/run-profile';
import type { RunChatResult } from '@/features/ai/runner';
import { extractJsonObject } from '@/features/ai/schemas';

import { validateProfile } from '../profile-core';
import { WordProfileSchema } from '../profile-schema';
import { generateProfile, parseProfileAnswer, type ProfileChat } from '../profile-service';
import { cell, verbProfile } from './fixtures';

/**
 * T52 service tests (WORD_FORMS §5.5, §6.3): the four CAPTURED fixtures run
 * through the exact production path (extractJsonObject → Zod → validator),
 * and a hand-authored malformed→corrected pair proves the one correction
 * round through an injected transport against a real in-memory DB. No
 * network anywhere.
 */

const track = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track }));
// runner → config → expo-secure-store (native): stub it like runner.test.ts does.
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
// The service (and T51's run-profile accessors) reach the DB through `repos`;
// give them a real better-sqlite3-backed repository set instead of the native one.
const testRepos = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/db', () => ({
  get repos() {
    return testRepos.current;
  },
}));

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ai/__tests__/__fixtures__',
);
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as T;
}
interface CapturedProfile {
  input: { headword: string; kind: 'word' | 'phrase' };
  model: string;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
}

describe('captured word-profile fixtures parse through the production path', () => {
  for (const [name, pos] of [
    ['word-profile-verb.json', 'verb'],
    ['word-profile-noun.json', 'noun'],
    ['word-profile-adj.json', 'adj'],
    ['word-profile-phrase.json', 'phrase'],
  ] as const) {
    it(`${name} → extractJsonObject → Zod → validateProfile is ok (pos ${pos})`, () => {
      const fx = fixture<CapturedProfile>(name);
      const content = fx.choices[0]!.message.content;
      const json = extractJsonObject(content);
      expect(json).not.toBeNull();
      const parsed = WordProfileSchema.safeParse(json);
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(
        true,
      );
      if (!parsed.success) return;
      expect(parsed.data.pos).toBe(pos);
      expect(parsed.data.kind).toBe(fx.input.kind);
      expect(parsed.data.headword.plain).toBe(fx.input.headword);
      const result = validateProfile(parsed.data);
      expect(result.issues).toEqual([]);
      // The same thing the service does, in one call.
      const attempt = parseProfileAnswer(content);
      expect(attempt.ok).toBe(true);
      // The fixture carries the usage envelope the T51 parser reads (client.test.ts).
      expect(fx.usage?.completion_tokens).toBeGreaterThan(0);
      expect(fx.choices[0]!.finish_reason).toBe('stop');
    });
  }
});

describe('parseProfileAnswer', () => {
  it('non-JSON, Zod failures and validator failures each yield issue lists', () => {
    expect(parseProfileAnswer('sorry, no')).toEqual({
      ok: false,
      issues: ['the answer is not a single JSON object'],
    });
    const zod = parseProfileAnswer('{"v":1}');
    expect(zod.ok).toBe(false);
    if (!zod.ok) expect(zod.issues.some((i) => i.startsWith('language:'))).toBe(true);
    const bad = verbProfile();
    bad.sections[0]!.grid!.cells[0] = [cell('говорю́')];
    const structural = parseProfileAnswer(`\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``);
    expect(structural).toEqual({
      ok: false,
      issues: ['sections[0].grid.cells[0]: expected 2 columns, got 1'],
    });
    const good = parseProfileAnswer(`Here you go:\n${JSON.stringify(verbProfile())}`);
    expect(good.ok).toBe(true);
  });
});

const RUN: AiRunProfile = { provider: 'anthropic', quality: 'normal', effort: 'high' };

function reply(content: string, extra: Partial<RunChatResult> = {}): RunChatResult {
  return {
    content,
    model: 'anthropic/claude-opus-5.5',
    usage: { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 300, costUsd: 0.02 },
    finishReason: 'stop',
    effortApplied: true,
    ...extra,
  };
}

describe('generateProfile — the one correction round (§5.5 step 3)', () => {
  let repos: ReturnType<typeof createRepositories>;
  beforeEach(() => {
    track.mockClear();
    repos = createRepositories(createTestDb());
    testRepos.current = repos;
  });

  async function seedVerb() {
    const added = await repos.bank.addWord({
      lemma: 'говорить',
      surface: 'говорил',
      translation: 'to speak',
      grammar: 'past, masc.',
      pos: 'verb',
      level: 'A1',
    });
    return added.item;
  }

  it('malformed first answer → correction turn with the verbatim issues → corrected answer stored with the summed receipt', async () => {
    const item = await seedVerb();
    // First answer: two issues — a wrong column count and a Latin letter in a form.
    const malformed = verbProfile();
    malformed.sections[0]!.grid!.cells[4] = [cell('говори́те')];
    malformed.sections[4]!.rows![0] = { ru: 'govorya', plain: 'govorya', gloss: 'while speaking' };
    const corrected = verbProfile();

    const calls: Parameters<ProfileChat>[] = [];
    const chat: ProfileChat = async (req, run) => {
      calls.push([req, run]);
      return calls.length === 1
        ? reply(JSON.stringify(malformed))
        : reply(JSON.stringify(corrected), {
            usage: { promptTokens: 4000, completionTokens: 2500, costUsd: 0.03 },
          });
    };

    const result = await generateProfile(item, RUN, { contexts: ['Он говорил тихо.'] }, chat);
    expect(result.corrected).toBe(true);
    expect(result.profile.headword.plain).toBe('говорить');
    expect(calls).toHaveLength(2);

    // Call 1: the §6.1 messages with the run resolved from the default table.
    const [first, run] = calls[0]!;
    expect(run.model).toBe('anthropic/claude-opus-5.5');
    expect(run.extras).toMatchObject({ verbosity: 'high', usage: { include: true } });
    expect(first.maxTokens).toBe(16_384);
    expect(first.temperature).toBe(0.2);
    expect(first.timeoutMs).toBe(150_000);
    expect(first.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(first.messages[1]!.content).toContain('Profile this Russian word: «говорить»');
    expect(first.messages[1]!.content).toContain('- «Он говорил тихо.»');

    // Call 2: first messages + the raw assistant answer + the exact issues.
    const [second] = calls[1]!;
    expect(second.messages.slice(0, 2)).toEqual(first.messages);
    expect(second.messages[2]).toEqual({ role: 'assistant', content: JSON.stringify(malformed) });
    expect(second.messages[3]!.content.split('\n')).toEqual([
      'Your JSON failed validation. Fix ONLY these issues and return the complete corrected JSON:',
      '- sections[0].grid.cells[4]: expected 2 columns, got 1',
      '- sections[4].rows[0].plain: a form may contain only Cyrillic letters, spaces and -/(),.…!?«» — no Latin letters, digits or labels (got "govorya")',
    ]);

    // Stored as current, receipt = both calls summed.
    const current = await repos.wordForms.getCurrentProfile('говорить', 'word');
    expect(current?.id).toBe(result.row.id);
    expect(current).toMatchObject({
      headword: 'говорить',
      pos: 'verb',
      provider: 'anthropic',
      model: 'anthropic/claude-opus-5.5',
      quality: 'normal',
      effort: 'high',
      effortApplied: true,
      promptTokens: 5000,
      completionTokens: 4500,
      reasoningTokens: 300,
      costUsd: 0.05,
    });
    expect(current!.durationMs).toBeGreaterThanOrEqual(0);

    // grammar.stats got one receipt in the right bucket.
    const stats = (await repos.settings.get<{
      runs: Record<string, { n: number; totalCostUsd: number; totalCompletionTokens: number }>;
    }>(SETTING_KEYS.grammarStats))!;
    const bucket = stats.runs[statsKey('profile', RUN)]!;
    expect(bucket).toMatchObject({ n: 1, totalCostUsd: 0.05, totalCompletionTokens: 4500 });

    // Events: requested → invalid_retry {issues: 2} → generated (no failed).
    const names = track.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'word_profile_requested',
      'word_profile_invalid_retry',
      'word_profile_generated',
    ]);
    expect(track).toHaveBeenCalledWith('word_profile_requested', {
      kind: 'word',
      provider: 'anthropic',
      quality: 'normal',
      effort: 'high',
      regenerate: false,
    });
    expect(track).toHaveBeenCalledWith('word_profile_invalid_retry', { issues: 2 });
    expect(track).toHaveBeenCalledWith(
      'word_profile_generated',
      expect.objectContaining({
        kind: 'word',
        pos: 'verb',
        sections: 7,
        corrected: true,
        costUsd: 0.05,
      }),
    );
    // Never Russian text in props.
    for (const [, props] of track.mock.calls) {
      for (const v of Object.values(props ?? {})) expect(String(v)).not.toMatch(/[а-яё]/i);
    }
  });

  it('a clean first answer needs no correction; a second generation versions the key (regenerate: true)', async () => {
    const item = await seedVerb();
    const chat: ProfileChat = async () => reply(JSON.stringify(verbProfile()));
    const a = await generateProfile(item, RUN, { contexts: [] }, chat);
    expect(a.corrected).toBe(false);
    expect(a.warnings).toEqual([]);
    const b = await generateProfile(item, RUN, { contexts: [] }, chat);
    const versions = await repos.wordForms.listProfileVersions('говорить', 'word');
    expect(versions.map((v) => [v.id, v.isCurrent])).toEqual([
      [b.row.id, true],
      [a.row.id, false],
    ]);
    expect(track).toHaveBeenCalledWith(
      'word_profile_requested',
      expect.objectContaining({ regenerate: true }),
    );
    expect(track).not.toHaveBeenCalledWith('word_profile_invalid_retry', expect.anything());
    const stats = (await repos.settings.get<{ runs: Record<string, { n: number }> }>(
      SETTING_KEYS.grammarStats,
    ))!;
    expect(stats.runs[statsKey('profile', RUN)]!.n).toBe(2);
  });

  it('still invalid after the correction round → AiError invalid-response, nothing stored, word_profile_failed', async () => {
    const item = await seedVerb();
    const bad = verbProfile();
    bad.sections[0]!.grid!.cells[4] = [cell('говори́те')];
    let n = 0;
    const chat: ProfileChat = async () => {
      n++;
      return reply(JSON.stringify(bad));
    };
    await expect(generateProfile(item, RUN, { contexts: [] }, chat)).rejects.toMatchObject({
      name: 'AiError',
      code: 'invalid-response',
    });
    expect(n).toBe(2); // exactly one correction round, never a third call
    expect(await repos.wordForms.countProfiles()).toEqual({ total: 0, current: 0, keys: 0 });
    expect(await repos.settings.get(SETTING_KEYS.grammarStats)).toBeNull();
    expect(track).toHaveBeenCalledWith(
      'word_profile_failed',
      expect.objectContaining({ kind: 'word', code: 'invalid-response' }),
    );
  });

  it('transport errors pass through with their code; effortApplied=false is carried onto the row', async () => {
    const item = await seedVerb();
    const chat: ProfileChat = async () => {
      throw new AiError('http-rate', 'slow down', 429);
    };
    await expect(generateProfile(item, RUN, { contexts: [] }, chat)).rejects.toMatchObject({
      code: 'http-rate',
    });
    expect(track).toHaveBeenCalledWith(
      'word_profile_failed',
      expect.objectContaining({ code: 'http-rate' }),
    );

    const fallback: ProfileChat = async () =>
      reply(JSON.stringify(verbProfile()), { effortApplied: false, usage: undefined });
    const r = await generateProfile(
      item,
      { ...RUN, provider: 'openai', quality: 'fast' },
      { contexts: [] },
      fallback,
    );
    expect(r.row).toMatchObject({
      effortApplied: false,
      provider: 'openai',
      model: 'openai/gpt-6-sol',
      promptTokens: null,
      costUsd: null,
    });
  });

  it('a lemma-less word has no key → invalid-response before any call; phrases key on normalized', async () => {
    const chat = vi.fn<ProfileChat>();
    await expect(
      generateProfile(
        {
          id: 'x',
          kind: 'word',
          lemma: null,
          lemmaNorm: null,
          surface: 'чего-то',
          normalized: 'чего-то',
          translation: '',
          grammar: null,
          pos: null,
          level: null,
          sourceSentenceId: null,
          sourceStoryId: null,
          note: null,
          needsEnrichment: true,
          createdAt: 0,
        },
        RUN,
        { contexts: [] },
        chat,
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(chat).not.toHaveBeenCalled();

    const phrase = (
      await repos.bank.addPhrase({ surface: 'Волосы  встали дыбом', translation: 'hair stood' })
    ).item;
    const profile = verbProfile();
    Object.assign(profile, {
      kind: 'phrase',
      pos: 'phrase',
      headword: { ru: 'во́лосы вста́ли ды́бом', plain: 'волосы встали дыбом' },
      sections: [
        {
          id: 'phrase-structure',
          title: { en: 'Word by word', ru: 'Разбор по словам' },
          layout: 'list',
          rows: [{ ru: 'во́лосы', plain: 'волосы', gloss: 'nom. pl.' }],
        },
        {
          id: 'phrase-usage',
          title: { en: 'Usage & register', ru: 'Употребление и стиль' },
          layout: 'list',
          rows: [{ ru: 'ды́бом', plain: 'дыбом', gloss: 'on end' }],
        },
      ],
    });
    const r = await generateProfile(phrase, RUN, { contexts: [] }, async () =>
      reply(JSON.stringify(profile)),
    );
    expect(r.row).toMatchObject({
      kind: 'phrase',
      lemmaNorm: 'волосы встали дыбом',
      headword: 'Волосы  встали дыбом',
      pos: 'phrase',
    });
    expect(await repos.wordForms.getCurrentProfile('волосы встали дыбом', 'phrase')).not.toBeNull();
  });
});
