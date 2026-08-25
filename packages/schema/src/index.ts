// @sumrak/schema — Zod schemas + TS types for content packs, the content-repo
// manifest, and the backup envelope. Single source of truth shared by the app
// importer (T03), content sync (T07), and the authoring pipeline (T08).
export {
  CefrLevelSchema,
  LocalizedTextSchema,
  PackTypeSchema,
  RelativePathSchema,
  StableIdSchema,
  type CefrLevel,
  type LocalizedText,
  type PackType,
} from './common';
export {
  SentenceSchema,
  TokenSchema,
  WordStampSchema,
  reconstructSentenceRu,
  type Sentence,
  type Token,
  type WordStamp,
} from './sentence';
export {
  CharacterSchema,
  ChoiceSchema,
  DialogueNodeSchema,
  DialogueSchema,
  EndingSchema,
  EndingToneSchema,
  MAX_CHOICES_PER_NODE,
  MAX_DIALOGUE_NODES,
  MIN_CHOICES_PER_NODE,
  NodeAudioSchema,
  PLAYER_CHARACTER_ID,
  analyzeDialogueGraph,
  type Character,
  type Choice,
  type Dialogue,
  type DialogueGraphAnalysis,
  type DialogueGraphInput,
  type DialogueNode,
  type Ending,
  type EndingTone,
  type NodeAudio,
} from './dialogue';
export {
  AudioTrackSchema,
  ExerciseSpecSchema,
  JournalPromptSchema,
  LessonSchema,
  PackSchema,
  StorySchema,
  type AudioTrack,
  type ExerciseSpec,
  type JournalPrompt,
  type Lesson,
  type Pack,
  type Story,
} from './pack';
export {
  ManifestEntrySchema,
  ManifestFileSchema,
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
  type ManifestFile,
} from './manifest';
export {
  ModelKindSchema,
  ModelsManifestEntrySchema,
  ModelsManifestSchema,
  type ModelKind,
  type ModelsManifest,
  type ModelsManifestEntry,
} from './models-manifest';
export { BackupEnvelopeSchema, type BackupEnvelope } from './backup';
export {
  SchemaValidationError,
  parseBackupEnvelope,
  parseManifest,
  parseModelsManifest,
  parsePack,
  safeParseBackupEnvelope,
  safeParseManifest,
  safeParseModelsManifest,
  safeParsePack,
  toSchemaIssues,
  type ParseResult,
  type SchemaIssue,
} from './parse';
