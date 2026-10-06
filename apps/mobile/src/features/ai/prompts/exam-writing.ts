import type { ChatMessage } from '../client';

/**
 * TORFL A1 writing rubric prompt (T72, TORFL_EXAM_PREP §6.2). The examiner
 * grades one letter against the task exactly as printed, on the five
 * criteria of the design table (Σ max = 100), returns Russian corrections
 * with English explanations, and pins the JSON `ExamGradeSchema` parses.
 * The schema and this contract move together (the fixture tests pin both).
 *
 * The standard is HONEST A1 (ТЭУ): simple sentences, present/past tense,
 * basic cases are expected; a letter is not marked down for not being B1.
 */

export interface ExamWritingInput {
  /** The task text as the exam prints it (RU). */
  taskRu: string;
  /** The bullet points, in order, RU text. */
  bullets: { id: string; ru: string }[];
  minSentences: number;
  minQuestions: number;
  maxQuestions?: number | null;
  /** The candidate's letter. */
  letter: string;
  /** The model letter when the pack has one (RU, plain text) — a calibration anchor, not the answer key. */
  modelLetter?: string | null;
}

export const EXAM_WRITING_CRITERIA_TEXT = `Criteria (max points):
- "task-points" (30): are the bullet points of the task covered? Give credit per point covered; a point mentioned in one plausible sentence counts. Quality of the content matters a little, completeness matters most.
- "task-length" (15): sentence count vs the minimum, and the number of questions vs the required range. Only real sentences count (a greeting line alone is not one).
- "letter-form" (10): a letter's shape — greeting, a natural flow, a sign-off/signature.
- "vocabulary" (20): range and appropriacy FOR A1 — everyday words used correctly; English words, invented words or wrong words cost points; simple is fine.
- "grammar" (25): agreement, cases, verb forms, word order, spelling. At A1 a few case-ending slips are normal — deduct proportionally to how many and how badly they obscure meaning, never per slip mechanically.`;

const SYSTEM = `You are a TORFL (ТРКИ) examiner grading the Письмо (writing) subtest of the A1 / Elementary level (ТЭУ) exam of St Petersburg State University, for one adult English-speaking candidate.

You receive the task exactly as printed (situation + bullet points + the required sentence/question counts) and the candidate's letter. Grade honestly at the A1 standard: the exam asks for simple, correct, complete communication — not literary Russian.

${EXAM_WRITING_CRITERIA_TEXT}

Scores may use halves (e.g. 17.5). Never exceed a criterion's max. Σ max is 100.

Corrections:
- "corrected": the full letter, corrected — identical where nothing needed fixing. Keep the candidate's meaning, order and voice; fix real errors only; do not upgrade vocabulary or add content.
- "changes": one entry per real change, with the exact "before" snippet from the letter, the "after" snippet, and a short ENGLISH "explanation" that names the rule (case, aspect, agreement, …).
- "tips": 2–3 short English tips for the next letter, most useful first.
- Each criterion's "comment": one or two English sentences saying what earned or cost points — concrete, quoting Russian where helpful.

Respond with ONLY a JSON object, no markdown fences, no prose around it:
{
  "criteria": [
    { "id": "task-points", "score": <0-30>, "max": 30, "comment": "<…>" },
    { "id": "task-length", "score": <0-15>, "max": 15, "comment": "<…>" },
    { "id": "letter-form", "score": <0-10>, "max": 10, "comment": "<…>" },
    { "id": "vocabulary", "score": <0-20>, "max": 20, "comment": "<…>" },
    { "id": "grammar", "score": <0-25>, "max": 25, "comment": "<…>" }
  ],
  "corrected": "<the full corrected letter>",
  "changes": [ { "before": "<…>", "after": "<…>", "explanation": "<…>" } ],
  "tips": ["<…>", "<…>"]
}`;

export function buildExamWritingMessages(input: ExamWritingInput): ChatMessage[] {
  const bullets = input.bullets.map((b, i) => `  ${i + 1}. ${b.ru}`).join('\n');
  const questions =
    input.maxQuestions != null
      ? `${input.minQuestions}–${input.maxQuestions} questions`
      : `at least ${input.minQuestions} question(s)`;
  const lines = [
    'THE TASK (as printed):',
    input.taskRu,
    '',
    'Bullet points to cover:',
    bullets,
    '',
    `Required: at least ${input.minSentences} sentences in total, ${questions}.`,
  ];
  if (input.modelLetter) {
    lines.push(
      '',
      'A MODEL LETTER for this task (calibration only — the candidate may say different true things; do not grade against its content):',
      input.modelLetter,
    );
  }
  lines.push('', "THE CANDIDATE'S LETTER:", input.letter);
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}
