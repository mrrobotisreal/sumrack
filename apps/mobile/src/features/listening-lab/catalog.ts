import { z } from 'zod';

import data from './catalog.json';

export const YoPolicySchema = z.enum(['strict', 'fold']);
export type YoPolicy = z.infer<typeof YoPolicySchema>;
export const EndingPairSchema = z.object({
  expected: z.string(),
  actual: z.string(),
  note: z.string(),
});
export type EndingPair = z.infer<typeof EndingPairSchema>;
const StampSchema = z.object({
  sentenceId: z.string(),
  tokenIndex: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
});
export const SegmentSchema = z
  .object({
    id: z.string(),
    level: z.enum(['A1', 'A2']),
    source: z.object({
      packId: z.enum(['a1-torfl-listening-001', 'a2-torfl-listening-001']),
      packVersion: z.number().int().positive(),
      storyId: z.string(),
      sentenceId: z.string(),
      trackId: z.string(),
      file: z.string(),
      durationMs: z.number().positive(),
      startMs: z.number().nonnegative(),
      endMs: z.number().positive(),
      spoilerThroughSentenceId: z.string(),
      stamps: z.array(StampSchema).min(3),
    }),
    transcript: z.string().min(1),
    translation: z.string().min(1),
    meaning: z.object({
      question: z.string(),
      options: z.array(z.string()).length(3),
      correctIndex: z.number().int().min(0).max(2),
    }),
    yoPolicy: YoPolicySchema,
    endingPairs: z.array(EndingPairSchema),
    review: z.object({
      source: z.literal('published-pack-text-and-stamps'),
      checkedAt: z.string(),
      authorCheck: z.literal('meaning-key-reviewed-against-source-text'),
      earCheck: z.literal('pending-T111'),
    }),
  })
  .superRefine((s, ctx) => {
    if (s.source.endMs <= s.source.startMs || s.source.endMs > s.source.durationMs)
      ctx.addIssue({ code: 'custom', message: 'Invalid sentence boundary' });
    if (
      s.source.spoilerThroughSentenceId !== s.source.sentenceId ||
      s.source.stamps.some(
        (w) =>
          w.sentenceId !== s.source.sentenceId ||
          w.startMs < s.source.startMs ||
          w.endMs > s.source.endMs ||
          w.endMs <= w.startMs,
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Incomplete or inconsistent sentence stamps' });
  });
export type ListeningSegment = z.infer<typeof SegmentSchema>;
export const catalog = z
  .object({ version: z.literal(1), segments: z.array(SegmentSchema).length(20) })
  .parse(data);
if (new Set(catalog.segments.map((s) => s.id)).size !== catalog.segments.length)
  throw new Error('Duplicate listening segment');
export const LISTENING_MODE = 'listening-lab';
