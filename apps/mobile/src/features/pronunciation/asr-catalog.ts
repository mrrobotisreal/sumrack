import { z } from 'zod';

/**
 * The Russian ASR model (T12, design §6: offline model ~40–60 MB). Same
 * sourcing decision as the T11 voice catalog: downloaded from the official
 * k2-fsa release assets with a sha256 pinned here and verified before
 * anything is used, rather than PAT-gating a public binary in the private
 * content repo.
 *
 * Model choice: `sherpa-onnx-zipformer-ru-int8-2025-04-20` — offline
 * Zipformer transducer, int8-quantized, 60.2 MB archive (the only Russian
 * option inside the design's size window; the GigaAM family is better but
 * 163+ MB). Verified on-host 2026-08-22: accurate Russian transcription with
 * per-token timestamps under greedy_search.
 */

export interface AsrModel {
  /** Stable id used in storage paths, analytics, native load. */
  id: string;
  displayName: string;
  description: string;
  archiveUrl: string;
  archiveSha256: string;
  archiveBytes: number;
  /** Top-level directory inside the archive. */
  dirName: string;
  /** Filenames inside dirName that the recognizer needs. */
  files: { encoder: string; decoder: string; joiner: string; tokens: string };
}

/** sha256/bytes pinned against the upstream asset on 2026-08-22. */
export const ASR_MODEL: AsrModel = {
  id: 'zipformer-ru-int8',
  displayName: 'Russian speech recognition',
  description: 'Zipformer · scores your pronunciation offline',
  archiveUrl:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-ru-int8-2025-04-20.tar.bz2',
  archiveSha256: 'd6a651569aacc9a177259fa54705dd76acae23f6a4d62ea6797bd220d4b57163',
  archiveBytes: 60_239_942,
  dirName: 'sherpa-onnx-zipformer-ru-int8-2025-04-20',
  files: {
    encoder: 'encoder.int8.onnx',
    decoder: 'decoder.onnx',
    joiner: 'joiner.int8.onnx',
    tokens: 'tokens.txt',
  },
};

/**
 * Transcript shape at the JS/native boundary (standard DoD: Zod at every
 * I/O boundary). The native module *claims* this shape; parse before use.
 */
export const transcriptWordSchema = z.strictObject({
  word: z.string(),
  startMs: z.number(),
  endMs: z.number(),
});

export const transcriptResultSchema = z.strictObject({
  text: z.string(),
  words: z.array(transcriptWordSchema),
  decodeMs: z.number(),
  audioMs: z.number(),
});

export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type TranscriptResult = z.infer<typeof transcriptResultSchema>;
