import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotateDrafts, DraftError, parseDraft, runValidate } from '../src/index.ts';

const pkgDir = join(__dirname, '..');
const fixture = (...p: string[]) => join(pkgDir, 'fixtures', ...p);
const referenceDraft = readFileSync(fixture('the-photograph.draft.md'), 'utf8');
const samplePackPath = join(
  pkgDir,
  '..',
  'schema',
  'fixtures',
  'packs',
  'a1-creepypasta-002',
  'pack.json',
);

const annotate = (source: string, path = 'draft.md') => annotateDrafts([{ path, source }]);

/** Issues of a DraftError thrown by `fn` (fails the test if it doesn't throw). */
function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DraftError);
    return (e as DraftError).issues;
  }
  throw new Error('expected a DraftError, but the call succeeded');
}

/** A minimal valid draft, with hooks to corrupt individual parts. */
const minimalDraft = (mutate: (lines: string[]) => void = () => {}) => {
  const lines = [
    '---',
    'pack:',
    '  id: test-pack',
    '  version: 1',
    '  type: stories',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    '  tags: ["test"]',
    'story:',
    '  id: test-story',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    '---',
    '',
    '## test-s01',
    '',
    'RU: Всё хорошо.',
    'EN: Everything is fine.',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Всё | весь | everything | pron | n.sg. nom. | A1 |  |',
    '| хорошо | хорошо | fine | adv |  | A1 |  |',
    '| . |  |  |  |  |  |  |',
    '',
  ];
  mutate(lines);
  return lines.join('\n');
};

describe('reference draft round-trip', () => {
  it('annotates to a pack content-equivalent to the T02 sample pack', () => {
    const pack = annotate(referenceDraft, 'the-photograph.draft.md');
    const sample = JSON.parse(readFileSync(samplePackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('preserves ё exactly through parse → normalize → emit', () => {
    const pack = annotate(referenceDraft);
    const emitted = JSON.stringify(pack);
    expect(emitted).toContain('чёрные'); // token text
    expect(emitted).toContain('чёрный'); // lemma
    expect(emitted).toContain('моём');
    expect(emitted).not.toContain('черные');
  });

  it('composes decomposed ё (е + combining diaeresis) to NFC without folding to е', () => {
    const eWithDiaeresis = 'ё'; // NFD: е + U+0308, two code points; NFC must compose it back to ё
    const draft = minimalDraft((lines) => {
      lines[16] = `RU: Вс${eWithDiaeresis} хорошо.`;
      lines[21] = `| Вс${eWithDiaeresis} | весь | everything | pron | n.sg. nom. | A1 |  |`;
    });
    const pack = annotate(draft);
    const ru = pack.stories[0]!.sentences[0]!.ru;
    expect(ru).toBe('Всё хорошо.'); // composed ё, single code point
    expect(ru.normalize('NFC')).toBe(ru);
  });
});

describe('spaceBefore derivation («» quoting)', () => {
  it('derives spaceBefore overrides from the sentence text', () => {
    const draft = minimalDraft((lines) => {
      lines[16] = 'RU: Я думаю: «Это соседи».';
      lines[17] = 'EN: I think: "It is the neighbors."';
      lines.splice(
        21,
        3,
        '| Я | я | I | pron | nom. | A1 |  |',
        '| думаю | думать | think | verb | 1sg. pres. (impf.) | A1 |  |',
        '| : |  |  |  |  |  |  |',
        '| « |  |  |  |  |  |  |',
        '| Это | это | it (is) | pron | demonstrative, nom. | A1 |  |',
        '| соседи | сосед | the neighbors | noun | m.pl. nom. | A1 |  |',
        '| » |  |  |  |  |  |  |',
        '| . |  |  |  |  |  |  |',
      );
    });
    const pack = annotate(draft);
    const tokens = pack.stories[0]!.sentences[0]!.tokens;
    // « gets a space (non-default for punct); Это directly follows it (non-default for a word).
    expect(tokens[3]).toMatchObject({ text: '«', isPunct: true, spaceBefore: true });
    expect(tokens[4]).toMatchObject({ text: 'Это', spaceBefore: false });
    // Default cases carry no spaceBefore key at all.
    expect(tokens[0]!.spaceBefore).toBeUndefined();
    expect(tokens[1]!.spaceBefore).toBeUndefined();
    expect(tokens[2]!.spaceBefore).toBeUndefined(); // ":" punct, no space — default
  });
});

describe('fail-loud gap checks', () => {
  it('missing lemma on a word token fails with the row line number', () => {
    const source = readFileSync(fixture('broken', 'missing-lemma.draft.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'missing-lemma.draft.md'));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ file: 'missing-lemma.draft.md', line: 23 });
    expect(issues[0]!.message).toContain('слышу');
    expect(issues[0]!.message).toContain('missing its lemma');
    expect(issues[1]).toMatchObject({ line: 24 });
    expect(issues[1]!.message).toContain('missing its translation');
  });

  it('misaligned token table fails with a clear alignment error', () => {
    const source = readFileSync(fixture('broken', 'misaligned.draft.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'misaligned.draft.md'));
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0]!.line).toBe(27); // the "стук" row, where alignment first breaks
    expect(issues[0]!.message).toContain('does not match sentence');
    expect(issues[0]!.message).toContain('⟨here⟩');
  });

  it('a token table that ends before the sentence does is an error', () => {
    const draft = minimalDraft((lines) => lines.splice(23, 1)); // drop the "." row
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('ends before the sentence does');
  });

  it('punctuation carrying annotations is an error', () => {
    const draft = minimalDraft((lines) => {
      lines[23] = '| . | точка | period | punct |  |  |  |';
    });
    const issues = issuesOf(() => annotate(draft));
    const messages = issues.map((i) => i.message).join('\n');
    expect(messages).toContain('must not have a "lemma"');
    expect(messages).toContain('must not have a "translation"');
    expect(messages).toContain('must not have a "pos"');
    expect(issues.every((i) => i.line === 24)).toBe(true);
  });

  it('an invalid CEFR level cell is an error', () => {
    const draft = minimalDraft((lines) => {
      lines[21] = '| Всё | весь | everything | pron | n.sg. nom. | A7 |  |';
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('invalid CEFR level "A7"');
    expect(issues[0]!.line).toBe(22);
  });
});

describe('draft grammar errors', () => {
  it('a draft without frontmatter fails immediately', () => {
    const issues = issuesOf(() => parseDraft('x.md', '## s01\nRU: Привет.\n'));
    expect(issues[0]!.message).toContain('frontmatter');
  });

  it('frontmatter validation failures name the bad field', () => {
    const draft = minimalDraft((lines) => {
      lines[6] = '  level: D9';
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('pack.level');
  });

  it('a wrong table header is an error', () => {
    const draft = minimalDraft((lines) => {
      lines[19] = '| surface | lemma | translation | pos | grammar | level | note |';
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('token table header must be exactly');
  });

  it('a row with the wrong number of cells is an error', () => {
    const draft = minimalDraft((lines) => {
      lines[22] = '| хорошо | хорошо | fine | adv | A1 |  |';
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('6 cells, expected 7');
  });

  it('an unrecognized body line is an error, never skipped', () => {
    const draft = minimalDraft((lines) => {
      lines.splice(18, 0, 'this line does not belong here');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('unrecognized line');
    expect(issues[0]!.line).toBe(19);
  });

  it('duplicate sentence ids across drafts are rejected pack-wide', () => {
    const a = minimalDraft();
    const b = minimalDraft((lines) => {
      lines[9] = '  id: other-story';
    });
    const issues = issuesOf(() =>
      annotateDrafts([
        { path: 'a.md', source: a },
        { path: 'b.md', source: b },
      ]),
    );
    expect(issues[0]!.message).toContain('duplicate sentence id "test-s01"');
    expect(issues[0]!.file).toBe('b.md');
  });

  it('drafts of one pack must carry identical pack meta', () => {
    const a = minimalDraft();
    const b = minimalDraft((lines) => {
      lines[9] = '  id: other-story';
      lines[7] = '  tags: ["test", "extra"]';
      lines[14] = '## test-s02';
    });
    const issues = issuesOf(() =>
      annotateDrafts([
        { path: 'a.md', source: a },
        { path: 'b.md', source: b },
      ]),
    );
    expect(issues[0]!.message).toContain('"pack" section differs');
  });

  it('escaped pipes in cells survive as literal "|"', () => {
    const draft = minimalDraft((lines) => {
      lines[22] = '| хорошо | хорошо | fine \\| well | adv |  | A1 |  |';
    });
    const pack = annotate(draft);
    expect(pack.stories[0]!.sentences[0]!.tokens[1]!.translation).toBe('fine | well');
  });
});

describe('validate command', () => {
  it('accepts the T02 sample pack', () => {
    const result = runValidate(samplePackPath);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid pack with schema paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 't08-'));
    try {
      const bad = JSON.parse(readFileSync(samplePackPath, 'utf8'));
      bad.stories[0].sentences[0].tokens[0].lemma = undefined;
      bad.stories[0].sentences[0].ru = 'Другой текст.'; // breaks reconstruction too
      const badPath = join(dir, 'bad.json');
      require('node:fs').writeFileSync(badPath, JSON.stringify(bad));
      const result = runValidate(badPath);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.path.includes('stories[0]'))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports unreadable JSON without throwing', () => {
    const result = runValidate(fixture('the-photograph.draft.md')); // markdown, not JSON
    expect(result.ok).toBe(false);
  });
});

describe('CLI end-to-end', () => {
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

  it('annotate writes a validating pack.json and reports a summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 't08-cli-'));
    try {
      const out = join(dir, 'pack.json');
      const result = cli(['annotate', fixture('the-photograph.draft.md'), '-o', out]);
      expect(result.out).toContain('schema-valid');
      expect(runValidate(out).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('annotate on a broken draft exits 1 with file:line errors', () => {
    const draftPath = fixture('broken', 'missing-lemma.draft.md');
    const result = cli(['annotate', draftPath], true);
    expect(result.code).toBe(1);
    expect(result.out).toContain(`${draftPath}:23:`);
  });

  it('unknown commands exit 2 with usage', () => {
    const result = cli(['frobnicate'], true);
    expect(result.code).toBe(2);
    expect(result.out).toContain('Usage:');
  });
});
