import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeParsePack, scenarioLines, type Scenario } from '@sumrak/schema';
import {
  annotateDrafts,
  DraftError,
  glossaryCoverage,
  parseScenarioDraft,
  renderCoverageReport,
  renderScenarioBranchMap,
  runPublish,
  runValidate,
  sniffDraftKind,
} from '../src/index.ts';

const pkgDir = join(__dirname, '..');
const fixture = (...p: string[]) => join(pkgDir, 'fixtures', ...p);
const referenceDraft = readFileSync(fixture('radio-check.scenario.md'), 'utf8');
const fixturePackPath = join(
  pkgDir,
  '..',
  'schema',
  'fixtures',
  'packs',
  'a1-scenario-fixture',
  'pack.json',
);
const loadFixtureScenario = (): Scenario =>
  JSON.parse(readFileSync(fixturePackPath, 'utf8')).scenarios[0] as Scenario;

const annotate = (source: string, path = 'draft.scenario.md') => annotateDrafts([{ path, source }]);

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

/** Mutate the reference draft line by line. */
const mutated = (mutate: (lines: string[]) => void) => {
  const lines = referenceDraft.split('\n');
  mutate(lines);
  return lines.join('\n');
};

describe('draft kind sniffing', () => {
  it('recognizes scenario drafts by their frontmatter', () => {
    expect(sniffDraftKind('x.md', referenceDraft)).toBe('scenario');
  });
});

describe('reference scenario draft round-trip', () => {
  it('annotates to a pack deep-equal to the schema fixture pack', () => {
    const pack = annotate(referenceDraft, 'radio-check.scenario.md');
    const sample = JSON.parse(readFileSync(fixturePackPath, 'utf8'));
    expect(pack).toEqual(sample);
  });

  it('follows the sentence-id convention (last say line = turn id; -a/-b; -conf/-hint/-sec; -react; gl -ex/-how; nudge-<kind>)', () => {
    const s = annotate(referenceDraft).scenarios![0]!;
    const t01 = s.turns[0]!;
    expect(t01.say.map((l) => l.sentence.id)).toEqual([
      'radio-a1-t01-a',
      'radio-a1-t01-b',
      'radio-a1-t01',
    ]);
    const t02 = s.turns[1]!;
    expect(t02.say.map((l) => l.sentence.id)).toEqual(['radio-a1-t02-a', 'radio-a1-t02']);
    expect(t02.retry!.confused.sentence.id).toBe('radio-a1-t02-conf');
    expect(t02.retry!.hint.sentence.id).toBe('radio-a1-t02-hint');
    expect(t02.retry!.second!.sentence.id).toBe('radio-a1-t02-sec');
    expect(t02.expect!.reject![0]!.react!.sentence.id).toBe('radio-a1-t02-react');
    expect(s.glossary[0]!.id).toBe('radio-a1-gl-check');
    expect(s.glossary[0]!.explain.sentence.id).toBe('radio-a1-gl-check-ex');
    expect(s.glossary[0]!.howToSay.sentence.id).toBe('radio-a1-gl-check-how');
    expect(s.glossary[2]!.id).toBe('radio-a1-gl-to-hear'); // «to hear» → to-hear
    expect(s.nudges.map((n) => n.line.sentence.id)).toEqual([
      'radio-a1-nudge-silence',
      'radio-a1-nudge-which-word',
      'radio-a1-nudge-dont-know',
    ]);
    // all ids distinct
    const ids = scenarioLines(s).map((r) => r.line.sentence.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parses the EXPECT grammar: free slot, forms slot with a spaced form, branchOn, reject -> REACT', () => {
    const s = annotate(referenceDraft).scenarios![0]!;
    const t02 = s.turns[1]!;
    expect(t02.expect!.slots[0]).toEqual({
      kind: 'free',
      id: 'name',
      required: true,
      minTokens: 1,
    });
    expect(t02.expect!.accept).toEqual(['Меня зовут Митч.', 'Я Митч.']);
    expect(t02.expect!.reject![0]!.forms).toEqual(['хорошо', 'спасибо']);
    const t03 = s.turns[2]!;
    const mood = t03.expect!.slots[0]!;
    expect(mood.kind).toBe('forms');
    if (mood.kind !== 'forms') return;
    expect(mood.acceptsNumber).toBe(false);
    expect(mood.options.map((o) => o.key)).toEqual(['good', 'bad', 'ok']);
    expect(mood.options[1]).toEqual({
      key: 'bad',
      lemma: 'плохо',
      forms: ['плохо', 'устал*', 'так себе', 'не очень'],
    });
    expect(t03.expect!.branchOn).toBe('mood');
    expect(t03.next).toEqual({
      on: { good: 'radio-a1-t04g', bad: 'radio-a1-t04b' },
      default: 'radio-a1-t04d',
    });
  });

  it('carries characters[].cues in the parsed draft but never into pack.json', () => {
    const parsed = parseScenarioDraft('radio-check.scenario.md', referenceDraft);
    expect(parsed.frontmatter.characters[0]!.cues?.confused).toContain('не совсем понял');
    const emitted = JSON.stringify(annotate(referenceDraft));
    expect(emitted).not.toContain('"cues"');
  });

  it('merges hand translit extras first, then generated candidates', () => {
    const s = annotate(referenceDraft).scenarios![0]!;
    const connection = s.glossary.find((g) => g.ru === 'связь')!;
    expect(connection.translit.slice(0, 2)).toEqual(['конекшн', 'канекшен']);
    expect(connection.translit.length).toBeGreaterThan(2);
    expect(new Set(connection.translit).size).toBe(connection.translit.length);
  });

  it('defaults startTurnId to the first turn block when omitted', () => {
    const source = referenceDraft.replace('  startTurnId: radio-a1-t01\n', '');
    expect(annotate(source).scenarios![0]!.startTurnId).toBe('radio-a1-t01');
  });

  it('a "| number" tail sets acceptsNumber, a lemma may contain spaces, "id:" overrides the glossary slug', () => {
    const source = mutated((lines) => {
      const i = lines.findIndex((l) => l.startsWith('  slot mood required forms:'));
      lines[i] =
        '  slot mood required forms: good=хорошо: хорошо | f95=девяносто пятый: девяносто пятый, 95 | number';
      lines[lines.indexOf('NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d')] =
        'NEXT: on good=radio-a1-t04g number=radio-a1-t04b default=radio-a1-t04d';
      const g = lines.findIndex((l) => l.startsWith('### проверка |'));
      lines[g] =
        '### проверка | check | forms: проверка, проверк* | translit: чек | id: check-word';
    });
    const s = annotate(source).scenarios![0]!;
    const mood = s.turns[2]!.expect!.slots[0]!;
    if (mood.kind !== 'forms') throw new Error('forms slot expected');
    expect(mood.acceptsNumber).toBe(true);
    expect(mood.options[1]).toEqual({
      key: 'f95',
      lemma: 'девяносто пятый',
      forms: ['девяносто пятый', '95'],
    });
    expect(s.glossary[0]!.id).toBe('radio-a1-gl-check-word');
    expect(s.glossary[0]!.explain.sentence.id).toBe('radio-a1-gl-check-word-ex');
  });
});

describe('scenario draft grammar errors (file:line)', () => {
  it('a turn without SPEAKER / SAY / terminator is reported at its heading', () => {
    const noSpeaker = mutated((l) => l.splice(l.indexOf('SPEAKER: host'), 1));
    expect(issuesOf(() => annotate(noSpeaker))[0]!.message).toContain(
      'turn "radio-a1-t01" has no SPEAKER: line',
    );
    const noNext = mutated((l) => l.splice(l.indexOf('NEXT: radio-a1-t02'), 1));
    expect(issuesOf(() => annotate(noNext))[0]!.message).toContain(
      'needs exactly one of NEXT: or ENDING:',
    );
  });

  it('more than 3 SAY lines is an error', () => {
    const source = mutated((l) => {
      const at = l.indexOf('NEXT: radio-a1-t02');
      l.splice(
        at,
        0,
        'SAY:',
        'RU: Да.',
        'EN: Yes.',
        '| text | lemma | translation | pos | grammar | level | note |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| Да | да | yes | part |  | A1 |  |',
        '| . |  |  |  |  |  |  |',
      );
    });
    expect(issuesOf(() => annotate(source))[0]!.message).toContain('more than 3 SAY: lines');
  });

  it('EXPECT without RETRY and RETRY without EXPECT', () => {
    const source = readFileSync(fixture('broken', 'expect-no-retry.scenario.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'expect-no-retry.scenario.md'));
    expect(issues[0]).toMatchObject({
      file: 'expect-no-retry.scenario.md',
      line: lineOf(source, (l) => l === 'EXPECT:'),
    });
    expect(issues[0]!.message).toContain('turn "radio-a1-t02" has EXPECT: but no RETRY:');

    const orphanRetry = mutated((l) => {
      const from = l.indexOf('EXPECT:');
      const to = l.indexOf('RETRY:');
      l.splice(from, to - from);
    });
    expect(
      issuesOf(() => annotate(orphanRetry))
        .map((i) => i.message)
        .join('\n'),
    ).toContain('has RETRY: but no EXPECT:');
  });

  it('a malformed slot line, an option without a lemma colon, and a stray sub-key are all located', () => {
    const source = mutated((l) => {
      const i = l.findIndex((x) => x.startsWith('  slot mood required forms:'));
      l[i] = '  slot mood forms: good=хорошо: хорошо';
      l.splice(
        l.indexOf('  slot name required free minTokens=1') + 1,
        0,
        '  slot bad required forms: good=хорошо',
      );
      l.splice(l.indexOf('NEXT: radio-a1-t02'), 0, '  accept: Да.');
    });
    const messages = issuesOf(() => annotate(source)).map((i) => `${i.line}: ${i.message}`);
    expect(
      messages.some((m) => m.includes('slot line must be "slot <id> <required|optional>')),
    ).toBe(true);
    expect(messages.some((m) => m.includes('must be "<key>=<lemma>: <form>, <form*>"'))).toBe(true);
    expect(messages.some((m) => m.includes('unrecognized line'))).toBe(true);
  });

  it('LIFELINE needs both halves; CONFUSED outside RETRY is rejected', () => {
    const source = mutated((l) => {
      l[l.indexOf('  LIFELINE: «Меня зовут …». | "Меня зовут …" (My name is …).')] =
        '  LIFELINE: только русский';
      l.splice(l.indexOf('NEXT: radio-a1-t02'), 0, 'CONFUSED:');
    });
    const messages = issuesOf(() => annotate(source)).map((i) => i.message);
    expect(messages).toContain(
      'LIFELINE: must be "<ru hint> | <en hint>" (escape a literal | as \\|)',
    );
    expect(messages).toContain('CONFUSED: is only allowed inside RETRY:');
  });

  it('NEXT: on … needs a default and key=id pairs', () => {
    const noDefault = mutated((l) => {
      l[l.indexOf('NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d')] =
        'NEXT: on good=radio-a1-t04g bad=radio-a1-t04b';
    });
    expect(issuesOf(() => annotate(noDefault))[0]!.message).toContain(
      'needs a "default=<turn-id>"',
    );
    const junk = mutated((l) => {
      l[l.indexOf('NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d')] =
        'NEXT: on good radio-a1-t04g default=radio-a1-t04d';
    });
    expect(issuesOf(() => annotate(junk))[0]!.message).toContain('expects "<key>=<turn-id>" pairs');
  });

  it('nudges: an unknown kind and a missing kind are both reported', () => {
    const source = mutated((l) => {
      l[l.indexOf('### dont-know')] = '### shrug';
    });
    const messages = issuesOf(() => annotate(source)).map((i) => i.message);
    expect(messages.some((m) => m.includes('nudge heading must be one of'))).toBe(true);
    expect(messages.some((m) => m.includes('has no "### dont-know" nudge'))).toBe(true);
  });

  it('"###" outside glossary/nudges and EXPLAIN inside a turn are rejected', () => {
    const source = mutated((l) => {
      l.splice(l.indexOf('NEXT: radio-a1-t02'), 0, '### stray', 'EXPLAIN:');
    });
    const messages = issuesOf(() => annotate(source)).map((i) => i.message);
    expect(messages.some((m) => m.includes('"###" headings are only allowed inside'))).toBe(true);
    expect(
      messages.some((m) => m.includes('EXPLAIN: is only allowed inside a "## glossary" entry')),
    ).toBe(true);
  });
});

describe('scenario assembly errors from broken fixtures (file:line)', () => {
  it('dangling-on: an "on" target that is not a turn is flagged at the NEXT line', () => {
    const source = readFileSync(fixture('broken', 'dangling-on.scenario.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'dangling-on.scenario.md'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'dangling-on.scenario.md',
      line: lineOf(source, (l) => l.startsWith('NEXT: on good=')),
    });
    expect(issues[0]!.message).toContain(
      'NEXT on bad=radio-a1-t04x: "radio-a1-t04x" is not a turn in this draft',
    );
  });

  it('branch-on-free: branching on a free slot is flagged at the branchOn line', () => {
    const source = readFileSync(fixture('broken', 'branch-on-free.scenario.md'), 'utf8');
    const issues = issuesOf(() => annotate(source, 'branch-on-free.scenario.md'));
    expect(issues[0]).toMatchObject({
      line: lineOf(source, (l) => l === '  branchOn: name'),
    });
    expect(issues[0]!.message).toContain('branchOn "name" is a free slot');
  });

  it('unknown speaker, dangling ENDING, unknown branch key, dead branch, unreferenced ending', () => {
    const speaker = mutated((l) => (l[l.indexOf('SPEAKER: host')] = 'SPEAKER: ghost'));
    expect(issuesOf(() => annotate(speaker))[0]!.message).toContain(
      'SPEAKER "ghost" is not in the characters list',
    );
    const ending = mutated((l) => (l[l.indexOf('ENDING: end-ok')] = 'ENDING: end-x'));
    expect(issuesOf(() => annotate(ending))[0]!.message).toContain(
      'ENDING "end-x" is not defined in the endings frontmatter',
    );
    const key = mutated((l) => {
      l[l.indexOf('NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d')] =
        'NEXT: on great=radio-a1-t04g default=radio-a1-t04d';
    });
    const keyMessages = issuesOf(() => annotate(key)).map((i) => i.message);
    expect(
      keyMessages.some((m) =>
        m.includes('key "great" is not a branch key of slot "mood" (allowed: good, bad, ok)'),
      ),
    ).toBe(true);
    // Only default + one key now → t04b unreachable would ALSO fire, but reference
    // errors stop the graph pass; fix the key to see the graph error alone:
    const dead = mutated((l) => {
      l[l.indexOf('NEXT: on good=radio-a1-t04g bad=radio-a1-t04b default=radio-a1-t04d')] =
        'NEXT: on good=radio-a1-t04g default=radio-a1-t04d';
    });
    const deadIssues = issuesOf(() => annotate(dead));
    expect(deadIssues).toHaveLength(1);
    expect(deadIssues[0]!.message).toContain('turn "radio-a1-t04b" is unreachable');
    expect(deadIssues[0]!.line).toBe(lineOf(dead, (l) => l === '## radio-a1-t04b'));
    const orphanEnding = mutated((l) => {
      l.splice(
        l.indexOf('---', 1),
        0,
        '  - id: end-lost',
        "    title: { ru: 'Нигде', en: 'Nowhere' }",
        "    recap: { ru: 'Никак.', en: 'No way.' }",
        '    tone: strange',
      );
    });
    expect(issuesOf(() => annotate(orphanEnding))[0]!.message).toContain(
      'ending "end-lost" is never referenced by any turn',
    );
  });

  it('a duplicate turn id, duplicate slot id and a player speaker are collected', () => {
    const source = mutated((l) => {
      l[l.indexOf('## radio-a1-t04d')] = '## radio-a1-t04b';
      l.splice(
        l.indexOf('  slot name required free minTokens=1') + 1,
        0,
        '  slot name optional number',
      );
      l[l.lastIndexOf('SPEAKER: host')] = 'SPEAKER: player';
    });
    const messages = issuesOf(() => annotate(source)).map((i) => i.message);
    expect(messages.some((m) => m.includes('duplicate turn id "radio-a1-t04b"'))).toBe(true);
    expect(messages.some((m) => m.includes('duplicate slot id "name"'))).toBe(true);
    expect(messages.some((m) => m.includes('speaks as "player"'))).toBe(true);
  });

  it('sentence ids collide pack-wide with a story draft', () => {
    const story = [
      '---',
      'pack:',
      '  id: a1-scenario-fixture',
      '  version: 1',
      '  type: scenario',
      "  title: { ru: 'Проверка связи', en: 'Sound Check' }",
      '  level: A1',
      "  tags: ['scenario', 'fixture', 'radio']",
      'story:',
      '  id: st',
      "  title: { ru: 'Т', en: 'T' }",
      '  level: A1',
      '---',
      '',
      '## radio-a1-t02-conf',
      '',
      'RU: Да.',
      'EN: Yes.',
      '',
      '| text | lemma | translation | pos | grammar | level | note |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| Да | да | yes | part |  | A1 |  |',
      '| . |  |  |  |  |  |  |',
      '',
    ].join('\n');
    const issues = issuesOf(() =>
      annotateDrafts([
        { path: 'st.md', source: story },
        { path: 'scn.md', source: referenceDraft },
      ]),
    );
    expect(issues[0]!.message).toContain('duplicate sentence id "radio-a1-t02-conf"');
    expect(issues[0]!.file).toBe('scn.md');
  });
});

describe('broken pack.json fixtures — schema-level (path-precise)', () => {
  const load = (name: string) => JSON.parse(readFileSync(fixture('broken', name), 'utf8'));

  it('half-voiced.scenario.pack.json: names every unvoiced line', () => {
    const result = safeParsePack(load('half-voiced.scenario.pack.json'));
    expect(result.success).toBe(false);
    if (result.success) return;
    const first = result.issues.find((i) => i.path === 'scenarios[0].turns[0].say[1].audio');
    expect(first?.message).toContain('say line "radio-a1-t01-b" has none');
    expect(result.issues.some((i) => i.path === 'scenarios[0].nudges[2].line.audio')).toBe(true);
    expect(result.issues.some((i) => i.path === 'scenarios[0].glossary[0].howToSay.audio')).toBe(
      true,
    );
  });

  it('mouth-mismatch.scenario.pack.json: exactly one issue, at the mouth track', () => {
    const result = safeParsePack(load('mouth-mismatch.scenario.pack.json'));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.path).toBe('scenarios[0].turns[1].say[1].audio.mouth');
    expect(result.issues[0]!.message).toContain(
      'mouth track has 40 steps but the audio lasts 2000ms = 50 steps of 40ms',
    );
  });
});

describe('scenario branch map + glossary coverage', () => {
  it('renders the fixture scenario deterministically (snapshot)', () => {
    expect(renderScenarioBranchMap(loadFixtureScenario())).toMatchSnapshot();
  });

  it('shows the expect column and the on/default edges', () => {
    const map = renderScenarioBranchMap(loadFixtureScenario());
    expect(map).toContain('[name: free≥1 ✗1]');
    expect(map).toContain('[mood: good|bad|ok ⇢mood]');
    expect(map).toContain('mood: good → radio-a1-t04g');
    expect(map).toContain('mood: bad → radio-a1-t04b');
    expect(map).toContain('mood: default → radio-a1-t04d');
    expect(map).toContain('⇒ end-ok');
    expect(map).toContain('1 ending (1 reachable)');
  });

  it('the coverage report lists exactly «отлично» and «эфир»', () => {
    const report = glossaryCoverage(loadFixtureScenario());
    expect(report.gaps.map((g) => g.lemma).sort()).toEqual(['отлично', 'эфир']);
    const efir = report.gaps.find((g) => g.lemma === 'эфир')!;
    expect(efir.count).toBe(3);
    expect(efir.sentenceIds).toEqual(['radio-a1-t04g', 'radio-a1-t04b', 'radio-a1-t04d']);
    expect(report.covered).toBe(report.contentLemmas - 2);
    const text = renderCoverageReport(report);
    expect(text).toContain('2 uncovered');
    expect(text).toContain('«эфир» (noun) ×3');
    expect(text).toContain('«отлично» (adv) ×1');
  });

  it('a glob form covers a lemma; a covered scenario renders ✓', () => {
    const scenario = loadFixtureScenario();
    scenario.glossary.push({
      ...scenario.glossary[0]!,
      id: 'x-efir',
      ru: 'эфир',
      en: 'air',
      forms: ['эфир*'],
      explain: { sentence: { ...scenario.glossary[0]!.explain.sentence, id: 'x-efir-ex' } },
      howToSay: { sentence: { ...scenario.glossary[0]!.howToSay.sentence, id: 'x-efir-how' } },
    });
    scenario.glossary.push({
      ...scenario.glossary[0]!,
      id: 'x-great',
      ru: 'великолепно',
      en: 'great',
      forms: ['отличн*'],
      explain: { sentence: { ...scenario.glossary[0]!.explain.sentence, id: 'x-great-ex' } },
      howToSay: { sentence: { ...scenario.glossary[0]!.howToSay.sentence, id: 'x-great-how' } },
    });
    const report = glossaryCoverage(scenario);
    expect(report.gaps).toEqual([]);
    expect(renderCoverageReport(report)).toMatch(/covered ✓$/);
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

  it('annotate writes a validating scenario pack and prints the branch map + coverage', () => {
    const dir = mkdtempSync(join(tmpdir(), 't56-cli-'));
    try {
      const out = join(dir, 'pack.json');
      const result = cli(['annotate', fixture('radio-check.scenario.md'), '-o', out]);
      expect(result.out).toContain('1 scenario — schema-valid');
      expect(result.out).toContain('Branch map — «Проверка связи»');
      expect(result.out).toContain('mood: good → radio-a1-t04g');
      expect(result.out).toContain('Glossary coverage — radio-a1');
      expect(result.out).toContain('«отлично»');
      expect(result.out).toContain('«эфир»');
      expect(runValidate(out).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('annotate on the dangling-on draft exits 1 with a file:line error', () => {
    const draftPath = fixture('broken', 'dangling-on.scenario.md');
    const source = readFileSync(draftPath, 'utf8');
    const result = cli(['annotate', draftPath], true);
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      `${draftPath}:${lineOf(source, (l) => l.startsWith('NEXT: on good='))}:`,
    );
    expect(result.out).toContain('is not a turn in this draft');
  });

  it('validate accepts the fixture pack and prints its branch map + coverage', () => {
    const result = cli(['validate', fixturePackPath]);
    expect(result.out).toContain('valid pack "a1-scenario-fixture" v1');
    expect(result.out).toContain('mood: default → radio-a1-t04d');
    expect(result.out).toContain('2 uncovered');
  });

  it('validate rejects the broken pack.json fixtures with path-precise messages', () => {
    const result = cli(['validate', fixture('broken', 'mouth-mismatch.scenario.pack.json')], true);
    expect(result.code).toBe(1);
    expect(result.out).toContain(
      'scenarios[0].turns[1].say[1].audio.mouth: mouth track has 40 steps',
    );
  });

  it('publish accepts the audio-less scenario pack against a scratch content repo (pack.json only)', () => {
    const dir = mkdtempSync(join(tmpdir(), 't56-publish-'));
    try {
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'T56 Test');
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
      expect(Object.keys(manifest.packs[0]).sort()).toEqual(
        ['bytes', 'files', 'id', 'level', 'title', 'type', 'version'].sort(),
      );
      expect(manifest.packs[0]).toMatchObject({
        id: 'a1-scenario-fixture',
        version: 1,
        type: 'scenario',
        level: 'A1',
      });
      expect(runPublish(join(fixturePackPath, '..'), dir).outcome).toBe('unchanged');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scenario draft — normalization and glossary errors', () => {
  it('preserves ё and NFC-normalizes decomposed input through parse → emit', () => {
    const source = mutated((l) => {
      const i = l.indexOf('  LIFELINE: «Меня зовут …». | "Меня зовут …" (My name is …).');
      l[i] =
        `  LIFELINE: «Меня зовут …». ${'Ещё раз.'.normalize('NFD')} | "Меня зовут …" (My name is …).`;
    });
    const emitted = JSON.stringify(annotate(source));
    expect(emitted).toContain('Ещё раз.');
    expect(emitted).not.toContain('̈'); // never decomposed
  });

  it('glossary: a heading without forms is a parse error; a duplicate headword an assembly error', () => {
    const heading = mutated((l) => {
      const g = l.findIndex((x) => x.startsWith('### проверка |'));
      l[g] = '### проверка | check';
    });
    const issues = issuesOf(() => annotate(heading));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('glossary heading must be');
    expect(issues[0]!.line).toBe(lineOf(heading, (x) => x === '### проверка | check'));

    const dup = mutated((l) => {
      const s2 = l.findIndex((x) => x.startsWith('### связь |'));
      l[s2] = '### Хорошо | connection | forms: связь | id: dup';
    });
    const dupIssues = issuesOf(() => annotate(dup));
    expect(
      dupIssues
        .map((i) => i.message)
        .some((m) => m.toLowerCase().includes(`duplicate glossary headword "хорошо"`)),
    ).toBe(true);
  });
});
