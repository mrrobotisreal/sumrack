import type { ChatMessage } from '../client';

/**
 * CEFR-assessment prompt (T18, design §7.6): bundle recent journal writing
 * + aggregate study stats → per-skill CEFR estimate + focus
 * recommendations. The response contract matches AssessmentResponseSchema
 * exactly (fixture tests pin both — T16 pattern).
 *
 * The bundle is assembled by features/dashboard/assessment.ts; this module
 * only renders it into messages, so the template stays unit-testable
 * without a DB.
 */

export interface AssessmentJournalSample {
  /** Entry text, already truncated by the caller. */
  ru: string;
  /** AI-corrected version when feedback exists (shows error density). */
  corrected?: string;
  createdAt: number;
}

export interface AssessmentBundle {
  /** Aggregate numbers, pre-formatted label → value (rendered as-is). */
  stats: Record<string, string | number>;
  journal: AssessmentJournalSample[];
}

const SYSTEM = `You are an experienced CEFR examiner for Russian as a foreign language, assessing an English-speaking adult learner (target: C1). You receive his aggregate study statistics and recent Russian journal writing from his study app.

Estimate his current CEFR level for each skill:
- "reading": from vocabulary mastery counts, levels of material read, and reading volume.
- "listening": from listening-review performance and narrated-story listening time. Evidence is thin — be conservative.
- "writing": from the journal entries — the strongest direct evidence you have. Judge range, accuracy, and complexity; the corrected versions show his error density.
- "speaking": a PROXY only, derived from pronunciation-practice scores against speech recognition. There is no conversational evidence; say so in the note and be conservative.

Rules:
- Estimate honestly — never inflate to encourage. A1 is a respectable answer for a beginner.
- Each note: one or two English sentences naming the concrete evidence for the estimate.
- Recommendations: 2–4 items, most important first, each a specific, actionable study focus (name grammar topics, skills, or habits — not generic "keep practicing").
- If the evidence for a skill is very thin, estimate from what exists and say the evidence is thin in the note.

Respond with ONLY a JSON object, no markdown fences, no prose around it:
{
  "skills": {
    "reading":   { "level": "A1|A2|B1|B2|C1", "note": "<evidence>" },
    "listening": { "level": "A1|A2|B1|B2|C1", "note": "<evidence>" },
    "writing":   { "level": "A1|A2|B1|B2|C1", "note": "<evidence>" },
    "speaking":  { "level": "A1|A2|B1|B2|C1", "note": "<evidence, stated as a pronunciation proxy>" }
  },
  "recommendations": ["<focus 1>", "<focus 2>"],
  "summary": "<3-5 sentences in English: overall picture, trajectory, and the single most important next step>"
}`;

export function buildAssessmentMessages(bundle: AssessmentBundle): ChatMessage[] {
  const statLines = Object.entries(bundle.stats)
    .map(([label, value]) => `- ${label}: ${value}`)
    .join('\n');

  const journalBlock =
    bundle.journal.length === 0
      ? '(no journal entries yet)'
      : bundle.journal
          .map((entry, i) => {
            const date = new Date(entry.createdAt).toISOString().slice(0, 10);
            const corrected = entry.corrected ? `\nAI-corrected version:\n${entry.corrected}` : '';
            return `Entry ${i + 1} (${date}):\n${entry.ru}${corrected}`;
          })
          .join('\n\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `My study statistics:\n${statLines}\n\nMy recent journal entries:\n\n${journalBlock}`,
    },
  ];
}
