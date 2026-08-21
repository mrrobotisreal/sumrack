// @sumrak/pipeline — authoring pipeline: draft markdown → validated pack.json
// (T08: annotate + validate) → narration audio + word stamps + publish (T09).
// The CLI lives in src/cli.ts (`pnpm pipeline …` from the repo root).
export { alignSentence, type AlignResult } from './align.ts';
export { annotateDrafts, runAnnotate, type AnnotateSummary } from './annotate.ts';
export {
  runAudition,
  runFinalize,
  type AudioSummary,
  type AuditionOptions,
  type AuditionTake,
  type FinalizeOptions,
  type TrackReport,
} from './audio.ts';
export {
  DEFAULT_MODEL_ID,
  ElevenLabsClient,
  ElevenLabsError,
  type ElevenLabsVoice,
  type RenderRequest,
  type RenderResult,
} from './elevenlabs.ts';
export { resolveEnvVar } from './env.ts';
export {
  buildNarration,
  SENTENCE_SEPARATOR,
  type NarrationText,
  type TokenSpan,
} from './narration.ts';
export { encodeOpus, probeDurationMs, OPUS_BITRATE } from './opus.ts';
export { packFileList, runPublish, type PublishOptions, type PublishSummary } from './publish.ts';
export {
  alignCharacters,
  mapAlignmentToStamps,
  type CharAlignment,
  type StampResult,
} from './stamps.ts';
export { assemblePack, isPunctText } from './assemble.ts';
export {
  parseDraft,
  TABLE_COLUMNS,
  type DraftSentence,
  type DraftTokenRow,
  type ParsedDraft,
} from './draft.ts';
export { DraftError, formatIssue, type DraftIssue } from './errors.ts';
export {
  FrontmatterSchema,
  PackMetaSchema,
  StoryMetaSchema,
  VoiceDirectionSchema,
  VoiceSettingsSchema,
  type Frontmatter,
  type PackMeta,
  type StoryMeta,
  type VoiceDirection,
  type VoiceSettings,
} from './frontmatter.ts';
export { runValidate, type ValidateResult } from './validate.ts';
