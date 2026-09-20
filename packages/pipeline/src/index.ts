// @sumrak/pipeline — authoring pipeline: draft markdown → validated pack.json
// (T08: annotate + validate) → narration audio + word stamps + publish (T09).
// The CLI lives in src/cli.ts (`pnpm pipeline …` from the repo root).
export { alignSentence, type AlignResult } from './align.ts';
export { annotateDrafts, runAnnotate, type AnnotateSummary } from './annotate.ts';
export {
  planAudioRun,
  runAudition,
  runFinalize,
  type AudioRunPlan,
  type AudioSummary,
  type AuditionOptions,
  type AuditionResult,
  type AuditionTake,
  type FinalizeOptions,
  type TrackReport,
} from './audio.ts';
export {
  planDialogueItems,
  runDialogueAudition,
  runDialogueFinalize,
  type DialogueAuditionTake,
  type DialoguePlanOptions,
  type DialogueRenderItem,
  type DialogueTrackReport,
} from './dialogue-audio.ts';
export {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_MODEL_ID,
  ElevenLabsClient,
  ElevenLabsError,
  OUTPUT_FORMAT,
  isV3Model,
  type ElevenLabsVoice,
  type RenderRequest,
  type RenderResult,
} from './elevenlabs.ts';
export {
  CATEGORY_DEFAULT_REGISTER,
  DEFAULT_VOICE,
  REGISTERS,
  REGISTER_SLUGS,
  applyRegister,
  resolveRegisterSlug,
  type Register,
  type RegisterSettings,
  type RegisterSlug,
  type ResolvedVoiceDirection,
} from './registers.ts';
export { resolveEnvVar } from './env.ts';
export {
  buildNarration,
  SENTENCE_SEPARATOR,
  type NarrationText,
  type TokenSpan,
} from './narration.ts';
export {
  MIRROR_MODELS,
  MODELS_MANIFEST_FILE,
  mirrorFilePath,
  runModelsMirror,
  type MirrorModel,
  type MirrorModelReport,
  type MirrorOptions,
  type MirrorSummary,
} from './models.ts';
export { encodeOpus, probeDurationMs, OPUS_BITRATE } from './opus.ts';
export { packFileList, runPublish, type PublishOptions, type PublishSummary } from './publish.ts';
export {
  alignCharacters,
  mapAlignmentToStamps,
  type CharAlignment,
  type StampResult,
} from './stamps.ts';
export { assemblePack, isPunctText } from './assemble.ts';
export { renderBranchMap } from './branch-map.ts';
export {
  DialogueFrontmatterSchema,
  DialogueMetaSchema,
  parseDialogueDraft,
  sniffDraftKind,
  type DialogueFrontmatter,
  type DialogueMeta,
  type DraftChoiceAlt,
  type DraftDialogueChoice,
  type DraftDialogueNode,
  type DraftNodeTerminator,
  type ParsedDialogueDraft,
} from './dialogue-draft.ts';
export {
  parseDraft,
  TABLE_COLUMNS,
  type DraftSentence,
  type DraftTokenRow,
  type ParsedDraft,
} from './draft.ts';
export { DraftError, formatIssue, type DraftIssue } from './errors.ts';
export { ExtrasFrontmatterSchema, loadExtras, parseExtras, type PackExtras } from './extras.ts';
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
