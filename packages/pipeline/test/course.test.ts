import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePack, type Pack } from '@sumrak/schema';
import {
  annotateDrafts,
  courseManifestIssues,
  DraftError,
  isBinaryPair,
  parseCourseDraft,
  renderCourseReport,
  sniffDraftKind,
} from '../src/index.ts';

/**
 * T88: the `*.course.md` draft (one floor), its assembly with the story drafts,
 * the course validate report, the manifest checks, and the a1-hotel-fixture
 * round trip (drafts → annotate → pack.json deep-equals the committed fixture).
 */

const pkgDir = join(__dirname, '..');
const fxDir = join(pkgDir, 'fixtures', 'hotel-fixture');
const fixturePackPath = join(
  pkgDir,
  '..',
  'schema',
  'fixtures',
  'packs',
  'a1-hotel-fixture',
  'pack.json',
);
const read = (path: string) => ({ path, source: readFileSync(path, 'utf8') });
const fixtureFiles = () =>
  readdirSync(fxDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => read(join(fxDir, f)));
const storyFiles = () => fixtureFiles().filter((f) => !f.path.endsWith('.course.md'));
const courseFile = () => read(join(fxDir, 'a1-hotel-fixture.course.md'));

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DraftError);
    return (e as DraftError).issues;
  }
  throw new Error('expected a DraftError, but the call succeeded');
}

const fixturePack = (): Pack => parsePack(JSON.parse(readFileSync(fixturePackPath, 'utf8')));

describe('a1-hotel-fixture round-trip', () => {
  it('annotate on the fixture drafts deep-equals the committed pack.json', () => {
    const pack = annotateDrafts(fixtureFiles());
    const sample = JSON.parse(readFileSync(fixturePackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('is a course pack at floor 3 with two units, a floor exam, and stays out of the app manifest', () => {
    const pack = fixturePack();
    expect(pack).toMatchObject({ id: 'a1-hotel-fixture', type: 'course', level: 'A1' });
    expect(pack.course).toMatchObject({ ladder: 'torfl', level: 'A1', floor: 3 });
    expect(pack.course!.units.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(pack.course!.floorExam).toEqual({
      size: 5,
      pool: expect.arrayContaining(['fe-c01']),
    });
    expect(pack.stories.map((s) => s.id).sort()).toEqual(['floor-exam', 'u1-ex', 'u2-ex']);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, '..', 'schema', 'fixtures', 'manifest.json'), 'utf8'),
    ) as { packs: { id: string }[] };
    expect(manifest.packs.map((p) => p.id)).not.toContain('a1-hotel-fixture');
  });

  it('carries no audio and every unit meets the design shape (2 explain, check, traps, edge, library)', () => {
    const pack = fixturePack();
    for (const story of pack.stories) expect(story.audio).toEqual([]);
    for (const unit of pack.course!.units) {
      const kinds = unit.cards.map((c) => c.kind);
      expect(kinds.filter((k) => k === 'explain')).toHaveLength(2);
      expect(kinds.filter((k) => k === 'check')).toHaveLength(2);
      expect(kinds).toContain('traps');
      expect(kinds).toContain('edge');
      expect(kinds).toContain('library');
      expect(unit.exercises).toEqual({ size: 4, pool: expect.any(Array) });
      expect(unit.exercises.pool).toHaveLength(10);
    }
  });
});

describe('course drafts — sniffing and parsing', () => {
  it('sniffDraftKind returns "course" for a course: frontmatter key', () => {
    expect(sniffDraftKind('x.course.md', courseFile().source)).toBe('course');
  });

  it('a story draft is still a story', () => {
    expect(sniffDraftKind('u1-ex.draft.md', storyFiles()[0]!.source)).toBe('story');
  });

  it('parseCourseDraft reads the course section and items', () => {
    const parsed = parseCourseDraft(courseFile().path, courseFile().source);
    expect(parsed.course.floor).toBe(3);
    expect(parsed.items).toHaveLength(34);
  });

  it('a schema error in the course section reports its frontmatter line', () => {
    const bad = courseFile().source.replace('passPercent: 80', 'passPercent: 60');
    const issues = issuesOf(() =>
      annotateDrafts([...storyFiles(), { path: 'bad.course.md', source: bad }]),
    );
    expect(
      issues.some((i) => i.file === 'bad.course.md' && i.message.includes('fixed at 80')),
    ).toBe(true);
  });

  it('a course draft whose pack type is not course is rejected', () => {
    const wrong = storyFiles().map((f) => ({
      path: f.path,
      source: f.source.replace('type: course', 'type: stories'),
    }));
    const issues = issuesOf(() => annotateDrafts([...wrong, courseFile()]));
    expect(issues.some((i) => i.message.includes('a course pack has type: course'))).toBe(true);
  });

  it('two course drafts for one pack are rejected', () => {
    const issues = issuesOf(() =>
      annotateDrafts([
        ...fixtureFiles(),
        { path: 'second.course.md', source: courseFile().source },
      ]),
    );
    expect(issues.some((i) => i.message.includes('two course drafts for one pack'))).toBe(true);
  });
});

describe('course validate report', () => {
  it('prints per-unit cards, voiced examples, pools, the floor exam and the census', () => {
    const report = renderCourseReport(fixturePack());
    expect(report).toContain('Course report — a1-hotel-fixture (torfl A1, floor 3');
    expect(report).toContain('u1 «в + где?»');
    expect(report).toContain('cards explain 2 · check 2 · traps 1 · edge 1 · library 1');
    expect(report).toContain('pool 10 (choice 4 / typed 2 / trigger 2 / transform 2)');
    expect(report).toContain('floor exam: pool 10 / size 5');
    expect(report).toContain('voiced: ✓ every item has a voiced sentence');
  });

  it('flags a two-option choice that is not a binary contrast (non-fatal)', () => {
    const pack = fixturePack();
    const item = pack.items!.find((i) => i.kind === 'choice')!;
    expect(item.kind).toBe('choice');
    const mutated = structuredClone(pack);
    const target = mutated.items!.find((i) => i.kind === 'choice' && i.options.length === 4)!;
    if (target.kind === 'choice') target.options = ['большом', 'большой'];
    expect(renderCourseReport(mutated)).toContain('not on the binary set');
  });

  it('recognises the TORFL §4.1.1 binary contrasts, order-insensitively, ё-tolerant', () => {
    expect(isBinaryPair(['на', 'в'])).toBe(true);
    expect(isBinaryPair(['в', 'на'])).toBe(true);
    expect(isBinaryPair(['ещё', 'уже'])).toBe(true);
    expect(isBinaryPair(['большом', 'большой'])).toBe(false);
    expect(isBinaryPair(['на', 'в', 'по'])).toBe(false);
  });
});

describe('course manifest checks (decision 5)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  /** A temp sumrak-content with a manifest and the published packs the fixture cites. */
  function tempContent(packs: Record<string, Pack>, manifestIds: string[]) {
    dir = mkdtempSync(join(tmpdir(), 'hotel-manifest-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({ schemaVersion: 1, packs: manifestIds.map((id) => ({ id })) }),
    );
    for (const [id, pack] of Object.entries(packs)) {
      mkdirSync(join(dir, 'packs', id), { recursive: true });
      writeFileSync(join(dir, 'packs', id, 'pack.json'), JSON.stringify(pack));
    }
    return manifestPath;
  }

  const sourcePack = (): Pack =>
    parsePack(
      JSON.parse(
        readFileSync(
          join(pkgDir, '..', 'schema', 'fixtures', 'packs', 'a1-hotel-fixture', 'pack.json'),
          'utf8',
        ),
      ),
    );

  it('a missing manifest is a warning line, not a failure', () => {
    const report = courseManifestIssues(fixturePack(), undefined, () => undefined);
    expect(report.broken).toBe(0);
    expect(report.lines.join('\n')).toContain('live manifest not found');
  });

  it('library quotes and practice refs resolve against a manifest with the cited packs', () => {
    const lexgram = {
      id: 'a1-torfl-lexgram-001',
      exams: [{ id: 'lg-case-prep' }],
    } as unknown as Pack;
    const house = {
      id: 'a1-no-end-house-001',
      stories: [
        {
          id: 'part-1',
          sentences: [
            { id: 'nea1p1-s04', ru: 'Мы дружили в колледже.' },
            {
              id: 'nea1p1-s08',
              ru: 'После колледжа я жил в маленькой квартире и видел Питера редко.',
            },
          ],
        },
        {
          id: 'part-2',
          sentences: [
            {
              id: 'nea1p2-s11',
              ru: 'Внутри — обычный холл, как в гостинице, только с украшениями на Хеллоуин.',
            },
            { id: 'nea1p2-s19', ru: 'В конце комнаты — выход.' },
          ],
        },
      ],
    } as unknown as Pack;
    const manifest = tempContent(
      { 'a1-torfl-lexgram-001': lexgram, 'a1-no-end-house-001': house },
      ['a1-torfl-lexgram-001', 'a1-no-end-house-001'],
    );
    const report = courseManifestIssues(fixturePack(), manifest, (id) =>
      id === 'a1-torfl-lexgram-001' ? lexgram : id === 'a1-no-end-house-001' ? house : undefined,
    );
    expect(report.broken, report.lines.join('\n')).toBe(0);
  });

  it('a library quote whose text differs by one character from the published sentence is broken', () => {
    const source = sourcePack();
    const house = structuredClone(source) as unknown as Pack;
    const lexgram = {
      id: 'a1-torfl-lexgram-001',
      exams: [{ id: 'lg-case-prep' }],
    } as unknown as Pack;
    // the published sentence text, changed by one character
    const publishedText = 'Мы дружили в колледже!';
    const fake = {
      id: 'a1-no-end-house-001',
      stories: [{ id: 'part-1', sentences: [{ id: 'nea1p1-s04', ru: publishedText }] }],
    } as unknown as Pack;
    void house;
    const manifest = tempContent({ 'a1-torfl-lexgram-001': lexgram, 'a1-no-end-house-001': fake }, [
      'a1-torfl-lexgram-001',
      'a1-no-end-house-001',
    ]);
    const report = courseManifestIssues(fixturePack(), manifest, (id) =>
      id === 'a1-torfl-lexgram-001' ? lexgram : id === 'a1-no-end-house-001' ? fake : undefined,
    );
    expect(report.broken).toBeGreaterThan(0);
    expect(report.lines.join('\n')).toContain('text is not byte-identical');
  });
});
