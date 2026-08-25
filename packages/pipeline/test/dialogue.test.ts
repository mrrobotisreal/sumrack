import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Dialogue, DialogueNode } from '@sumrak/schema';
import {
  annotateDrafts,
  DraftError,
  parseDialogueDraft,
  renderBranchMap,
  runPublish,
  runValidate,
  sniffDraftKind,
} from '../src/index.ts';

const pkgDir = join(__dirname, '..');
const fixture = (...p: string[]) => join(pkgDir, 'fixtures', ...p);
const referenceDraft = readFileSync(fixture('the-dinner.dialogue.md'), 'utf8');
const fixturePackPath = join(
  pkgDir,
  '..',
  'schema',
  'fixtures',
  'packs',
  'a2-dialogue-001',
  'pack.json',
);
const loadFixtureDialogue = (): Dialogue =>
  JSON.parse(readFileSync(fixturePackPath, 'utf8')).dialogues[0] as Dialogue;

const annotate = (source: string, path = 'draft.dialogue.md') => annotateDrafts([{ path, source }]);

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

/** 1-based line number of the first line satisfying `pred` in a fixture file. */
function lineOf(source: string, pred: (line: string) => boolean): number {
  const idx = source.split(/\r?\n/).findIndex(pred);
  expect(idx).toBeGreaterThanOrEqual(0);
  return idx + 1;
}

/** A minimal valid dialogue draft, with hooks to mutate individual lines. */
const minimalDialogueDraft = (mutate: (lines: string[]) => void = () => {}) => {
  const lines = [
    '---',
    'pack:',
    '  id: test-pack',
    '  version: 1',
    '  type: dialogue',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    '  tags: ["test"]',
    'dialogue:',
    '  id: test-dlg',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    'characters:',
    '  - id: mama',
    '    name: { ru: "Мама", en: "Mama" }',
    '    voice: elevenlabs:Mariia',
    '    style: warm',
    '  - id: player',
    '    name: { ru: "Ты", en: "You" }',
    '    voice: elevenlabs:Ivan',
    '    style: neutral',
    'endings:',
    '  - id: e-x',
    '    title: { ru: "Конец", en: "End" }',
    '    recap: { ru: "Всё.", en: "Done." }',
    '    tone: good',
    '---',
    '',
    '## t-n1',
    '',
    'SPEAKER: mama',
    '',
    'RU: Привет.',
    'EN: Hello.',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Привет | привет | hello | interj |  | A1 |  |',
    '| . |  |  |  |  |  |  |',
    '',
    'NEXT: t-n2',
    '',
    '## t-n2',
    '',
    'SPEAKER: mama',
    '',
    'RU: Ты дома?',
    'EN: Are you home?',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Ты | ты | you | pron | nom. | A1 |  |',
    '| дома | дома | at home | adv |  | A1 |  |',
    '| ? |  |  |  |  |  |  |',
    '',
    'CHOICES:',
    '',
    '### t-n2-c1 -> t-n3',
    '',
    'RU: Да.',
    'EN: Yes.',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Да | да | yes | part |  | A1 |  |',
    '| . |  |  |  |  |  |  |',
    '',
    '### t-n2-c2 -> t-n3',
    '',
    'RU: Нет.',
    'EN: No.',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Нет | нет | no | part |  | A1 |  |',
    '| . |  |  |  |  |  |  |',
    '',
    '## t-n3',
    '',
    'SPEAKER: mama',
    '',
    'RU: Пока.',
    'EN: Bye.',
    '',
    '| text | lemma | translation | pos | grammar | level | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| Пока | пока | bye | interj |  | A1 |  |',
    '| . |  |  |  |  |  |  |',
    '',
    'ENDING: e-x',
    '',
  ];
  mutate(lines);
  return lines.join('\n');
};

/** A minimal story draft with the SAME pack meta, for mixed-pack tests. */
const minimalStoryDraft = (sentenceId = 'story-s01') =>
  [
    '---',
    'pack:',
    '  id: test-pack',
    '  version: 1',
    '  type: dialogue',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    '  tags: ["test"]',
    'story:',
    '  id: test-story',
    '  title: { ru: "Тест", en: "Test" }',
    '  level: A1',
    '---',
    '',
    `## ${sentenceId}`,
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
  ].join('\n');

describe('draft kind sniffing', () => {
  it('recognizes dialogue drafts by their frontmatter, not the filename', () => {
    expect(sniffDraftKind('x.md', minimalDialogueDraft())).toBe('dialogue');
    expect(sniffDraftKind('x.md', minimalStoryDraft())).toBe('story');
  });
});

describe('reference dialogue draft round-trip', () => {
  it('annotates to a pack deep-equal to the schema fixture pack', () => {
    const pack = annotate(referenceDraft, 'the-dinner.dialogue.md');
    const sample = JSON.parse(readFileSync(fixturePackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('preserves ё exactly through parse → normalize → emit', () => {
    const pack = annotate(referenceDraft);
    const emitted = JSON.stringify(pack);
    expect(emitted).toContain('ещё'); // node text + choice text
    expect(emitted).toContain('Хочешь ещё борща?');
    expect(emitted).not.toContain('еще');
  });

  it('node and choice sentence ids equal their node/choice ids', () => {
    const pack = annotate(referenceDraft);
    for (const node of pack.dialogues![0]!.nodes) {
      expect(node.sentence.id).toBe(node.id);
      for (const choice of node.choices ?? []) expect(choice.sentence.id).toBe(choice.id);
    }
  });

  it('defaults startNodeId to the first scene block when omitted', () => {
    const source = referenceDraft.replace('  startNodeId: din-n01\n', '');
    const pack = annotate(source);
    expect(pack.dialogues![0]!.startNodeId).toBe('din-n01');
  });
});

describe('mixed story + dialogue packs', () => {
  it('assembles stories and dialogues side by side', () => {
    const pack = annotateDrafts([
      { path: 'story.md', source: minimalStoryDraft() },
      { path: 'dlg.md', source: minimalDialogueDraft() },
    ]);
    expect(pack.stories).toHaveLength(1);
    expect(pack.dialogues).toHaveLength(1);
  });

  it('rejects sentence-id collisions across stories and dialogues pack-wide', () => {
    const issues = issuesOf(() =>
      annotateDrafts([
        { path: 'story.md', source: minimalStoryDraft('t-n1') }, // = node id in dlg.md
        { path: 'dlg.md', source: minimalDialogueDraft() },
      ]),
    );
    expect(issues[0]!.file).toBe('dlg.md');
    expect(issues[0]!.message).toContain('duplicate sentence id "t-n1"');
    expect(issues[0]!.message).toContain('pack-wide');
  });

  it('dialogue drafts join the identical-pack-meta rule', () => {
    const other = minimalDialogueDraft((lines) => {
      lines[lines.indexOf('  tags: ["test"]')] = '  tags: ["test", "extra"]';
    });
    const issues = issuesOf(() =>
      annotateDrafts([
        { path: 'story.md', source: minimalStoryDraft() },
        { path: 'dlg.md', source: other },
      ]),
    );
    expect(issues[0]!.message).toContain('"pack" section differs');
  });
});

describe('dialogue draft grammar errors', () => {
  it('a node without SPEAKER fails at the node heading', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('SPEAKER: mama'), 1);
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('node "t-n1" has no SPEAKER: line');
    expect(issues[0]!.line).toBeDefined();
  });

  it('a second terminator is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('NEXT: t-n2') + 1, 0, 'ENDING: e-x');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('already has NEXT:');
  });

  it('a node without any terminator is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('NEXT: t-n2'), 1);
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain(
      'node "t-n1" needs exactly one of NEXT:, ENDING:, or CHOICES:',
    );
  });

  it('a choice point with a single choice is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      const from = lines.indexOf('### t-n2-c2 -> t-n3');
      lines.splice(from, lines.indexOf('## t-n3') - from);
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('has 1 choice — a choice point needs 2–4');
  });

  it('ALT outside a choice block is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('NEXT: t-n2'), 0, 'ALT: Привет.');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('ALT: is only allowed inside');
  });

  it('a HINT without the "ru | en" shape is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('RU: Да.') + 2, 0, 'HINT: only english');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('HINT: must be "<ru nudge> | <en nudge>"');
  });

  it('a "###" heading outside CHOICES is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('NEXT: t-n2'), 0, '### t-x -> t-n3');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('only allowed after a CHOICES: line');
  });

  it('a choice heading without "-> <node-id>" is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines[lines.indexOf('### t-n2-c1 -> t-n3')] = '### t-n2-c1';
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('choice heading must be "### <choice-id> -> <node-id>"');
  });

  it('sentence content directly after CHOICES: is rejected', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines.splice(lines.indexOf('CHOICES:') + 1, 0, 'RU: Что?');
    });
    const issues = issuesOf(() => annotate(draft));
    expect(issues[0]!.message).toContain('content after CHOICES: must start with a "###');
  });

  it('parseDialogueDraft alone reports frontmatter problems with paths', () => {
    const draft = minimalDialogueDraft((lines) => {
      lines[lines.indexOf('  level: A1')] = '  level: D9'; // pack.level (first occurrence)
    });
    const issues = issuesOf(() => parseDialogueDraft('x.dialogue.md', draft));
    expect(issues[0]!.message).toContain('pack.level');
  });
});

describe('dialogue graph errors from broken fixtures (file:line)', () => {
  it('dead-branch: an unreachable node is flagged at its heading line', () => {
    const source = readFileSync(fixture('broken', 'dead-branch.dialogue.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'dead-branch.dialogue.md'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'dead-branch.dialogue.md',
      line: lineOf(source, (l) => l === '## bd-orphan'),
    });
    expect(issues[0]!.message).toContain('node "bd-orphan" is unreachable');
    expect(issues[0]!.message).toContain('dead branch');
  });

  it('trap-cycle: every trapped node + the orphaned ending are flagged', () => {
    const source = readFileSync(fixture('broken', 'trap-cycle.dialogue.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'trap-cycle.dialogue.md'));
    const messages = issues.map((i) => i.message).join('\n');
    expect(messages).toContain('node "tc-n1" can never reach an ending (dead trap');
    expect(messages).toContain('node "tc-n2" can never reach an ending (dead trap');
    expect(messages).toContain('ending "end-x" is never referenced by any node');
  });

  it('bad-refs: unknown speaker + dangling NEXT/ENDING are all collected', () => {
    const source = readFileSync(fixture('broken', 'bad-refs.dialogue.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'bad-refs.dialogue.md'));
    const messages = issues.map((i) => i.message).join('\n');
    expect(messages).toContain('SPEAKER "ghost" is not in the characters list');
    expect(messages).toContain('NEXT target "br-missing" is not a node in this draft');
    expect(messages).toContain('ENDING "end-missing" is not defined in the endings frontmatter');
    expect(issues.every((i) => i.line !== undefined)).toBe(true);
  });
});

describe('branch map', () => {
  it('renders the fixture dialogue deterministically (snapshot)', () => {
    expect(renderBranchMap(loadFixtureDialogue())).toMatchSnapshot();
  });

  it('flags a dead branch and an unreferenced ending in its warnings', () => {
    const dialogue = loadFixtureDialogue();
    const orphanSentence = structuredClone(dialogue.nodes[0]!.sentence);
    orphanSentence.id = 'din-orphan';
    const orphan: DialogueNode = {
      id: 'din-orphan',
      speakerId: 'mama',
      sentence: orphanSentence,
      next: 'din-orphan', // also a dead trap
    };
    dialogue.nodes.push(orphan);
    dialogue.endings.push({
      id: 'end-lost',
      title: { ru: 'Нигде', en: 'Nowhere' },
      recap: { ru: 'Никак.', en: 'No way.' },
      tone: 'strange',
    });
    const map = renderBranchMap(dialogue);
    expect(map).toContain('! node "din-orphan" is unreachable from the start — dead branch');
    expect(map).toContain('! ending "end-lost" is never referenced by any node');
    expect(map).toContain('(3 reachable)'); // of now 4 endings
  });
});

describe('CLI + validate + publish on the audio-less fixture pack', () => {
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

  it('annotate writes a validating dialogue pack and prints the branch map', () => {
    const dir = mkdtempSync(join(tmpdir(), 't25-cli-'));
    try {
      const out = join(dir, 'pack.json');
      const result = cli(['annotate', fixture('the-dinner.dialogue.md'), '-o', out]);
      expect(result.out).toContain('1 dialogue — schema-valid');
      expect(result.out).toContain('Branch map — «Ужин у мамы»');
      expect(result.out).toContain('3 endings (3 reachable)');
      expect(runValidate(out).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('annotate on a dead-branched draft exits 1 with a file:line error', () => {
    const draftPath = fixture('broken', 'dead-branch.dialogue.md');
    const source = readFileSync(draftPath, 'utf8');
    const result = cli(['annotate', draftPath], true);
    expect(result.code).toBe(1);
    expect(result.out).toContain(`${draftPath}:${lineOf(source, (l) => l === '## bd-orphan')}:`);
    expect(result.out).toContain('dead branch');
  });

  it('validate accepts the fixture pack and prints its branch map', () => {
    const result = cli(['validate', fixturePackPath]);
    expect(result.out).toContain('valid pack "a2-dialogue-001" v1');
    expect(result.out).toContain('Branch map — «Ужин у мамы»');
  });

  it('publish accepts the audio-less dialogue pack against a scratch content repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 't25-publish-'));
    try {
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'T25 Test');
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
      expect(manifest.packs).toHaveLength(1);
      expect(manifest.packs[0]).toMatchObject({
        id: 'a2-dialogue-001',
        version: 1,
        type: 'dialogue',
        level: 'A2',
      });

      // idempotent re-publish is a clean no-op
      expect(runPublish(join(fixturePackPath, '..'), dir).outcome).toBe('unchanged');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
