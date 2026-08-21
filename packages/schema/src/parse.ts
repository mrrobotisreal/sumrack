import { z } from 'zod';
import { BackupEnvelopeSchema, type BackupEnvelope } from './backup';
import { ManifestSchema, type Manifest } from './manifest';
import { PackSchema, type Pack } from './pack';

/** One validation problem, with a dotted/indexed path to the exact bad field. */
export interface SchemaIssue {
  /** e.g. "stories[0].sentences[2].tokens[5].lemma" ("(root)" for top-level). */
  path: string;
  /** Human-readable description of what is wrong at that path. */
  message: string;
}

export type ParseResult<T> =
  { success: true; data: T } | { success: false; issues: SchemaIssue[]; message: string };

/** Thrown by the `parse*` (throwing) helpers; carries the structured issues. */
export class SchemaValidationError extends Error {
  readonly issues: SchemaIssue[];
  constructor(message: string, issues: SchemaIssue[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === 'number') return `${acc}[${seg}]`;
    return acc === '' ? String(seg) : `${acc}.${String(seg)}`;
  }, '');
}

/** Flatten a ZodError into precise, human-readable per-field issues. */
export function toSchemaIssues(error: z.ZodError): SchemaIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message }));
}

function summarize(label: string, issues: SchemaIssue[]): string {
  const lines = issues.map((i) => `  - ${i.path}: ${i.message}`);
  return `${label} validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
}

function makeParsers<T>(schema: z.ZodType<T>, label: string) {
  const safe = (data: unknown): ParseResult<T> => {
    const result = schema.safeParse(data);
    if (result.success) return { success: true, data: result.data };
    const issues = toSchemaIssues(result.error);
    return { success: false, issues, message: summarize(label, issues) };
  };
  const orThrow = (data: unknown): T => {
    const result = safe(data);
    if (result.success) return result.data;
    throw new SchemaValidationError(result.message, result.issues);
  };
  return { safe, orThrow };
}

const packParsers = makeParsers<Pack>(PackSchema, 'Pack');
const manifestParsers = makeParsers<Manifest>(ManifestSchema, 'Manifest');
const backupParsers = makeParsers<BackupEnvelope>(BackupEnvelopeSchema, 'BackupEnvelope');

/** Validate an unknown value as a Pack; never throws. */
export const safeParsePack = packParsers.safe;
/** Validate an unknown value as a Pack; throws SchemaValidationError with precise paths. */
export const parsePack = packParsers.orThrow;
/** Validate an unknown value as the content-repo manifest; never throws. */
export const safeParseManifest = manifestParsers.safe;
/** Validate an unknown value as the content-repo manifest; throws on failure. */
export const parseManifest = manifestParsers.orThrow;
/** Validate an unknown value as a backup envelope; never throws. */
export const safeParseBackupEnvelope = backupParsers.safe;
/** Validate an unknown value as a backup envelope; throws on failure. */
export const parseBackupEnvelope = backupParsers.orThrow;
