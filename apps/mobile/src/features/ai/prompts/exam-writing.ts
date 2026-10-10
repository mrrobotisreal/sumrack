import type { ChatMessage } from '../client';

import type { TorflLevel } from '@/features/torfl/level-profile';

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
  /** T76: the exam's TORFL level; absent = A1 (the prompt is then byte-identical to T72's). */
  level?: TorflLevel;
  /** T76: the writing item's topic slug — `write-note` selects the messenger-message rubric at A2. */
  taskTopic?: string | null;
}

export const EXAM_WRITING_CRITERIA_TEXT = `Criteria (max points):
- "task-points" (30): are the bullet points of the task covered? Give credit per point covered; a point mentioned in one plausible sentence counts. Quality of the content matters a little, completeness matters most.
- "task-length" (15): sentence count vs the minimum, and the number of questions vs the required range. Only real sentences count (a greeting line alone is not one).
- "letter-form" (10): a letter's shape — greeting, a natural flow, a sign-off/signature.
- "vocabulary" (20): range and appropriacy FOR A1 — everyday words used correctly; English words, invented words or wrong words cost points; simple is fine.
- "grammar" (25): agreement, cases, verb forms, word order, spelling. At A1 a few case-ending slips are normal — deduct proportionally to how many and how badly they obscure meaning, never per slip mechanically.`;

const SYSTEM_A1 = `You are a TORFL (ТРКИ) examiner grading the Письмо (writing) subtest of the A1 / Elementary level (ТЭУ) exam of St Petersburg State University, for one adult English-speaking candidate.

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

/**
 * The A2 (ТБУ) standard paragraph (T76, TORFL_A2_EXAM_PREP §6.2): the 2010 sample's expert control-sheet
 * criteria mapped onto the SAME five criterion ids (the JSON contract does not change). Letter and
 * messenger note differ only in the completeness rule.
 */
export const EXAM_WRITING_A2_STANDARD = `Grade honestly at the A2 standard (ТБУ, базовый уровень): the exam asks for a connected, mostly correct text that does what the task asks, in simple but varied sentences — past, present and future, the main cases with and without prepositions, the usual connectors (потому что, поэтому, когда, чтобы, который), and basic aspect. A letter is not marked down for not being B1; it is marked down when it is not A2 (A1-only sentences, one tense, no connectors).

Map the examiners' control sheet onto the criteria like this:
- the text must fit the task's purpose (right addressee, right register, ты/вы consistent). A text that does not do the task at all earns almost nothing under "task-points".
- completeness ("task-points"): every informative fragment the task demands should be there — about 5 points of the 30 per missing fragment of a 6–7-point letter, proportionally.
- accuracy of information and logic/coherence ("task-points" and "vocabulary"): a distortion of the task's facts costs about 5 per distortion; a break in logic or coherence about 2 each.
- significant language errors (those that change or obscure the meaning) cost about 2 each, insignificant errors (a slip in an ending that does not impede understanding) about 0.5 each — spread across "vocabulary" and "grammar" by the kind of error.
- a bonus of about 3 each for a full, rich text and for independent, confident use of the language — within the criteria's maxima, never above them.
- if the text carries more than ~15 points of errors it cannot earn a pass on language: keep "vocabulary" and "grammar" low.`;

const A2_NOTE_COMPLETENESS = `This text is a short MESSENGER MESSAGE (A2 task 2), not a letter. Its content units are the information the task demands — typically the reason, the day/date, the time and the place of a meeting. Under "task-points" take 1 point off (in the same proportions as the max 30, i.e. about 7 of 30 per unit when there are four units) for each information unit that is missing or wrong; do not demand a letter's formal frame. Under "letter-form" a message needs a greeting OR a sign-off (either is enough) and a natural chat register — do not penalise a missing formal closing. The required length is lower (about 5 sentences); a message that fits the units in fewer, clear sentences is fine.`;

const A2_LETTER_COMPLETENESS = `This text is a LETTER to a friend (A2 task 1). Under "task-points" take off per missing or distorted bullet point as above; under "letter-form" expect a greeting, a natural flow and a sign-off.`;

function systemA2(topic: string | null | undefined): string {
  const note = topic === 'write-note';
  return `You are a TORFL (ТРКИ) examiner grading the Письмо (writing) subtest of the A2 / Basic level (ТБУ) exam of St Petersburg State University, for one adult English-speaking candidate.

You receive the task exactly as printed (situation + bullet points + the required sentence/question counts) and the candidate's ${note ? 'message' : 'letter'}.

${EXAM_WRITING_A2_STANDARD}

${note ? A2_NOTE_COMPLETENESS : A2_LETTER_COMPLETENESS}

${EXAM_WRITING_CRITERIA_TEXT.replace('FOR A1 —', 'FOR A2 —').replace('At A1 a few case-ending slips', 'At A2 a few case-ending slips')}

Scores may use halves (e.g. 17.5). Never exceed a criterion's max. Σ max is 100.

Corrections:
- "corrected": the full ${note ? 'message' : 'letter'}, corrected — identical where nothing needed fixing. Keep the candidate's meaning, order and voice; fix real errors only; do not upgrade vocabulary or add content.
- "changes": one entry per real change, with the exact "before" snippet from the text, the "after" snippet, and a short ENGLISH "explanation" that names the rule (case, aspect, agreement, motion verb, connector, …).
- "tips": 2–3 short English tips for the next ${note ? 'message' : 'letter'}, most useful first.
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
  "corrected": "<the full corrected ${note ? 'message' : 'letter'}>",
  "changes": [ { "before": "<…>", "after": "<…>", "explanation": "<…>" } ],
  "tips": ["<…>", "<…>"]
}`;
}

/** The system prompt for a level (+ the note topic at A2). A1 is the T72 text, byte for byte. */
export function examWritingSystem(level?: TorflLevel, taskTopic?: string | null): string {
  return level === 'A2' ? systemA2(taskTopic) : SYSTEM_A1;
}

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
  const a2Note = input.level === 'A2' && input.taskTopic === 'write-note';
  lines.push('', a2Note ? "THE CANDIDATE'S MESSAGE:" : "THE CANDIDATE'S LETTER:", input.letter);
  return [
    { role: 'system', content: examWritingSystem(input.level, input.taskTopic) },
    { role: 'user', content: lines.join('\n') },
  ];
}
