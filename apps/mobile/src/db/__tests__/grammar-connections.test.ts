import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { importPack } from '../importer';
import { createGrammarConnectionsRepo } from '../repositories/grammar-connections';
import { createReadingRepo } from '../repositories/reading';
import { createTestDb } from './helpers';

function pack(id = 'a1-no-end-house-001', version = 3, type = 'stories') {
  return {
    id,
    version,
    type,
    title: { ru: 'Дом', en: 'House' },
    level: 'A1',
    tags: [],
    stories: [
      {
        id: 'part-1',
        title: { ru: 'Первая часть', en: 'Part one' },
        level: 'A1',
        audio: [],
        sentences: [
          { id: 'nea1p1-s04', ru: 'Мы дружили в колледже.' },
          {
            id: 'nea1p1-s08',
            ru: 'После колледжа я жил в маленькой квартире и видел Питера редко.',
          },
          { id: 'unreviewed', ru: 'Я в комнате.' },
        ].map((source) => ({
          ...source,
          en: 'Fixture translation.',
          grammarTopics: ['prepositional-location'],
          tokens: (source.ru.match(/[\p{L}]+|[^\s\p{L}]/gu) ?? []).map((text) =>
            text === '.'
              ? { text, isPunct: true }
              : {
                  text,
                  lemma: text.toLowerCase(),
                  pos: ['колледже', 'квартире', 'комнате'].includes(text) ? 'noun' : 'pron',
                  grammar: 'prep.',
                  translation: 'fixture',
                  level: 'A1',
                },
          ),
        })),
      },
    ],
  };
}

describe('familiar grammar examples', () => {
  it('fails closed before reading, bounds future sentences, and does not move progress', async () => {
    const db = createTestDb();
    await importPack(db, pack());
    const repo = createGrammarConnectionsRepo(db);
    expect(await repo.familiarExamples()).toEqual([]);
    await createReadingRepo(db).savePosition('a1-no-end-house-001', 'part-1', 0);
    const before = db.all(sql`SELECT * FROM story_progress`);
    expect((await repo.familiarExamples()).map((x) => x.sentenceId)).toEqual(['nea1p1-s04']);
    expect(await repo.example('a1-no-end-house-001', 'part-1', 'nea1p1-s08')).toBeNull();
    expect(await repo.familiarExamples({ pos: 'noun', grammarIncludes: ['acc.'] })).toEqual([]);
    expect(await repo.familiarExamples({ pos: 'noun', lemmaIn: ['колледже'] })).toHaveLength(1);
    expect(db.all(sql`SELECT * FROM story_progress`)).toEqual(before);
    expect(db.all(sql`SELECT * FROM encounters`)).toHaveLength(0);
  });
  it('rejects stale pack versions, reserved packs and malformed queries', async () => {
    const db = createTestDb();
    await importPack(db, pack());
    await importPack(db, pack('a1-torfl-mock-004'));
    const reading = createReadingRepo(db);
    await reading.markFinished('a1-no-end-house-001', 'part-1');
    await reading.markFinished('a1-torfl-mock-004', 'part-1');
    const repo = createGrammarConnectionsRepo(db);
    expect(await repo.familiarExamples()).toHaveLength(2);
    await importPack(db, pack('a1-no-end-house-001', 4));
    expect(await repo.familiarExamples()).toEqual([]);
    expect(await repo.familiarExamples({ unexpected: 'noun' })).toEqual([]);
  });
});
