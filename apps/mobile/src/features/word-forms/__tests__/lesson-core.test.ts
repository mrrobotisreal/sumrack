import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestDb } from '@/db/__tests__/helpers';
import { createRepositories } from '@/db/repositories';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { AiError } from '@/features/ai/errors';
import {
  buildGrammarLessonMessages,
  buildGrammarLessonSystem,
  buildGrammarLessonUserTurn,
  type GrammarLessonInput,
} from '@/features/ai/prompts/grammar-lesson';
import { statsKey, type AiRunProfile } from '@/features/ai/run-profile';
import type { RunChatResult } from '@/features/ai/runner';

import {
  countStressedSentences,
  dayLabel,
  GrammarLessonSchema,
  groupByDay,
  groupBySection,
  hasMarkdownTable,
  learnerLevelFrom,
  LESSON_HEADINGS,
  lessonHeadings,
  parseLessonAnswer,
} from '../lesson-core';
import { generateLesson, type LessonChat } from '../lesson-service';
import { verbProfile } from './fixtures';

/**
 * T54 lesson tests (WORD_FORMS §6.2, §6.3, §7.3): the CAPTURED fixture
 * («говорить» × verb-nonpast) through the production parser — bounds,
 * every §6.2 heading, a markdown table, ≥ 2 stressed sentences — the
 * prompt builders, the learner-level rule, the day/section grouping, and
 * the service against an in-memory DB with an injected transport (no
 * automatic retry, receipt + stats bucket, events). No network anywhere.
 */

const track = vi.hoisted(() => vi.fn());
vi.mock('@/services/analytics', () => ({ track }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
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
interface CapturedLesson {
  input: GrammarLessonInput;
  model: string;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
}
const captured = JSON.parse(
  readFileSync(path.join(FIXTURES, 'grammar-lesson.json'), 'utf8'),
) as CapturedLesson;

describe('captured grammar-lesson fixture (§6.3)', () => {
  const content = captured.choices[0]!.message.content;
  const lesson = parseLessonAnswer(content);

  it('parses through the production path within the §6.2 bounds', () => {
    expect(lesson).not.toBeNull();
    expect(GrammarLessonSchema.safeParse(lesson).success).toBe(true);
    expect(captured.choices[0]!.finish_reason).toBe('stop');
    expect(captured.usage?.completion_tokens).toBeGreaterThan(0);
    expect(captured.input.section.id).toBe('verb-nonpast');
  });

  it('keeps every §6.2 heading, in order', () => {
    const headings = lessonHeadings(lesson!);
    expect(headings).toHaveLength(LESSON_HEADINGS.length);
    LESSON_HEADINGS.forEach((h, i) => expect(headings[i]).toContain(h));
    expect(headings[0]).toContain('«говорить»');
  });

  it('carries a markdown table and ≥ 2 stressed Russian sentences', () => {
    expect(hasMarkdownTable(lesson!)).toBe(true);
    expect(countStressedSentences(lesson!)).toBeGreaterThanOrEqual(2);
    expect(lesson).toContain('ё'); // ё preserved (the profile has «серьёзный»/«придёт»… the lesson keeps its own)
  });
});

describe('parseLessonAnswer', () => {
  it('rejects answers outside the bounds and strips a whole-lesson code fence', () => {
    expect(parseLessonAnswer('')).toBeNull();
    expect(parseLessonAnswer('too short')).toBeNull();
    expect(parseLessonAnswer('x'.repeat(30_001))).toBeNull();
    const body = `## The pattern\n${'говори́ть '.repeat(40)}`.trim();
    expect(parseLessonAnswer(`\`\`\`markdown\n${body}\n\`\`\``)).toBe(body.normalize('NFC'));
    expect(parseLessonAnswer(`  ${body}\n\n`)).toBe(body.normalize('NFC'));
  });
  it('detects tables and stressed lines', () => {
    expect(hasMarkdownTable('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true);
    expect(hasMarkdownTable('| a | b |\nno divider')).toBe(false);
    expect(countStressedSentences('Я говорю́.\nI speak.\nОн говорит.')).toBe(1);
  });
});

describe('§6.2 prompt builders', () => {
  const input: GrammarLessonInput = {
    language: 'ru',
    headword: 'говорить',
    pos: 'verb',
    gloss: 'to speak',
    section: verbProfile().sections[0]!,
    sectionTitleEn: 'Present & future',
    facts: [
      { label: 'Aspect', value: 'imperfective' },
      { label: '', value: 'dropped' },
    ],
    encounters: [
      { ru: 'Он говорил тихо.', storyTitle: 'Высокий Пёс' },
      { ru: 'Не говори никому.' },
      { ru: '   ' },
    ],
    learnerLevel: 'A2',
  };

  it('substitutes the three placeholders and keeps the §6.2 text verbatim', () => {
    const system = buildGrammarLessonSystem('ru', 'Present & future', 'говорить');
    expect(system.startsWith('You are a warm, precise Russian tutor')).toBe(true);
    expect(system).toContain('the section "Present & future" of «говорить».');
    expect(system).toContain('## What this is and why it matters for «говорить»');
    expect(system).toContain('Rules: 350–700 words; Cyrillic NFC with ё preserved;');
    expect(system).not.toContain('{LANGUAGE_NAME}');
    expect(system).not.toContain('{HEADWORD}');
    expect(system).not.toContain('{SECTION_TITLE_EN}');
    expect(buildGrammarLessonSystem('uk', 'x', 'y')).toContain('Ukrainian tutor');
  });

  it('renders the user turn: word line, section, section JSON, facts, encounters, level', () => {
    const turn = buildGrammarLessonUserTurn(input);
    const lines = turn.split('\n');
    expect(lines[0]).toBe('Word: «говорить» (verb, gloss "to speak")');
    expect(lines[1]).toBe('Section: verb-nonpast — Present & future');
    expect(lines[2]!.startsWith('Structured forms (JSON): {"id":"verb-nonpast"')).toBe(true);
    expect(JSON.parse(lines[2]!.slice('Structured forms (JSON): '.length))).toEqual(input.section);
    expect(turn).toContain('Overview facts:\nAspect: imperfective\n');
    expect(turn).not.toContain('dropped');
    expect(turn).toContain(
      "Learner's own encounters:\n- «Он говорил тихо.» (from «Высокий Пёс»)\n- «Не говори никому.»\n",
    );
    expect(lines[lines.length - 1]).toBe('Learner level: A2');
  });

  it('omits the encounters block when there are none', () => {
    const turn = buildGrammarLessonUserTurn({ ...input, encounters: [], facts: [] });
    expect(turn).not.toContain("Learner's own encounters");
    expect(turn).toContain('Overview facts: (none)');
    const messages = buildGrammarLessonMessages(input);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
});

describe('learnerLevelFrom (§6.2 learner level)', () => {
  const stored = (level: string, createdAt: number) => ({
    createdAt,
    payload: {
      v: 1,
      model: 'm',
      createdAt,
      skills: {
        reading: { level, note: 'n' },
        listening: { level: 'A1', note: 'n' },
        writing: { level: 'A1', note: 'n' },
        speaking: { level: 'A1', note: 'n' },
      },
      recommendations: ['a', 'b'],
      summary: 's',
    },
  });
  it('is A1 with no rows, the newest readable reading level otherwise', () => {
    expect(learnerLevelFrom([])).toBe('A1');
    expect(learnerLevelFrom([stored('A2', 10), stored('B1', 20)])).toBe('B1');
    expect(learnerLevelFrom([stored('B1', 20), stored('A2', 10)])).toBe('B1');
    // an unreadable newest payload is skipped, not treated as A1
    expect(learnerLevelFrom([{ createdAt: 30, payload: { junk: true } }, stored('A2', 10)])).toBe(
      'A2',
    );
  });
});

describe('groupByDay / groupBySection (§7.3)', () => {
  const now = new Date(2026, 8, 24, 21, 0).getTime();
  const at = (d: number, h: number) => new Date(2026, 8, d, h).getTime();
  it('labels Today / Yesterday / d MMM yyyy and keeps order inside a day', () => {
    const rows = [
      { id: 'a', createdAt: at(24, 20) },
      { id: 'b', createdAt: at(24, 9) },
      { id: 'c', createdAt: at(23, 23) },
      { id: 'd', createdAt: at(1, 12) },
    ];
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['1 Sep 2026', ['d']],
    ]);
    expect(dayLabel(at(24, 0), now)).toBe('Today');
    expect(groupByDay([], now)).toEqual([]);
  });
  it('groups a word’s lessons by section in catalog rank, newest first inside', () => {
    const base = {
      lemmaNorm: 'говорить',
      kind: 'word' as const,
      headword: 'говорить',
      profileId: null,
      markdown: 'x',
      provider: 'anthropic' as const,
      model: 'm',
      quality: 'normal' as const,
      effort: 'high' as const,
      effortApplied: true,
      promptTokens: null,
      completionTokens: null,
      reasoningTokens: null,
      costUsd: null,
      durationMs: 1,
    };
    const rows = [
      { ...base, id: '1', sectionId: 'verb-past', createdAt: 10 },
      { ...base, id: '2', sectionId: 'verb-nonpast', createdAt: 5 },
      { ...base, id: '3', sectionId: 'verb-nonpast', createdAt: 7 },
    ];
    const rank = (id: string) => (id === 'verb-nonpast' ? 0 : 1);
    expect(groupBySection(rows, rank).map((g) => [g.sectionId, g.rows.map((r) => r.id)])).toEqual([
      ['verb-nonpast', ['3', '2']],
      ['verb-past', ['1']],
    ]);
  });
});

// --- service -------------------------------------------------------------------

const RUN: AiRunProfile = { provider: 'anthropic', quality: 'normal', effort: 'high' };
const LESSON_MD = captured.choices[0]!.message.content;

function reply(content: string, extra: Partial<RunChatResult> = {}): RunChatResult {
  return {
    content,
    model: 'anthropic/claude-opus-5.5',
    usage: { promptTokens: 1200, completionTokens: 1500, reasoningTokens: 0, costUsd: 0.018 },
    finishReason: 'stop',
    effortApplied: true,
    ...extra,
  };
}

describe('generateLesson (§6.2 service)', () => {
  let repos: ReturnType<typeof createRepositories>;
  beforeEach(() => {
    track.mockClear();
    repos = createRepositories(createTestDb());
    testRepos.current = repos;
  });

  async function seed() {
    const added = await repos.bank.addWord({
      lemma: 'говорить',
      surface: 'говорил',
      translation: 'to speak',
      pos: 'verb',
      level: 'A1',
    });
    const profile = verbProfile();
    const row = await repos.wordForms.insertProfile({
      lemmaNorm: 'говорить',
      kind: 'word',
      headword: 'говорить',
      pos: 'verb',
      payload: profile,
      provider: 'anthropic',
      model: 'anthropic/claude-opus-5.5',
      quality: 'normal',
      effort: 'high',
      effortApplied: true,
      durationMs: 1,
    });
    const record = (await repos.wordForms.getCurrentProfile('говорить', 'word'))!;
    return { item: added.item, record, row, section: profile.sections[0]! };
  }

  it('stores the lesson with its receipt + profileId, folds the stats bucket, fires the events', async () => {
    const { item, record, section } = await seed();
    const calls: Parameters<LessonChat>[] = [];
    const chat: LessonChat = async (req, run) => {
      calls.push([req, run]);
      return reply(LESSON_MD);
    };
    const row = await generateLesson(
      item,
      record,
      section,
      RUN,
      { encounters: [{ ru: 'Он говорил тихо.', storyTitle: 'Пёс' }], learnerLevel: 'A2' },
      chat,
    );

    expect(calls).toHaveLength(1);
    const [req, run] = calls[0]!;
    expect(run.model).toBe('anthropic/claude-opus-5.5');
    expect(req.maxTokens).toBe(12_288);
    expect(req.temperature).toBe(0.4);
    expect(req.timeoutMs).toBe(150_000);
    expect(req.messages[0]!.content).toContain('the section "Present & future" of «говорить».');
    expect(req.messages[1]!.content).toContain('- «Он говорил тихо.» (from «Пёс»)');
    expect(req.messages[1]!.content).toContain('Learner level: A2');

    expect(row).toMatchObject({
      lemmaNorm: 'говорить',
      kind: 'word',
      headword: 'говорить',
      sectionId: 'verb-nonpast',
      profileId: record.id,
      provider: 'anthropic',
      model: 'anthropic/claude-opus-5.5',
      quality: 'normal',
      effort: 'high',
      effortApplied: true,
      promptTokens: 1200,
      completionTokens: 1500,
      costUsd: 0.018,
    });
    expect(row.markdown).toBe(LESSON_MD.trim());
    expect(await repos.wordForms.listLessonsForSection('говорить', 'word', 'verb-nonpast')).toEqual(
      [row],
    );
    expect(await repos.wordForms.countLessonsForKey('говорить', 'word')).toEqual({
      'verb-nonpast': 1,
    });

    const stats = (await repos.settings.get<{ runs: Record<string, { n: number }> }>(
      SETTING_KEYS.grammarStats,
    ))!;
    expect(stats.runs[statsKey('lesson', RUN)]?.n).toBe(1);
    expect(stats.runs[statsKey('profile', RUN)]).toBeUndefined();

    const names = track.mock.calls.map((c) => c[0]);
    expect(names).toEqual(['lesson_requested', 'lesson_generated']);
    expect(track.mock.calls[0]![1]).toEqual({
      sectionId: 'verb-nonpast',
      provider: 'anthropic',
      quality: 'normal',
      effort: 'high',
    });
    expect(track.mock.calls[1]![1]).toMatchObject({
      sectionId: 'verb-nonpast',
      costUsd: 0.018,
      chars: row.markdown.length,
    });
  });

  it('learn again appends a second row (never edits) and the newest lists first', async () => {
    const { item, record, section } = await seed();
    const chat: LessonChat = async () => reply(LESSON_MD);
    const first = await generateLesson(item, record, section, RUN, { encounters: [] }, chat);
    const second = await generateLesson(
      item,
      record,
      section,
      { provider: 'openai', quality: 'best', effort: 'ultra' },
      { encounters: [] },
      chat,
    );
    expect(second.id).not.toBe(first.id);
    const list = await repos.wordForms.listLessonsForSection('говорить', 'word', 'verb-nonpast');
    // Same-millisecond inserts tie on created_at (the repo then orders by id) —
    // assert the set + count here; newest-first ordering is the T52 repo test's.
    expect(new Set(list.map((l) => l.id))).toEqual(new Set([second.id, first.id]));
    expect(list.map((l) => l.provider).sort()).toEqual(['anthropic', 'openai']);
    expect(await repos.wordForms.countLessons()).toBe(2);
  });

  it('invalid-response: an out-of-bounds answer stores nothing and is NOT retried', async () => {
    const { item, record, section } = await seed();
    let calls = 0;
    const chat: LessonChat = async () => {
      calls++;
      return reply('Sorry.', { finishReason: 'stop' });
    };
    await expect(
      generateLesson(item, record, section, RUN, { encounters: [] }, chat),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(calls).toBe(1);
    expect(await repos.wordForms.countLessons()).toBe(0);
    expect(await repos.settings.get(SETTING_KEYS.grammarStats)).toBeNull();
    expect(track.mock.calls.map((c) => c[0])).toEqual(['lesson_requested', 'lesson_failed']);
    expect(track.mock.calls[1]![1]).toEqual({
      sectionId: 'verb-nonpast',
      code: 'invalid-response',
    });
  });

  it('records effortApplied:false when the §4.4 fallback fired, and passes transport errors through', async () => {
    const { item, record, section } = await seed();
    const row = await generateLesson(item, record, section, RUN, { encounters: [] }, async () =>
      reply(LESSON_MD, { effortApplied: false, usage: undefined }),
    );
    expect(row.effortApplied).toBe(false);
    expect(row.costUsd).toBeNull();

    await expect(
      generateLesson(item, record, section, RUN, { encounters: [] }, async () => {
        throw new AiError('timeout', 'slow');
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(track.mock.calls.at(-1)).toEqual([
      'lesson_failed',
      { sectionId: 'verb-nonpast', code: 'timeout' },
    ]);
  });

  it('looks up the learner level from the newest assessment by default', async () => {
    const { item, record, section } = await seed();
    await repos.stats.recordAssessment({
      v: 1,
      model: 'm',
      createdAt: 1,
      skills: {
        reading: { level: 'B1', note: 'n' },
        listening: { level: 'A1', note: 'n' },
        writing: { level: 'A1', note: 'n' },
        speaking: { level: 'A1', note: 'n' },
      },
      recommendations: ['a', 'b'],
      summary: 's',
    });
    let turn = '';
    await generateLesson(item, record, section, RUN, { encounters: [] }, async (req) => {
      turn = req.messages[1]!.content;
      return reply(LESSON_MD);
    });
    expect(turn.endsWith('Learner level: B1')).toBe(true);
  });
});
