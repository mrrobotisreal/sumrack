import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePack, type Pack } from '@sumrak/schema';
import {
  annotateDrafts,
  DraftError,
  EXAM_TOPICS,
  parseExamDraft,
  parseIssuePath,
  renderMatrixMap,
  renderOfficialShape,
  renderRefTable,
  renderTopicCensus,
  runPublish,
  runValidate,
  sniffDraftKind,
} from '../src/index.ts';

/**
 * T67: the `*.exam.md` draft format, its assembly with story drafts, the
 * four exam reports, the a1-exam-fixture round-trip, the broken fixtures and
 * a scratch publish (TORFL_EXAM_PREP §3.3).
 */

const pkgDir = join(__dirname, '..');
const fixture = (...p: string[]) => join(pkgDir, 'fixtures', ...p);
const fxDir = fixture('exam-fixture');
const fixturePackPath = join(
  pkgDir,
  '..',
  'schema',
  'fixtures',
  'packs',
  'a1-exam-fixture',
  'pack.json',
);
const read = (path: string) => ({ path, source: readFileSync(path, 'utf8') });

/** The fixture drafts in the CLI's glob order (`exam-fixture/*.md`). */
const fixtureFiles = () =>
  readdirSync(fxDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => read(join(fxDir, f)));
const storyFiles = () => [read(join(fxDir, 'rd-01.draft.md')), read(join(fxDir, 'ls-01.draft.md'))];

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DraftError);
    return (e as DraftError).issues;
  }
  throw new Error('expected a DraftError, but the call succeeded');
}

function lineOf(source: string, pred: (line: string) => boolean): number {
  const idx = source.split(/\r?\n/).findIndex(pred);
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx + 1;
}

const PACK_META = `pack:
  id: a1-exam-mini
  version: 1
  type: exam
  title: { ru: 'Мини', en: 'Mini' }
  level: A1
  tags: ['torfl']
  category: torfl
`;

const miniDrill = (
  pack = PACK_META,
  items = `            - { id: q1, kind: choice, topic: conj, stem: 'Я дома, … ты на работе.', options: ['а', 'и'], answer: 0 }\n`,
) => `---
${pack}exam:
  id: mini
  format: torfl
  level: A1
  mode: drill
  title: { ru: 'Мини', en: 'Mini' }
  subtests:
    - id: lexgram
      kind: lexgram
      title: { ru: 'Лексика', en: 'Lexis' }
      instructions: { ru: 'Выберите.', en: 'Choose.' }
      durationMin: 5
      dictionary: false
      navigation: free
      pointsPerItem: 1
      maxPoints: 1
      parts:
        - id: p1
          instructions: { ru: 'Задание 1.', en: 'Item 1.' }
          items:
${items}---
Author notes are ignored.
`;

describe('exam drafts — sniffing + parsing', () => {
  it('recognizes an exam draft by its exam: key (not the filename)', () => {
    expect(sniffDraftKind('x.md', miniDrill())).toBe('exam');
    expect(sniffDraftKind('x.exam.md', readFileSync(join(fxDir, 'rd-01.draft.md'), 'utf8'))).toBe(
      'story',
    );
  });

  it('parses the frontmatter through ExamSchema; the body is author notes', () => {
    const d = parseExamDraft('mini.exam.md', miniDrill());
    expect(d.exam.id).toBe('mini');
    expect(d.pack?.id).toBe('a1-exam-mini');
    expect(d.exam.subtests[0]!.parts[0]!.items[0]!.kind).toBe('choice');
  });

  it('reports schema issues at the line of the offending YAML node', () => {
    const source = miniDrill(
      PACK_META,
      `            - id: q1\n              kind: choice\n              topic: conj\n              stem: 'Я дома.'\n              options: ['а', 'и']\n              answer: 5\n`,
    );
    const issues = issuesOf(() => parseExamDraft('mini.exam.md', source));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.line).toBe(lineOf(source, (l) => l.trim() === 'answer: 5'));
    expect(issues[0]!.message).toContain('answer 5 is out of range for 2 options');
  });

  it('reports YAML syntax errors with a line, and rejects unknown frontmatter keys', () => {
    const bad = miniDrill().replace(
      "title: { ru: 'Мини', en: 'Mini' }\n  subtests",
      "title: { ru: 'Мини'\n  subtests",
    );
    expect(issuesOf(() => parseExamDraft('x.exam.md', bad))[0]!.message).toContain(
      'not valid YAML',
    );
    const extra = miniDrill().replace('exam:\n', 'notes: hi\nexam:\n');
    expect(issuesOf(() => parseExamDraft('x.exam.md', extra))[0]!.message).toContain(
      'Unrecognized key',
    );
  });

  it('parseIssuePath round-trips a schema issue path', () => {
    expect(parseIssuePath('exams[1].subtests[2].parts[0].items[3].passage.storyId')).toEqual([
      'exams',
      1,
      'subtests',
      2,
      'parts',
      0,
      'items',
      3,
      'passage',
      'storyId',
    ]);
  });
});

describe('exam drafts — assembly', () => {
  it('a story-less exam pack assembles from an exam draft carrying pack: (no refs)', () => {
    const pack = annotateDrafts([{ path: 'mini.exam.md', source: miniDrill() }]);
    expect(pack.type).toBe('exam');
    expect(pack.category).toBe('torfl');
    expect(pack.stories).toEqual([]);
    expect(pack.exams!.map((e) => e.id)).toEqual(['mini']);
  });

  it('a story-less exam draft without pack: is an error; so is one with story refs', () => {
    const noPack = issuesOf(() =>
      annotateDrafts([{ path: 'mini.exam.md', source: miniDrill('') }]),
    );
    expect(noPack[0]!.message).toContain('must carry its "pack:" meta');

    const withRef = miniDrill(
      PACK_META,
      `            - { id: q1, kind: choice, topic: read-detail, passage: { storyId: rd-01 }, stem: 'Анна живёт в …', options: ['Москве', 'Сочи'], answer: 0 }\n`,
    );
    const issues = issuesOf(() => annotateDrafts([{ path: 'mini.exam.md', source: withRef }]));
    expect(issues[0]!.message).toContain(
      'references story "rd-01", but no story drafts were given',
    );
    expect(issues[0]!.line).toBe(lineOf(withRef, (l) => l.includes('passage: { storyId: rd-01 }')));
  });

  it('exam drafts need type: exam in the pack meta', () => {
    const meta = PACK_META.replace('type: exam', 'type: stories');
    const issues = issuesOf(() =>
      annotateDrafts([{ path: 'mini.exam.md', source: miniDrill(meta) }]),
    );
    expect(issues.map((i) => i.message).join('\n')).toContain('an exam pack has type: exam');
  });

  it('an exam draft’s pack: must match the story drafts byte-for-byte', () => {
    const differing = miniDrill(PACK_META.replace('a1-exam-mini', 'a1-exam-fixture'));
    const issues = issuesOf(() =>
      annotateDrafts([...storyFiles(), { path: 'mini.exam.md', source: differing }]),
    );
    expect(
      issues.some((i) => i.file === 'mini.exam.md' && i.message.includes('differs from')),
    ).toBe(true);
  });

  it('rejects duplicate exam ids across exam drafts', () => {
    const a = miniDrill('');
    const issues = issuesOf(() =>
      annotateDrafts([
        ...storyFiles(),
        { path: 'a.exam.md', source: a },
        { path: 'b.exam.md', source: a },
      ]),
    );
    expect(issues[0]).toMatchObject({
      file: 'b.exam.md',
      message: expect.stringContaining('duplicate exam id "mini" (already used in a.exam.md)'),
    });
  });

  it('exams keep the CLI order of their drafts', () => {
    const pack = annotateDrafts(fixtureFiles());
    expect(pack.exams!.map((e) => e.id)).toEqual(['a1-drill-fx', 'a1-mock-fx']);
  });
});

describe('a1-exam-fixture round-trip', () => {
  it('annotate on exam-fixture/*.md deep-equals the schema fixture pack', () => {
    const pack = annotateDrafts(fixtureFiles());
    const sample = JSON.parse(readFileSync(fixturePackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('is a torfl exam pack with both stories, the mock and the drill — and stays out of the app manifest', () => {
    const pack = JSON.parse(readFileSync(fixturePackPath, 'utf8')) as Pack;
    expect(pack).toMatchObject({ id: 'a1-exam-fixture', type: 'exam', category: 'torfl' });
    expect(pack.stories.map((s) => s.id).sort()).toEqual(['ls-01', 'rd-01']);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, '..', 'schema', 'fixtures', 'manifest.json'), 'utf8'),
    ) as { packs: { id: string }[] };
    expect(manifest.packs.map((p) => p.id)).not.toContain('a1-exam-fixture');
  });
});

describe('a2-exam-fixture round-trip (T75)', () => {
  const a2Dir = fixture('a2-exam-fixture');
  const a2PackPath = join(
    pkgDir,
    '..',
    'schema',
    'fixtures',
    'packs',
    'a2-exam-fixture',
    'pack.json',
  );
  const a2Files = () =>
    readdirSync(a2Dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => read(join(a2Dir, f)));
  const a2Pack = () => parsePack(JSON.parse(readFileSync(a2PackPath, 'utf8')));
  const a2Mock = () => a2Pack().exams!.find((e) => e.id === 'a2-mock-fx')!;

  it('annotate on a2-exam-fixture/*.md deep-equals the schema fixture pack', () => {
    const pack = annotateDrafts(a2Files());
    const sample = JSON.parse(readFileSync(a2PackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('is a torfl-a2 exam pack at level A2 with four stories, three exams — and stays out of the app manifest', () => {
    const pack = a2Pack();
    expect(pack).toMatchObject({
      id: 'a2-exam-fixture',
      type: 'exam',
      category: 'torfl-a2',
      level: 'A2',
    });
    expect(pack.exams!.map((e) => e.id)).toEqual([
      'a2-drill-fx-time',
      'a2-drill-fx-info',
      'a2-mock-fx',
    ]);
    for (const exam of pack.exams!) expect(exam.level).toBe('A2');
    expect(pack.stories.map((s) => s.id).sort()).toEqual(['ex-01', 'ls-01', 'md-note', 'rd-01']);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, '..', 'schema', 'fixtures', 'manifest.json'), 'utf8'),
    ) as { packs: { id: string }[] };
    expect(manifest.packs.map((p) => p.id)).not.toContain('a2-exam-fixture');
  });

  it('the mock: writing has 2 parts (2nd item write-note); speaking ends in one ungrouped 600/300 monologue; reading points at the 9-sentence rd-01', () => {
    const mock = a2Mock();
    const writing = mock.subtests.find((s) => s.kind === 'writing')!;
    expect(writing.parts).toHaveLength(2);
    expect(writing.parts[1]!.items[0]).toMatchObject({ kind: 'writing', topic: 'write-note' });

    const speaking = mock.subtests.find((s) => s.kind === 'speaking')!;
    const last = speaking.parts[speaking.parts.length - 1]!;
    expect(last.items).toHaveLength(1);
    expect(last.items[0]).toMatchObject({
      kind: 'speaking-monologue',
      prepSec: 600,
      answerSec: 300,
    });
    expect((last.items[0] as { group?: string }).group).toBeUndefined();

    const reading = mock.subtests.find((s) => s.kind === 'reading')!;
    const readItems = reading.parts.flatMap((p) => p.items);
    expect(readItems.length).toBeGreaterThanOrEqual(5);
    for (const item of readItems) {
      expect((item as { passage?: { storyId: string } }).passage?.storyId).toBe('rd-01');
    }
    expect(a2Pack().stories.find((s) => s.id === 'rd-01')!.sentences).toHaveLength(9);
  });

  it('the info drill: a typed listen-info item with half credit; subtest pointsPerItem 6', () => {
    const info = a2Pack().exams!.find((e) => e.id === 'a2-drill-fx-info')!;
    const listening = info.subtests[0]!;
    expect(listening.pointsPerItem).toBe(6);
    const typed = listening.parts[0]!.items.find((i) => i.kind === 'typed');
    expect(typed).toMatchObject({ topic: 'listen-info' });
    expect((typed as { half?: string[] }).half?.length).toBeGreaterThan(0);
  });

  it('reports: the matrix map has no ✗ and the ref table has zero broken refs', () => {
    expect(renderMatrixMap(a2Mock())).not.toContain('✗');
    expect(renderRefTable(a2Mock(), a2Pack()).broken).toBe(0);
  });
});

describe('exam reports', () => {
  const pack = () => parsePack(JSON.parse(readFileSync(fixturePackPath, 'utf8')));
  const mock = () => pack().exams!.find((e) => e.id === 'a1-mock-fx')!;

  it('matrix map: every subtest with Σ ✓ (objective) or rubric', () => {
    const text = renderMatrixMap(mock());
    expect(text).toContain('Matrix map — «Вариант ФХ» (a1-mock-fx, torfl A1 mock)');
    expect(text).toContain(
      'lexgram — lexgram «Лексика. Грамматика» · 40 min · no dictionary · free · Σ 5 / 5 ✓',
    );
    expect(text).toContain('Σ 12 / 12 ✓');
    expect(text).toContain('audio ×2 · Σ 15 / 15 ✓');
    expect(text).toContain('writing «Письмо» · 30 min · dictionary · free · rubric % of 100');
    expect(text).toMatch(/sp03\s+speaking-monologue speak-monologue\s+rubric group m1/);
    expect(text).not.toContain('✗');
  });

  it('topic census counts items per slug and flags unknown / misplaced slugs with ?', () => {
    expect(renderTopicCensus(mock())).toMatch(/read-detail\s+3\s+reading$/m);
    expect(renderTopicCensus(mock())).not.toContain('?');
    const exam = structuredClone(mock());
    (exam.subtests[1]!.parts[0]!.items[0] as { topic: string }).topic = 'case-locative';
    (exam.subtests[1]!.parts[0]!.items[1] as { topic: string }).topic = 'read-signs';
    const text = renderTopicCensus(exam);
    expect(text).toMatch(/case-locative\s+1\s+lexgram\s+\?\s+\(not a TORFL §3\.4 slug/);
    expect(text).toContain('(§3.4 lists it under reading)');
    expect(Object.values(EXAM_TOPICS).flat()).toHaveLength(38);
  });

  it('official shape: the fixture mock prints its six ⚠ lines; a drill is not checked', () => {
    expect(renderOfficialShape(mock()).split('\n')).toEqual([
      'Official shape — a1-mock-fx: 6 deviations',
      '  ⚠ official-shape: lexgram "lexgram" has items 5 — official 70',
      '  ⚠ official-shape: lexgram "lexgram" maxPoints 5 — official 70',
      '  ⚠ official-shape: reading "reading" has items 3 — official 25',
      '  ⚠ official-shape: reading "reading" maxPoints 12 — official 100',
      '  ⚠ official-shape: listening "listening" has items 3 — official 20',
      '  ⚠ official-shape: listening "listening" maxPoints 15 — official 100',
    ]);
    expect(renderOfficialShape(pack().exams![0]!)).toContain('not checked (drill');
  });

  it('official shape (T75): an A2 clone of the fixture mock is checked against the A2 numbers', () => {
    const a2 = structuredClone(mock());
    a2.level = 'A2';
    const text = renderOfficialShape(a2);
    expect(text.split('\n')[0]).toMatch(/^Official shape — a1-mock-fx: \d+ deviations$/);
    expect(text).toContain('official 100');
    expect(text).toContain('has parts 1 — official 2');
  });

  it('official shape (T75): a B1 clone is not checked', () => {
    const b1 = structuredClone(mock());
    b1.level = 'B1';
    expect(renderOfficialShape(b1)).toBe(
      'Official shape — a1-mock-fx: not checked (mock, torfl B1 — only A1 / A2 TORFL mocks are)',
    );
  });

  it('ref table: every ref ✓, inherited listening audio marked ↑', () => {
    const { text, broken } = renderRefTable(mock(), pack());
    expect(broken).toBe(0);
    expect(text).toContain('Ref table — a1-mock-fx (8 refs, all ✓; ↑ = inherited');
    expect(text).toMatch(
      /✓ reading\/rd01\s+passage\s+→ rd-01 · tfa1fx01r01-s01…tfa1fx01r01-s02 \(2\) · no audio/,
    );
    expect(text).toMatch(/✓ listening\/ls02\s+audio↑\s+→ ls-01 · all 5 sentences/);
    expect(text).toMatch(/✓ speaking\/sp02\s+prompt\s+→ ls-01 · tfa1fx01l01-s03/);
  });
});

describe('broken exam fixtures — path-precise, file:line errors', () => {
  const broken = (name: string) => {
    const f = read(fixture('broken', name));
    return {
      issues: issuesOf(() => annotateDrafts([...storyFiles(), f])),
      source: f.source,
      path: f.path,
    };
  };

  it.each([
    [
      'exam-dangling-story.exam.md',
      'passage.storyId',
      'references unknown story "rd-99"',
      'storyId: rd-99',
    ],
    [
      'exam-noncontiguous-span.exam.md',
      'passage.sentenceIds[1]',
      'contiguous run in story order',
      'sentenceIds: [tfa1fx01r01-s01, tfa1fx01r01-s03]',
    ],
    [
      'exam-points-sum.exam.md',
      'maxPoints',
      'item points add up to 2 but subtest "s1" declares maxPoints 70',
      'maxPoints: 70',
    ],
    [
      'exam-answer-range.exam.md',
      'items.0.answer',
      'answer 2 is out of range for 2 options',
      'answer: 2',
    ],
    [
      'exam-speaking-in-reading.exam.md',
      'items.1.kind',
      'a reading subtest holds only choice / typed items (item "sp01" is speaking-reply)',
      'kind: speaking-reply',
    ],
    [
      'exam-monologue-group-3.exam.md',
      'items.0.group',
      'monologue group "m1" has 3 members',
      'group: m1',
    ],
    [
      'exam-bullet-cue-punct.exam.md',
      'bullets.1.cues.0',
      'cue "живу!" must be letters/digits/spaces/hyphens only',
      "cues: ['живу!']",
    ],
  ])('%s', (name, pathPart, message, lineNeedle) => {
    const { issues, source, path } = broken(name);
    const hit = issues.find((i) => i.message.includes(pathPart) && i.message.includes(message));
    expect(hit, issues.map((i) => i.message).join('\n')).toBeDefined();
    expect(hit!.file).toBe(path);
    expect(hit!.line).toBe(lineOf(source, (l) => l.includes(lineNeedle)));
  });

  it('exam-half-voiced.pack.json: validate names every audio/prompt ref whose story has no track', () => {
    const result = runValidate(fixture('broken', 'exam-half-voiced.pack.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'exams[1].subtests[3].parts[0].items[0].audio.storyId: pack ships audio but story "ls-01" (item "ls01" audio) has none — every audio/prompt story needs a track once any story has one',
      'exams[1].subtests[4].parts[0].items[0].prompt.storyId: pack ships audio but story "ls-01" (item "sp01" prompt) has none — every audio/prompt story needs a track once any story has one',
      'exams[1].subtests[4].parts[1].items[0].prompt.storyId: pack ships audio but story "ls-01" (item "sp02" prompt) has none — every audio/prompt story needs a track once any story has one',
    ]);
  });
});

describe('CLI + publish on the exam fixture', () => {
  const tsxCli = require.resolve('tsx/cli');
  const cli = (args: string[], expectFail = false) => {
    try {
      return {
        code: 0,
        out: execFileSync(process.execPath, [tsxCli, join(pkgDir, 'src', 'cli.ts'), ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      if (!expectFail) throw e;
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };

  it('validate prints the four reports and exits 0 despite the ⚠ official-shape lines', () => {
    const result = cli(['validate', fixturePackPath]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('valid pack "a1-exam-fixture" v1');
    expect(result.out).toContain('Matrix map — «Вариант ФХ»');
    expect(result.out).toContain('Topic census — a1-mock-fx (12 topics)');
    expect(result.out).toContain('⚠ official-shape: lexgram "lexgram" has items 5 — official 70');
    expect(result.out).toContain('Ref table — a1-mock-fx (8 refs, all ✓');
  });

  it('annotate prints the exam count + reports; a broken draft exits 1 with file:line', () => {
    const dir = mkdtempSync(join(tmpdir(), 't67-cli-'));
    try {
      const drafts = fixtureFiles().map((f) => f.path);
      const result = cli(['annotate', ...drafts, '-o', join(dir, 'pack.json')]);
      expect(result.out).toContain('2 stories, 11 sentences, 63 tokens + 2 exams — schema-valid');
      expect(result.out).toContain('Official shape — a1-drill-fx: not checked');
      const bad = fixture('broken', 'exam-dangling-story.exam.md');
      const fail = cli(
        [
          'annotate',
          join(fxDir, 'rd-01.draft.md'),
          join(fxDir, 'ls-01.draft.md'),
          bad,
          '-o',
          join(dir, 'x.json'),
        ],
        true,
      );
      expect(fail.code).toBe(1);
      expect(fail.out).toContain(
        `${bad}:${lineOf(readFileSync(bad, 'utf8'), (l) => l.includes('rd-99'))}:`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publish against a scratch content repo: type exam + category torfl; pack.json only', () => {
    const dir = mkdtempSync(join(tmpdir(), 't67-publish-'));
    try {
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'T67 Test');
      writeFileSync(
        join(dir, 'manifest.json'),
        `${JSON.stringify({ schemaVersion: 1, packs: [] })}\n`,
      );
      git('add', 'manifest.json');
      git('commit', '-qm', 'init');

      const summary = runPublish(join(fixturePackPath, '..'), dir);
      expect(summary.outcome).toBe('published');
      expect(summary.files.map((f) => f.path)).toEqual(['pack.json']);
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      expect(Object.keys(manifest.packs[0]).sort()).toEqual(
        ['bytes', 'category', 'files', 'id', 'level', 'title', 'type', 'version'].sort(),
      );
      expect(manifest.packs[0]).toMatchObject({
        id: 'a1-exam-fixture',
        version: 1,
        type: 'exam',
        category: 'torfl',
        level: 'A1',
      });
      expect(runPublish(join(fixturePackPath, '..'), dir).outcome).toBe('unchanged');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
