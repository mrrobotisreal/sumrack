import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pack } from '@sumrak/schema';

/**
 * The live-manifest checks of a course pack (T88, decision 5). These are NOT
 * schema: a course pack is valid offline, but its practice refs and its
 * library quotes point at PUBLISHED packs, so they are checked against
 * `sumrak-content/manifest.json` at validate time. A missing manifest is a
 * warning line, never a failure (the offline default).
 *
 * Library quotes resolve against the source pack's own `pack.json` (the
 * manifest lists the file, not the sentences), so the byte-exact `text` check
 * reads that file from the sibling `packs/<id>/` directory.
 */

interface ManifestPack {
  id: string;
}

/** Where `validate` looks for the live manifest when no `--manifest` is given. */
export function defaultManifestPath(cwd: string = process.cwd()): string {
  return resolve(cwd, '..', 'sumrak-content', 'manifest.json');
}

export interface CourseManifestReport {
  /** Lines to print; `⚠` lines are warnings, `✗` lines are broken refs. */
  lines: string[];
  /** Broken refs found (exit code stays 0 — the report is advisory, like the exam report). */
  broken: number;
}

/**
 * Check a course pack's practice and library refs against the live manifest.
 * `packJsonOf(id)` returns the parsed `pack.json` of a published pack, or
 * `undefined` when the file is missing; it is injected so tests stay hermetic.
 */
export function courseManifestIssues(
  pack: Pack,
  manifestPath: string | undefined,
  packJsonOf: (id: string) => Pack | undefined,
): CourseManifestReport {
  const course = pack.course;
  if (course === undefined) return { lines: [], broken: 0 };
  if (manifestPath === undefined || !existsSync(manifestPath)) {
    return {
      lines: [
        `  ⚠ live manifest not found — practice and library refs not checked (pass --manifest <path>)`,
      ],
      broken: 0,
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { packs: ManifestPack[] };
  const published = new Set(manifest.packs.map((p) => p.id));
  const lines: string[] = [];
  let broken = 0;
  const bad = (msg: string) => {
    broken += 1;
    lines.push(`  ✗ ${msg}`);
  };

  for (const ref of course.practice) {
    if (!published.has(ref.packId)) {
      bad(`practice ${ref.packId}/${ref.examId} — pack is not in the manifest`);
      continue;
    }
    const src = packJsonOf(ref.packId);
    if (src === undefined) {
      bad(`practice ${ref.packId}/${ref.examId} — pack.json is not readable`);
      continue;
    }
    if (!(src.exams ?? []).some((e) => e.id === ref.examId)) {
      bad(`practice ${ref.packId}/${ref.examId} — no exam "${ref.examId}" in that pack`);
    }
  }

  for (const unit of course.units) {
    for (const card of unit.cards) {
      if (card.kind !== 'library') continue;
      for (const quote of card.quotes) {
        const where = `library ${unit.id}/${card.id} ${quote.packId}/${quote.storyId}/${quote.sentenceId}`;
        if (!published.has(quote.packId)) {
          bad(`${where} — pack is not in the manifest`);
          continue;
        }
        const src = packJsonOf(quote.packId);
        if (src === undefined) {
          bad(`${where} — pack.json is not readable`);
          continue;
        }
        const story = src.stories.find((s) => s.id === quote.storyId);
        const sentence = story?.sentences.find((s) => s.id === quote.sentenceId);
        if (sentence === undefined) {
          bad(`${where} — sentence not found in that pack`);
        } else if (sentence.ru !== quote.text) {
          bad(`${where} — text is not byte-identical to the published sentence`);
        }
      }
    }
  }

  if (broken === 0) lines.push('  ✓ practice and library refs resolve against the live manifest');
  return { lines, broken };
}
