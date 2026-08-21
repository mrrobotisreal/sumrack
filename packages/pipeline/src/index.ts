// @sumrak/pipeline — authoring pipeline: draft markdown → validated pack.json.
// T08 ships annotate + validate; T09 adds audio rendering + publish.
// The CLI lives in src/cli.ts (`pnpm pipeline …` from the repo root).
export { alignSentence, type AlignResult } from './align.ts';
export { annotateDrafts, runAnnotate, type AnnotateSummary } from './annotate.ts';
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
  type Frontmatter,
  type PackMeta,
  type StoryMeta,
  type VoiceDirection,
} from './frontmatter.ts';
export { runValidate, type ValidateResult } from './validate.ts';
