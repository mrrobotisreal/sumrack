import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeParsePack } from '../src';

const malformedDir = join(__dirname, 'malformed');
const load = (name: string) => JSON.parse(readFileSync(join(malformedDir, `${name}.json`), 'utf8'));

/** Each malformed fixture must fail with a specific issue at a precise path. */
const cases: Array<{ fixture: string; path: string; message: string }> = [
  { fixture: 'bad-cefr-level', path: 'level', message: 'Invalid option' },
  { fixture: 'version-zero', path: 'version', message: '>=1' },
  { fixture: 'missing-sentence-en', path: 'stories[0].sentences[0].en', message: 'Invalid input' },
  {
    fixture: 'punct-token-with-lemma',
    path: 'stories[0].sentences[0].tokens[2].lemma',
    message: 'must not carry',
  },
  {
    fixture: 'tokens-drift',
    path: 'stories[0].sentences[0].tokens',
    message: 'do not reconstruct',
  },
  {
    fixture: 'stamp-unknown-sentence',
    path: 'stories[0].audio[0].timestamps[0].sentenceId',
    message: 'unknown sentence "ghost-s99"',
  },
  {
    fixture: 'dialogue-dangling-next',
    path: 'dialogues[0].nodes[0].next',
    message: 'next "dlg-ghost" does not resolve to a node',
  },
  {
    fixture: 'dialogue-trap-cycle',
    path: 'dialogues[0].nodes[2]',
    message: 'dead trap',
  },
  {
    fixture: 'dialogue-unreachable-node',
    path: 'dialogues[0].nodes[4]',
    message: 'node "dlg-n5" is unreachable from startNodeId "dlg-n1"',
  },
];

describe('malformed pack fixtures produce specific, readable errors', () => {
  it.each(cases)('$fixture → issue at $path', ({ fixture, path, message }) => {
    const result = safeParsePack(load(fixture));
    expect(result.success).toBe(false);
    if (result.success) return;
    const hit = result.issues.find((i) => i.path === path || i.path.startsWith(path));
    expect(hit, `expected issue at "${path}", got:\n${result.message}`).toBeDefined();
    expect(hit!.message).toContain(message);
    // the summary line is human-readable and names the exact path
    expect(result.message).toContain('Pack validation failed');
    expect(result.message).toContain(path);
  });
});
