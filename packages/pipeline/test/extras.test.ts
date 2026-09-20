import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotateDrafts, DraftError, parseExtras } from '../src/index.ts';

/**
 * Pack extras (T17): lesson / prompts / exercises authored in one markdown
 * file and merged into the assembled pack — the authoring path for
 * course-unit and checkpoint packs.
 */

const pkgDir = join(__dirname, '..');
const referenceDraft = readFileSync(join(pkgDir, 'fixtures', 'the-photograph.draft.md'), 'utf8');

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DraftError);
    return (e as DraftError).issues;
  }
  throw new Error('expected a DraftError, but the call succeeded');
}

const unitExtras = `---
lesson:
  id: unit-lesson
  title: { ru: 'Где стоит?', en: 'Where does it stand?' }
  grammarTopics: [prepositional-location]
prompts:
  - id: unit-prompt-1
    level: A1
    prompt: { ru: 'Опишите вашу комнату.', en: 'Describe your room.' }
---
## Где стоит?

В **моей** комнате стоит зеркало.
`;

const checkpointExtras = `---
pack:
  id: a1-checkpoint-test
  version: 1
  type: checkpoint
  title: { ru: 'Тест', en: 'Test' }
  level: A1
  tags: ['checkpoint']
exercises:
  - id: ex-mc-1
    kind: multiple-choice
    direction: ru-en
    prompt: 'дверь'
    choices: ['door', 'window']
    correctIndex: 0
  - id: ex-cloze-1
    kind: cloze
    sentenceRu: 'В комнате стоит ___.'
    answer: 'зеркало'
    choices: ['зеркало', 'окно', 'стол']
---
`;

describe('parseExtras', () => {
  it('parses lesson meta + markdown body into a Lesson', () => {
    const extras = parseExtras('unit.extras.md', unitExtras);
    expect(extras.lesson).toMatchObject({
      id: 'unit-lesson',
      grammarTopics: ['prepositional-location'],
    });
    expect(extras.lesson!.body).toContain('В **моей** комнате стоит зеркало.');
    expect(extras.prompts).toHaveLength(1);
    expect(extras.pack).toBeUndefined();
  });

  it('NFC-normalizes and preserves ё in the body and frontmatter', () => {
    // и + combining breve (decomposed й) must come out composed; ё stays ё.
    const decomposed = unitExtras
      .replace('моей', 'мое\u0438\u0306')
      .replace('зеркало', 'ещё зеркало');
    const extras = parseExtras('unit.extras.md', decomposed);
    expect(extras.lesson!.body).toContain('моей');
    expect(extras.lesson!.body).toContain('ещё');
  });

  it('rejects a lesson without a body, and a body without lesson meta', () => {
    const noBody = unitExtras.split('---').slice(0, 2).join('---') + '---\n';
    expect(issuesOf(() => parseExtras('x.md', noBody))[0]!.message).toMatch(/no markdown body/);
    const noMeta = checkpointExtras.trimEnd() + '\nStray lesson text.\n';
    expect(issuesOf(() => parseExtras('x.md', noMeta))[0]!.message).toMatch(/no "lesson:" section/);
  });

  it('rejects invalid exercises with schema paths', () => {
    const bad = checkpointExtras.replace('correctIndex: 0', 'correctIndex: 9');
    expect(issuesOf(() => parseExtras('x.md', bad))[0]!.message).toMatch(/correctIndex/);
  });
});

describe('assemblePack with extras', () => {
  it('builds a story-less checkpoint pack from extras alone', () => {
    const extras = parseExtras('checkpoint.extras.md', checkpointExtras);
    const pack = annotateDrafts([], extras);
    expect(pack.type).toBe('checkpoint');
    expect(pack.stories).toHaveLength(0);
    expect(pack.exercises).toHaveLength(2);
  });

  it('merges lesson + prompts into a drafted pack (course-unit)', () => {
    const source = referenceDraft
      .replace('type: stories', 'type: course-unit')
      .replace('id: a1-creepypasta-002', 'id: a1-unit-test');
    const extras = parseExtras('unit.extras.md', unitExtras);
    const pack = annotateDrafts([{ path: 'draft.md', source }], extras);
    expect(pack.type).toBe('course-unit');
    expect(pack.lesson!.id).toBe('unit-lesson');
    expect(pack.prompts).toHaveLength(1);
    expect(pack.stories).toHaveLength(1);
  });

  it('refuses a course-unit draft without extras (schema: lesson required)', () => {
    const source = referenceDraft.replace('type: stories', 'type: course-unit');
    const issues = issuesOf(() => annotateDrafts([{ path: 'draft.md', source }]));
    expect(issues.some((i) => /lesson/.test(i.message))).toBe(true);
  });

  it('refuses extras pack meta that differs from the drafts', () => {
    const extras = parseExtras(
      'checkpoint.extras.md',
      checkpointExtras
        .replace('type: checkpoint', 'type: stories')
        .replace(/exercises:[\s\S]*---\n/, '---\n'),
    );
    const issues = issuesOf(() =>
      annotateDrafts([{ path: 'draft.md', source: referenceDraft }], extras),
    );
    expect(issues[0]!.message).toMatch(/extras "pack" section differs/);
  });

  it('refuses a story-less pack whose extras lack pack meta', () => {
    const extras = parseExtras('unit.extras.md', unitExtras);
    const issues = issuesOf(() => annotateDrafts([], extras));
    expect(issues[0]!.message).toMatch(/must carry its "pack:" meta/);
  });

  it('refuses duplicate exercise ids', () => {
    const dup = checkpointExtras.replace('id: ex-cloze-1', 'id: ex-mc-1');
    const extras = parseExtras('checkpoint.extras.md', dup);
    const issues = issuesOf(() => annotateDrafts([], extras));
    expect(issues.some((i) => /duplicate exercises id "ex-mc-1"/.test(i.message))).toBe(true);
  });
});

describe('theme & track extras (T30)', () => {
  const themedExtras = unitExtras.replace(
    '---\n## Где стоит?',
    `theme:
  scene: hallway
  accent: '#C08A4A'
track: family
---
## Где стоит?`,
  );

  it('round-trips theme + track from extras frontmatter into the pack JSON', () => {
    const source = referenceDraft
      .replace('type: stories', 'type: course-unit')
      .replace('id: a1-creepypasta-002', 'id: a1-unit-test');
    const extras = parseExtras('unit.extras.md', themedExtras);
    expect(extras.theme).toEqual({ scene: 'hallway', accent: '#C08A4A' });
    expect(extras.track).toBe('family');
    const pack = annotateDrafts([{ path: 'draft.md', source }], extras);
    expect(pack.theme).toEqual({ scene: 'hallway', accent: '#C08A4A' });
    expect(pack.track).toBe('family');
  });

  it('passes an unknown scene through (forward compatibility, app-side known set)', () => {
    const source = referenceDraft
      .replace('type: stories', 'type: course-unit')
      .replace('id: a1-creepypasta-002', 'id: a1-unit-test');
    const extras = parseExtras('unit.extras.md', themedExtras.replace('hallway', 'greenhouse'));
    const pack = annotateDrafts([{ path: 'draft.md', source }], extras);
    expect(pack.theme?.scene).toBe('greenhouse');
  });

  it('omits theme/track from the pack when unauthored (absent = main at the app layer)', () => {
    const source = referenceDraft
      .replace('type: stories', 'type: course-unit')
      .replace('id: a1-creepypasta-002', 'id: a1-unit-test');
    const pack = annotateDrafts(
      [{ path: 'draft.md', source }],
      parseExtras('unit.extras.md', unitExtras),
    );
    expect(pack.theme).toBeUndefined();
    expect(pack.track).toBeUndefined();
  });

  it('rejects a malformed theme accent with a frontmatter path', () => {
    const bad = themedExtras.replace(`'#C08A4A'`, `'ember-red'`);
    expect(issuesOf(() => parseExtras('x.md', bad))[0]!.message).toMatch(/accent/);
  });
});

describe('category & genre in extras pack meta (M14)', () => {
  const categorizedExtras = checkpointExtras
    .replace('type: checkpoint', 'type: stories')
    .replace("tags: ['checkpoint']", "tags: ['news']\n  category: news")
    .replace(/exercises:[\s\S]*---\n/, '---\n');

  it('parses category in the extras pack meta', () => {
    const extras = parseExtras('news.extras.md', categorizedExtras);
    expect(extras.pack?.category).toBe('news');
    expect(extras.pack?.genre).toBeUndefined();
  });

  it('a category in the extras that the drafts lack trips the identical-meta check', () => {
    // Same pack meta as the reference draft, plus a category the draft does not carry.
    const withCategory = categorizedExtras
      .replace('id: a1-checkpoint-test', 'id: a1-creepypasta-002')
      .replace(
        "title: { ru: 'Тест', en: 'Test' }",
        `title: { ru: 'Фотография', en: 'The Photograph' }`,
      )
      .replace(
        "tags: ['news']",
        `tags: ['creepypasta', 'horror', 'family', 'grammar:genitive', 'grammar:past-tense']`,
      );
    const extras = parseExtras('news.extras.md', withCategory);
    const issues = issuesOf(() =>
      annotateDrafts([{ path: 'draft.md', source: referenceDraft }], extras),
    );
    expect(issues[0]!.message).toMatch(/extras "pack" section differs/);
  });
});
