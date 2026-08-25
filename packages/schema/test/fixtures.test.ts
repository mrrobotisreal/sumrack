import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest, parsePack, type Pack } from '../src';

const fixturesDir = join(__dirname, '..', 'fixtures');
const packDir = (id: string) => join(fixturesDir, 'packs', id);
const loadPack = (id: string): Pack =>
  parsePack(JSON.parse(readFileSync(join(packDir(id), 'pack.json'), 'utf8')));

describe('sample pack fixtures', () => {
  it('a1-creepypasta-001 («Стук в стене») validates', () => {
    const pack = loadPack('a1-creepypasta-001');
    expect(pack.stories).toHaveLength(1);
    expect(pack.stories[0]!.sentences.length).toBeGreaterThanOrEqual(8);
  });

  it('a1-creepypasta-002 («Фотография») validates', () => {
    const pack = loadPack('a1-creepypasta-002');
    expect(pack.stories[0]!.sentences.length).toBeGreaterThanOrEqual(8);
  });

  it('every word token is fully annotated (lemma/translation/pos/level)', () => {
    for (const id of ['a1-creepypasta-001', 'a1-creepypasta-002']) {
      for (const story of loadPack(id).stories) {
        for (const sentence of story.sentences) {
          for (const token of sentence.tokens) {
            if (token.isPunct) continue;
            const where = `${id}/${sentence.id}/"${token.text}"`;
            expect(token.lemma, `${where} lemma`).toBeDefined();
            expect(token.translation, `${where} translation`).toBeDefined();
            expect(token.pos, `${where} pos`).toBeDefined();
            expect(token.level, `${where} level`).toBeDefined();
          }
        }
      }
    }
  });

  it('a1-prompts-001 («Первые страницы») validates as a prompts pack', () => {
    const pack = loadPack('a1-prompts-001');
    expect(pack.type).toBe('prompts');
    expect(pack.stories).toHaveLength(0);
    expect(pack.prompts!.length).toBeGreaterThanOrEqual(12);
    // level-appropriate surfacing (T15) needs both A1 and A2 prompts to filter
    const levels = new Set(pack.prompts!.map((p) => p.level));
    expect(levels.has('A1')).toBe(true);
    expect(levels.has('A2')).toBe(true);
    // prompt ids unique within the pack
    const ids = pack.prompts!.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a2-dialogue-001 («Ужин у мамы») validates as a dialogue pack', () => {
    const pack = loadPack('a2-dialogue-001');
    expect(pack.type).toBe('dialogue');
    expect(pack.stories).toHaveLength(0);
    const dialogue = pack.dialogues![0]!;
    // The T25 acceptance shape: 8–12 nodes, ≥2 choice points, 2–3 endings
    // incl. a strange one, a trap-adjacent cycle, asrAlternates + hint used.
    expect(dialogue.nodes.length).toBeGreaterThanOrEqual(8);
    expect(dialogue.nodes.length).toBeLessThanOrEqual(12);
    const choiceNodes = dialogue.nodes.filter((n) => n.choices !== undefined);
    expect(choiceNodes.length).toBeGreaterThanOrEqual(2);
    expect(dialogue.endings.map((e) => e.tone).sort()).toEqual(['bad', 'good', 'strange']);
    expect(dialogue.nodes.some((n) => n.choices?.some((c) => c.asrAlternates))).toBe(true);
    expect(dialogue.nodes.some((n) => n.choices?.some((c) => c.hint))).toBe(true);
    // the «Ещё борща?» loop: din-n07 cycles back to the choice point din-n06
    expect(dialogue.nodes.find((n) => n.id === 'din-n07')!.next).toBe('din-n06');
    // every dialogue word token is fully annotated, story-style
    for (const node of dialogue.nodes) {
      const sentences = [node.sentence, ...(node.choices?.map((c) => c.sentence) ?? [])];
      for (const sentence of sentences) {
        for (const token of sentence.tokens) {
          if (token.isPunct) continue;
          const where = `${sentence.id}/"${token.text}"`;
          expect(token.lemma, `${where} lemma`).toBeDefined();
          expect(token.translation, `${where} translation`).toBeDefined();
          expect(token.pos, `${where} pos`).toBeDefined();
          expect(token.level, `${where} level`).toBeDefined();
        }
      }
    }
  });

  it('ё is preserved in content (never normalized to е)', () => {
    const raw = readFileSync(join(packDir('a1-creepypasta-002'), 'pack.json'), 'utf8');
    expect(raw).toContain('чёрные');
    expect(raw).toContain('моём');
  });

  it('the karaoke fixture track has monotonic, in-range word stamps and a real audio file', () => {
    const pack = loadPack('a1-creepypasta-001');
    const story = pack.stories[0]!;
    const track = story.audio[0]!;
    expect(track).toBeDefined();
    expect(track.timestamps.length).toBeGreaterThan(0);

    // monotonic and non-overlapping
    for (let i = 1; i < track.timestamps.length; i++) {
      expect(track.timestamps[i]!.startMs).toBeGreaterThanOrEqual(track.timestamps[i - 1]!.endMs);
    }
    // covers every word (non-punct) token of every sentence
    const wordTokenCount = story.sentences.reduce(
      (sum, s) => sum + s.tokens.filter((t) => !t.isPunct).length,
      0,
    );
    expect(track.timestamps).toHaveLength(wordTokenCount);
    // the silent opus exists and is non-empty
    const opus = join(packDir(pack.id), track.file);
    expect(existsSync(opus)).toBe(true);
    expect(statSync(opus).size).toBeGreaterThan(0);
  });
});

describe('manifest fixture', () => {
  it('validates and covers all sample packs', () => {
    const manifest = parseManifest(
      JSON.parse(readFileSync(join(fixturesDir, 'manifest.json'), 'utf8')),
    );
    const ids = manifest.packs.map((p) => p.id).sort();
    expect(ids).toEqual(['a1-creepypasta-001', 'a1-creepypasta-002', 'a1-prompts-001']);
  });

  it('bytes and sha256 hashes match the files on disk', () => {
    const manifest = parseManifest(
      JSON.parse(readFileSync(join(fixturesDir, 'manifest.json'), 'utf8')),
    );
    for (const entry of manifest.packs) {
      let bytes = 0;
      for (const file of entry.files) {
        const buf = readFileSync(join(packDir(entry.id), file.path));
        bytes += buf.length;
        expect(createHash('sha256').update(buf).digest('hex'), `${entry.id}/${file.path}`).toBe(
          file.sha256,
        );
      }
      expect(bytes, `${entry.id} bytes`).toBe(entry.bytes);
    }
  });

  it('manifest entries mirror the pack metadata', () => {
    const manifest = parseManifest(
      JSON.parse(readFileSync(join(fixturesDir, 'manifest.json'), 'utf8')),
    );
    for (const entry of manifest.packs) {
      const pack = loadPack(entry.id);
      expect(entry.version).toBe(pack.version);
      expect(entry.type).toBe(pack.type);
      expect(entry.level).toBe(pack.level);
      expect(entry.title).toEqual(pack.title);
    }
  });
});
