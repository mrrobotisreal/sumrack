import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { z } from 'zod';
import {
  ExerciseSpecSchema,
  JournalPromptSchema,
  LessonSchema,
  type ExerciseSpec,
  type JournalPrompt,
  type Lesson,
} from '@sumrak/schema';
import { normalizeDeep } from './draft.ts';
import { DraftError, type DraftIssue } from './errors.ts';
import { PackMetaSchema, type PackMeta } from './frontmatter.ts';

/**
 * Pack extras (T17): the non-story sections a `course-unit`, `checkpoint`, or
 * `prompts` pack carries — grammar mini-lesson, journal prompts, authored
 * exercises. Authored as ONE markdown file per pack:
 *
 * ```
 * ---
 * pack:            # optional next to drafts (must match them); REQUIRED when
 *   id: …          # the pack has no story drafts (checkpoint / prompts packs)
 * lesson:          # lesson meta — its `body` is the markdown BELOW the fence
 *   id: unit-1-lesson
 *   title: { ru: 'Урок', en: 'Lesson' }
 *   grammarTopics: [prepositional-location]
 * prompts:
 *   - { id: p1, level: A1, prompt: { ru: '…', en: '…' } }
 * exercises:
 *   - { id: e1, kind: multiple-choice, direction: ru-en, prompt: '…',
 *       choices: ['a', 'b'], correctIndex: 0 }
 * ---
 * ## Заголовок урока
 * The lesson markdown body (rendered by the app's lesson screen)…
 * ```
 *
 * `annotate`/`audio` take it via `--extras <file>` and merge it into the
 * assembled pack; the shared Zod schema stays the single validation gate.
 */

/** Lesson meta as authored in extras frontmatter — the body lives below the fence. */
const LessonMetaSchema = LessonSchema.omit({ body: true });

export const ExtrasFrontmatterSchema = z.strictObject({
  pack: PackMetaSchema.optional(),
  lesson: LessonMetaSchema.optional(),
  prompts: z.array(JournalPromptSchema).min(1).optional(),
  exercises: z.array(ExerciseSpecSchema).min(1).optional(),
});

export interface PackExtras {
  /** Extras file path as given (used in error messages). */
  file: string;
  pack?: PackMeta;
  lesson?: Lesson;
  prompts?: JournalPrompt[];
  exercises?: ExerciseSpec[];
}

/**
 * Parse one extras file. Frontmatter carries the structured sections; the
 * markdown body below the closing fence is the lesson body (required exactly
 * when `lesson:` meta is present). Throws {@link DraftError} on any problem.
 */
export function parseExtras(file: string, source: string): PackExtras {
  const issues: DraftIssue[] = [];
  const lines = source.split(/\r?\n/);

  if (lines[0]?.trim() !== '---') {
    throw new DraftError([
      { file, line: 1, message: 'extras file must start with a "---" YAML frontmatter fence' },
    ]);
  }
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (fmEnd === -1) {
    throw new DraftError([
      { file, line: 1, message: 'frontmatter is never closed (no second "---" fence)' },
    ]);
  }

  let parsedFm: z.infer<typeof ExtrasFrontmatterSchema> | undefined;
  try {
    const raw = normalizeDeep(YAML.parse(lines.slice(1, fmEnd).join('\n')));
    const result = ExtrasFrontmatterSchema.safeParse(raw ?? {});
    if (result.success) {
      parsedFm = result.data;
    } else {
      for (const issue of result.error.issues) {
        const path =
          issue.path.length === 0 ? 'frontmatter' : `frontmatter ${issue.path.join('.')}`;
        issues.push({ file, line: 2, message: `${path}: ${issue.message}` });
      }
    }
  } catch (e) {
    issues.push({
      file,
      line: 2,
      message: `frontmatter is not valid YAML: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  // Body = lesson markdown (NFC-normalized; ё preserved — NFC never folds it).
  const body = lines
    .slice(fmEnd + 1)
    .join('\n')
    .trim()
    .normalize('NFC');

  if (parsedFm) {
    if (parsedFm.lesson && body === '') {
      issues.push({
        file,
        line: fmEnd + 1,
        message: 'extras declare a lesson but have no markdown body below the frontmatter fence',
      });
    }
    if (!parsedFm.lesson && body !== '') {
      issues.push({
        file,
        line: fmEnd + 2,
        message:
          'extras have a markdown body but no "lesson:" section — the body is the lesson body, so declare its meta (or delete the body)',
      });
    }
    if (!parsedFm.pack && !parsedFm.lesson && !parsedFm.prompts && !parsedFm.exercises) {
      issues.push({ file, line: 2, message: 'extras file declares nothing' });
    }
  }

  if (issues.length > 0 || !parsedFm) throw new DraftError(issues);

  const extras: PackExtras = { file };
  if (parsedFm.pack) extras.pack = parsedFm.pack;
  if (parsedFm.lesson) extras.lesson = { ...parsedFm.lesson, body };
  if (parsedFm.prompts) extras.prompts = parsedFm.prompts;
  if (parsedFm.exercises) extras.exercises = parsedFm.exercises;
  return extras;
}

export function loadExtras(path: string): PackExtras {
  return parseExtras(path, readFileSync(path, 'utf8'));
}
