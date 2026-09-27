import { z } from 'zod';

/**
 * The Whisper multilingual **assist** model (T59, SPEAKING_SCENARIOS §11 +
 * §1.3 decision 3): an optional second recognizer that re-decodes a
 * scenario attempt in English so «Как сказать <english word>?» can find the
 * word the Russian Zipformer garbled. Same sourcing as the ASR catalog —
 * manifest-first through the shared T23 resolver with the k2-fsa release
 * asset pinned here as the last-resort fallback, sha256-verified whichever
 * source served it.
 *
 * Candidates are the three k2-fsa Whisper multilingual archives. Each ships
 * fp32 + int8 encoder/decoder; the module loads the **int8** pair. The T59
 * session benchmarked all three on the S25 against 20 «Как сказать <word>»
 * clips and pinned the smallest that recovered ≥ 80 % of the words — the
 * table lives in the T59 row of `docs/SUMRAK_TICKETS.md`.
 */

export type AssistCandidateSize = 'tiny' | 'base' | 'small';

export interface AssistModel {
  /** Stable id used in storage paths, analytics, native load, manifest. */
  id: string;
  size: AssistCandidateSize;
  displayName: string;
  description: string;
  archiveUrl: string;
  archiveSha256: string;
  archiveBytes: number;
  /** Top-level directory inside the archive. */
  dirName: string;
  /** Filenames inside dirName the recognizer loads (int8 pair + tokens). */
  files: { encoder: string; decoder: string; tokens: string };
}

const ASR_RELEASE_BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

function whisperCandidate(
  size: AssistCandidateSize,
  sha256: string,
  bytes: number,
  description: string,
): AssistModel {
  const dirName = `sherpa-onnx-whisper-${size}`;
  return {
    id: `whisper-${size}-int8`,
    size,
    displayName: 'Assist model (English in «как сказать…»)',
    description,
    archiveUrl: `${ASR_RELEASE_BASE}/${dirName}.tar.bz2`,
    archiveSha256: sha256,
    archiveBytes: bytes,
    dirName,
    files: {
      encoder: `${size}-encoder.int8.onnx`,
      decoder: `${size}-decoder.int8.onnx`,
      tokens: `${size}-tokens.txt`,
    },
  };
}

/**
 * The benchmark ladder, smallest first. sha256/bytes pinned against the
 * upstream assets on 2026-09-27 (downloaded + hashed on the Mac).
 */
export const ASSIST_CANDIDATES: readonly AssistModel[] = [
  whisperCandidate(
    'tiny',
    'c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1',
    116_204_861,
    'Whisper tiny · hears the English word in «как сказать…»',
  ),
  whisperCandidate(
    'base',
    '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de',
    207_557_382,
    'Whisper base · hears the English word in «как сказать…»',
  ),
  whisperCandidate(
    'small',
    '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6',
    639_387_718,
    'Whisper small · hears the English word in «как сказать…»',
  ),
] as const;

/** The pinned assist model — the T59 benchmark's pick (see the ticket row). */
export const ASSIST_MODEL: AssistModel = ASSIST_CANDIDATES.find((c) => c.size === 'base')!;

/**
 * Whisper decode language at the JS boundary. T60's «как сказать» path
 * only ever asks for English; 'auto' exists for the dev bench.
 */
export const assistLanguageSchema = z.enum(['en', 'ru', 'auto']);
export type AssistLanguage = z.infer<typeof assistLanguageSchema>;

/**
 * `scenario.assistModel` settings row (§4.4): a mirror of the on-disk
 * install state for quick gates — never the truth itself (the filesystem
 * is). A malformed value heals to "not installed".
 */
export const assistModelStateSchema = z.strictObject({
  v: z.literal(1),
  installed: z.boolean(),
  id: z.string().min(1),
});
export type AssistModelState = z.infer<typeof assistModelStateSchema>;

export const DEFAULT_ASSIST_MODEL_STATE: AssistModelState = {
  v: 1,
  installed: false,
  id: ASSIST_MODEL.id,
};

export function parseAssistModelState(raw: unknown): AssistModelState {
  const parsed = assistModelStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ASSIST_MODEL_STATE;
}
