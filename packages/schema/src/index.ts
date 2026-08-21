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
  AudioTrackSchema,
  ExerciseSpecSchema,
  JournalPromptSchema,
  LessonSchema,
  PackSchema,
  SentenceSchema,
  StorySchema,
  TokenSchema,
  WordStampSchema,
  reconstructSentenceRu,
  type AudioTrack,
  type ExerciseSpec,
  type JournalPrompt,
  type Lesson,
  type Pack,
  type Sentence,
  type Story,
  type Token,
  type WordStamp,
} from './pack';
export {
  ManifestEntrySchema,
  ManifestFileSchema,
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
  type ManifestFile,
} from './manifest';
export { BackupEnvelopeSchema, type BackupEnvelope } from './backup';
export {
  SchemaValidationError,
  parseBackupEnvelope,
  parseManifest,
  parsePack,
  safeParseBackupEnvelope,
  safeParseManifest,
  safeParsePack,
  toSchemaIssues,
  type ParseResult,
  type SchemaIssue,
} from './parse';
