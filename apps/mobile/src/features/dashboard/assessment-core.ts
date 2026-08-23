import type { Repositories } from '@/db/repositories';

import type { AssessmentBundle, AssessmentJournalSample } from '../ai/prompts/assessment';
import { parseStoredAssessment, type StoredAssessment } from '../ai/schemas';

/**
 * Pure assessment logic (T18) — bundle assembly, cadence gate, stored-row
 * parsing. Node-safe (no RN imports) so it's unit-testable; the wired
 * request flow lives in ./assessment.ts (T16's core/wired split).
 *
 * Cadence (T18 decision): manual "Reassess" button, plus an automatic run
 * when the dashboard opens online and the last assessment is older than
 * 7 days — but only when there's meaningful evidence (≥ 1 journal entry or
 * ≥ 20 lifetime reviews), so a fresh install never burns a request on an
 * empty bundle.
 */

export const AUTO_ASSESS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Most recent journal entries sent, each truncated — enough for register
 *  + accuracy judgment without shipping the whole diary every week. */
const JOURNAL_SAMPLE_COUNT = 6;
const JOURNAL_SAMPLE_MAX_CHARS = 1500;

const REVIEWS_STAT_KEY = 'Total reviews completed';

export async function buildAssessmentBundle(repos: Repositories): Promise<AssessmentBundle> {
  const [vocab, coverage, activity, pron, checkpoints, entries] = await Promise.all([
    repos.dashboard.getVocabByLevel(),
    repos.dashboard.getGrammarCoverage(),
    repos.dashboard.getActivityTotals(),
    repos.dashboard.getPronunciationTrend(),
    repos.stats.listCheckpointResults(),
    repos.journal.listEntries(JOURNAL_SAMPLE_COUNT),
  ]);

  const stats: Record<string, string | number> = {};
  for (const row of vocab) {
    if (row.level === 'unleveled') continue;
    stats[`${row.level} lemmas encountered / collected / reviewed-shaky / young / mature`] =
      `${row.encountered} / ${row.collected} / ${row.learning} / ${row.young} / ${row.mature}`;
  }
  const seenTopics = coverage.filter((t) => t.readSentenceCount > 0).length;
  const practicedTopics = coverage.filter((t) => t.lemmasReviewed > 0).length;
  stats['Grammar topics in installed content'] = coverage.length;
  stats['Grammar topics seen in reading / with reviewed vocabulary'] =
    `${seenTopics} / ${practicedTopics}`;
  stats[REVIEWS_STAT_KEY] = activity.reviewsDone;
  stats['Total reading time (minutes)'] = Math.round(activity.readingMs / 60_000);
  stats['Stories finished'] = activity.storiesFinished;
  stats['Current activity streak (days)'] = activity.activityStreak;
  stats['Pronunciation attempts / average score (0-100, speech-recognition match)'] =
    pron.overallAvg == null
      ? '0 / no data'
      : `${pron.days.reduce((s, d) => s + d.attempts, 0)} / ${pron.overallAvg}`;
  for (const cp of checkpoints.slice(0, 3)) {
    stats[`Checkpoint ${cp.checkpointPackId}`] =
      `${Math.round(cp.scorePercent)}% (${cp.passed ? 'passed' : 'failed'})`;
  }

  const journal: AssessmentJournalSample[] = entries.map((e) => {
    const feedback = e.aiFeedback ? safeCorrected(e.aiFeedback) : undefined;
    return {
      ru: e.ru.slice(0, JOURNAL_SAMPLE_MAX_CHARS),
      corrected: feedback?.slice(0, JOURNAL_SAMPLE_MAX_CHARS),
      createdAt: e.createdAt,
    };
  });

  return { stats, journal };
}

function safeCorrected(aiFeedback: string): string | undefined {
  try {
    const parsed = JSON.parse(aiFeedback) as { corrected?: unknown };
    return typeof parsed.corrected === 'string' ? parsed.corrected : undefined;
  } catch {
    return undefined;
  }
}

/** True when the bundle carries enough evidence to be worth a request. */
export function bundleHasEvidence(bundle: AssessmentBundle): boolean {
  const reviews = Number(bundle.stats[REVIEWS_STAT_KEY] ?? 0);
  return bundle.journal.length > 0 || reviews >= 20;
}

/** All stored assessments, oldest first, unreadable payloads skipped. */
export async function listStoredAssessments(repos: Repositories): Promise<StoredAssessment[]> {
  const rows = await repos.stats.listAssessments();
  return rows
    .map((r) => parseStoredAssessment(r.payload))
    .filter((a): a is StoredAssessment => a !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Auto-cadence gate — see module doc. */
export function shouldAutoAssess(
  assessments: StoredAssessment[],
  now: number = Date.now(),
): boolean {
  const last = assessments[assessments.length - 1];
  if (!last) return true;
  return now - last.createdAt >= AUTO_ASSESS_INTERVAL_MS;
}
