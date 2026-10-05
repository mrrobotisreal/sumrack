import type { ExamSubtestKind } from '@sumrak/schema';

/**
 * The TORFL §3.4 topic slugs, per subtest kind — DATA FOR THE VALIDATE REPORT
 * ONLY (the topic census flags unknown slugs with `?`). The app's label table
 * arrives in T69 (`features/torfl/topics.ts`); packs carry slugs, and an
 * unknown slug is a warning, never an error (forward compatibility).
 */
export const EXAM_TOPICS: Readonly<Record<ExamSubtestKind, readonly string[]>> = {
  lexgram: [
    'lex-verbs',
    'lex-family',
    'lex-negation',
    'agr',
    'pron',
    'case-prep',
    'case-acc',
    'case-gen',
    'case-dat',
    'case-instr',
    'verb-forms',
    'verb-aspect',
    'verb-motion',
    'conj',
  ],
  reading: ['read-continue', 'read-signs', 'read-topic', 'read-detail'],
  listening: ['listen-where', 'listen-who', 'listen-phrase', 'listen-detail', 'listen-info'],
  writing: ['write-letter'],
  speaking: ['speak-reply', 'speak-situation', 'speak-monologue'],
};

/** Every known slug → its subtest kind. */
export const EXAM_TOPIC_KIND: ReadonlyMap<string, ExamSubtestKind> = new Map(
  Object.entries(EXAM_TOPICS).flatMap(([kind, slugs]) =>
    slugs.map((slug) => [slug, kind as ExamSubtestKind] as const),
  ),
);
