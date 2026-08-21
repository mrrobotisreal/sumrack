import { readFileSync } from 'node:fs';
import { safeParsePack, type Pack, type SchemaIssue } from '@sumrak/schema';

/**
 * `pipeline validate`: check an existing pack.json against the shared schema,
 * independently of annotate (CI / spot-checks).
 */

export type ValidateResult =
  { ok: true; file: string; pack: Pack } | { ok: false; file: string; issues: SchemaIssue[] };

export function runValidate(file: string): ValidateResult {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      file,
      issues: [
        { path: '(root)', message: `not readable as JSON: ${e instanceof Error ? e.message : e}` },
      ],
    };
  }
  const result = safeParsePack(data);
  if (!result.success) return { ok: false, file, issues: result.issues };
  return { ok: true, file, pack: result.data };
}
