import type { Slot } from '@sumrak/schema';

import type {
  AttemptDetail,
  ScenarioAttemptRow,
  ScenarioDetail,
  ScenarioRunDebrief,
  ScenarioRunStats,
  ScenarioTurnRuntime,
} from '@/db/repositories/scenarios';

import { SCENARIO_NEAR_MISS_SCORE } from '../judge/judge';

/**
 * Pure helpers behind the debrief (T63 §10.2), tested in Node: the
 * per-attempt badges, «Practice these» (missed required slot lemmas), the
 * level-bar strip from a duration, and the plain-text transcript export.
 */

export type AttemptBadge = 'rescued' | 'assisted' | 'skipped' | 'near miss' | 'matched' | 'miss';

export type DebriefAttempt = ScenarioAttemptRow & { detail: AttemptDetail | null };

export function attemptBadges(
  attempt: DebriefAttempt,
  step: ScenarioRunDebrief['turns'][number]['step'],
): AttemptBadge[] {
  const out: AttemptBadge[] = [];
  if (attempt.kind !== 'answer') return out;
  switch (attempt.outcome) {
    case 'rescued':
      out.push('rescued');
      break;
    case 'skipped':
      out.push('skipped');
      break;
    case 'matched':
      out.push('matched');
      break;
    case 'miss': {
      // The judge's own rule (§5.2): near miss = paraphrase score ≥ 40 or any required slot hit.
      const d = attempt.detail?.kind === 'answer' ? attempt.detail : null;
      const anyHit = d ? Object.values(d.slots).some((v) => v !== null) : false;
      out.push(d && (d.score >= SCENARIO_NEAR_MISS_SCORE || anyHit) ? 'near miss' : 'miss');
      break;
    }
    default:
      break;
  }
  if (step.assisted && attempt.outcome === 'matched') out.push('assisted');
  return out;
}

export interface PracticeItem {
  lemma: string;
  /** First accepted surface form (the bank's `surface`). */
  surface: string;
  /** EN gloss when the glossary knows the lemma, else ''. */
  translation: string;
  turnId: string;
}

/**
 * Missed required slot lemmas across the run: for every answer attempt that
 * was NOT matched/rescued, each required `forms` slot left null contributes
 * its options' lemmas (the authored dictionary forms — «Practice these»
 * banks the word, not what was misheard). Deduped by lemma; free/number
 * slots have no lemma to practise.
 */
export function practiceItems(
  debrief: ScenarioRunDebrief,
  turns: readonly ScenarioTurnRuntime[],
  glossary: ScenarioDetail['glossary'] = [],
): PracticeItem[] {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const gloss = new Map(glossary.map((g) => [g.ru.toLowerCase(), g.en]));
  const seen = new Set<string>();
  const out: PracticeItem[] = [];
  for (const turn of debrief.turns) {
    const runtime = byId.get(turn.turnId);
    if (!runtime?.expect) continue;
    const matchedLater = turn.attempts.some(
      (a) => a.kind === 'answer' && (a.outcome === 'matched' || a.outcome === 'rescued'),
    );
    for (const attempt of turn.attempts) {
      if (attempt.kind !== 'answer' || attempt.detail?.kind !== 'answer') continue;
      if (attempt.outcome === 'matched' || attempt.outcome === 'rescued') continue;
      // A skipped turn with zero attempts still counts every required slot.
      for (const slot of runtime.expect.slots) {
        if (!slot.required || slot.kind !== 'forms') continue;
        const hit = attempt.detail.slots[slot.id] ?? null;
        if (hit !== null && matchedLater) continue;
        if (hit !== null) continue;
        for (const opt of slot.options) {
          if (seen.has(opt.lemma)) continue;
          seen.add(opt.lemma);
          out.push({
            lemma: opt.lemma,
            surface: opt.forms[0]!.replace(/\*$/, ''),
            translation: gloss.get(opt.lemma.toLowerCase()) ?? '',
            turnId: turn.turnId,
          });
        }
      }
    }
    if (turn.attempts.length === 0 && turn.step.skipped) {
      for (const slot of runtime.expect.slots) {
        if (!slot.required || slot.kind !== 'forms') continue;
        for (const opt of slot.options) {
          if (seen.has(opt.lemma)) continue;
          seen.add(opt.lemma);
          out.push({
            lemma: opt.lemma,
            surface: opt.forms[0]!.replace(/\*$/, ''),
            translation: gloss.get(opt.lemma.toLowerCase()) ?? '',
            turnId: turn.turnId,
          });
        }
      }
    }
  }
  return out;
}

/** Required slots of an expectation (the strip's «N slots» hint). */
export function requiredSlotIds(slots: readonly Slot[]): string[] {
  return slots.filter((s) => s.required).map((s) => s.id);
}

/**
 * A deterministic bar strip for an attempt: `bars` pseudo-levels seeded
 * from the duration + attempt id so the same recording always draws the
 * same shape (no waveform decode — the recording is Opus; §10.2 asks for a
 * strip "drawn from the duration"). Values 0.15–1.
 */
export function levelStrip(durationMs: number | null, seed: string, bars = 24): number[] {
  const dur = Math.max(0, durationMs ?? 0);
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const out: number[] = [];
  const active = dur === 0 ? 0 : Math.max(2, Math.min(bars, Math.round((dur / 6000) * bars)));
  for (let i = 0; i < bars; i++) {
    if (i >= active) {
      out.push(0.15);
      continue;
    }
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    const env = Math.sin((Math.PI * (i + 0.5)) / active); // speech swells then fades
    out.push(Math.max(0.2, Math.min(1, 0.35 + env * 0.5 + ((h >>> 16) % 100) / 400)));
  }
  return out;
}

export interface TranscriptInput {
  familyTitle: string;
  level: string;
  endingTitle: string | null;
  finishedAt: number | null;
  stats: ScenarioRunStats | null;
  turns: {
    hostLine: string | null;
    attempts: DebriefAttempt[];
    modelAnswer: string | null;
  }[];
}

/** The «Share transcript» text — plain, no audio, no ids; what was said and what was expected. */
export function transcriptText(input: TranscriptInput): string {
  const lines: string[] = [];
  lines.push(`Сумрак · Сценарий — ${input.familyTitle} (${input.level})`);
  if (input.finishedAt) lines.push(new Date(input.finishedAt).toLocaleString());
  if (input.endingTitle) lines.push(`Концовка: ${input.endingTitle}`);
  if (input.stats) {
    const s = input.stats;
    lines.push(
      `Ходов ${s.turns} · чистых ${s.cleanTurns} · промахов ${s.misses} · подсказок ${s.lifelines} · пропусков ${s.skips}` +
        (s.avgScore !== null ? ` · средний балл ${Math.round(s.avgScore)}` : ''),
    );
  }
  lines.push('');
  input.turns.forEach((turn, i) => {
    lines.push(`${i + 1}. Ведущий: ${turn.hostLine ?? '…'}`);
    for (const a of turn.attempts) {
      if (a.kind === 'meta') {
        const q = a.detail?.kind === 'meta' ? a.detail.query : a.transcript;
        lines.push(`   ❔ ${metaLabel(a.outcome)}${q ? ` «${q}»` : ''}`);
        continue;
      }
      const score = a.detail?.kind === 'answer' ? ` (${Math.round(a.detail.score)})` : '';
      const mark =
        a.outcome === 'matched' || a.outcome === 'rescued'
          ? '✓'
          : a.outcome === 'skipped'
            ? '→'
            : '✗';
      lines.push(`   ${mark} Я: ${a.transcript || '—'}${score}`);
    }
    if (turn.modelAnswer) lines.push(`   ≈ ${turn.modelAnswer}`);
  });
  return lines.join('\n');
}

export function metaLabel(outcome: string): string {
  switch (outcome) {
    case 'explain':
      return 'что значит';
    case 'howtosay':
      return 'как сказать';
    case 'repeat':
      return 'повтори';
    case 'slower':
      return 'помедленнее';
    case 'dont-understand':
      return 'не понимаю';
    default:
      return 'вопрос';
  }
}

/** The debrief's «12 KB» / «1.3 MB» size label. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** mm:ss for a duration. */
export function formatDuration(ms: number | null): string {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
