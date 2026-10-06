import type { ChatMessage } from '../client';

/**
 * TORFL A1 speaking rubric prompt (T73, TORFL_EXAM_PREP §6.2). The
 * examiner grades ONE recorded answer from its ASR transcript(s) — a reply
 * (task 1), a dialogue opener for a situation (task 2) or the 2-minute
 * monologue (task 3) — on the criteria the offline grader pins (Σ max =
 * 100), returns a cleaned-up model of what the candidate said, and pins
 * the JSON `ExamGradeSchema` parses. The schema, `features/torfl/grading/
 * speaking.ts` and this contract move together (the fixture tests pin all
 * three).
 *
 * The transcripts come from on-device recognizers with no punctuation and
 * occasional mis-hearings; the grader is told so and asked to judge
 * MEANING, not transcription noise. When the Whisper assist transcript
 * exists it is given too (and preferred for the monologue).
 */

export type ExamSpeakingTask = 'reply' | 'situation' | 'monologue';

export interface ExamSpeakingInput {
  task: ExamSpeakingTask;
  /** Task 1: the examiner's line; task 2: the situation as read aloud; task 3: the topic title. */
  promptRu: string;
  /** Task 2: the situation text as printed (RU). */
  situationRu?: string | null;
  /** Task 3: the topic's guiding questions (RU). */
  questionsRu?: string[];
  /** Task 3: the required sentence range. */
  minSentences?: number;
  maxSentences?: number;
  /** The primary (Zipformer) ASR transcript. */
  transcript: string;
  /** The Whisper assist re-decode, when installed. */
  assistTranscript?: string | null;
  /** The model answer (tasks 1–2: `accept[0]`; task 3: the model monologue's text) — calibration only. */
  modelAnswer?: string | null;
}

export const EXAM_SPEAKING_TURN_CRITERIA_TEXT = `Criteria (max points):
- "task-response" (60): does the answer DO what the task asks — answer the examiner's question with the asked-for information (task 1), or open the dialogue appropriately for the situation (task 2)? A full 60 for a clear, on-task answer; partial for an answer that goes the right way but misses the point; 0 for off-task, «да / нет / не знаю» alone, or nothing.
- "completeness" (20): is it a FULL answer — a sentence with the content words the task needs (name / place / reason …), not a single word or a bare yes/no? 20 for a complete utterance, 10 for a fragment that still carries the information, 0 for a bare word.
- "grammar" (20): grammar and appropriacy FOR A1 — verb forms, basic cases, word order, a register that fits (ты/вы, the polite formulas a situation needs). A couple of A1 slips cost little; a form that obscures meaning costs more. Judge MEANING, not ASR noise.`;

export const EXAM_SPEAKING_MONOLOGUE_CRITERIA_TEXT = `Criteria (max points):
- "coverage" (40): how many of the topic's guiding questions are answered, and how well. Give credit per question answered in at least one plausible sentence.
- "length" (20): the number of real sentences vs the required range (the ASR has no punctuation — count clauses by sense). Short of the minimum: proportional. Within the range: full.
- "fluency" (10): does it read like continuous speech on the topic — connected sentences, not a word list; repeats and restarts cost a little.
- "lexis-grammar" (30): vocabulary range and correctness FOR A1 and grammar — agreement, cases, verb forms, word order. Deduct proportionally to how many errors there are and how badly they obscure meaning, never per slip mechanically.`;

function system(task: ExamSpeakingTask): string {
  const what =
    task === 'monologue'
      ? 'the task-3 MONOLOGUE: the candidate chose one of two topics, prepared for 8 minutes with its guiding questions, and spoke for up to 2 minutes'
      : task === 'situation'
        ? 'a task-2 SITUATION: the candidate reads a situation and must START the dialogue (ask, request, greet, invite — whatever the situation calls for)'
        : 'a task-1 REPLY: the examiner asks a question once and the candidate answers; «да», «нет», «не знаю» alone is not a full answer';
  const criteria =
    task === 'monologue' ? EXAM_SPEAKING_MONOLOGUE_CRITERIA_TEXT : EXAM_SPEAKING_TURN_CRITERIA_TEXT;
  const ids =
    task === 'monologue'
      ? `    { "id": "coverage", "score": <0-40>, "max": 40, "comment": "<…>" },
    { "id": "length", "score": <0-20>, "max": 20, "comment": "<…>" },
    { "id": "fluency", "score": <0-10>, "max": 10, "comment": "<…>" },
    { "id": "lexis-grammar", "score": <0-30>, "max": 30, "comment": "<…>" }`
      : `    { "id": "task-response", "score": <0-60>, "max": 60, "comment": "<…>" },
    { "id": "completeness", "score": <0-20>, "max": 20, "comment": "<…>" },
    { "id": "grammar", "score": <0-20>, "max": 20, "comment": "<…>" }`;
  return `You are a TORFL (ТРКИ) examiner grading the Говорение (speaking) subtest of the A1 / Elementary level (ТЭУ) exam of St Petersburg State University, for one adult English-speaking candidate. You are grading ${what}.

You do NOT hear the audio. You receive the candidate's answer as an AUTOMATIC SPEECH RECOGNITION transcript (sometimes two: an on-device Russian recognizer and a Whisper re-decode). ASR has no punctuation and may mis-hear a word (a case ending, a name, a city). Judge the MEANING the candidate most plausibly produced; never penalize what is clearly a transcription artefact, and never reward a word the candidate plausibly did not say. When two transcripts disagree, take the reading more consistent with the task.

Grade honestly at the A1 standard: the exam asks for simple, correct, on-task spoken communication — not literary Russian.

${criteria}

Scores may use halves (e.g. 17.5). Never exceed a criterion's max. Σ max is 100.

Corrections:
- "corrected": what the candidate said, written out as clean correct Russian with punctuation — identical in content where nothing needed fixing. Keep the candidate's meaning, order and voice; fix real errors only; do not upgrade vocabulary or add content. Empty string if nothing was said.
- "changes": one entry per real change, with the exact "before" snippet from the transcript, the "after" snippet, and a short ENGLISH "explanation" that names the rule (case, aspect, agreement, register, …). Do not list ASR artefacts as changes.
- "tips": 2–3 short English tips for the next answer, most useful first.
- Each criterion's "comment": one or two English sentences saying what earned or cost points — concrete, quoting Russian where helpful.

Respond with ONLY a JSON object, no markdown fences, no prose around it:
{
  "criteria": [
${ids}
  ],
  "corrected": "<the cleaned-up answer>",
  "changes": [ { "before": "<…>", "after": "<…>", "explanation": "<…>" } ],
  "tips": ["<…>", "<…>"]
}`;
}

export function buildExamSpeakingMessages(input: ExamSpeakingInput): ChatMessage[] {
  const lines: string[] = [];
  if (input.task === 'reply') {
    lines.push("THE EXAMINER'S QUESTION (spoken once):", input.promptRu);
  } else if (input.task === 'situation') {
    lines.push('THE SITUATION (as printed and read aloud):', input.situationRu ?? input.promptRu);
  } else {
    lines.push('THE TOPIC:', input.promptRu);
    if (input.questionsRu && input.questionsRu.length > 0) {
      lines.push('', 'Guiding questions:');
      input.questionsRu.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`));
    }
    const min = input.minSentences ?? 10;
    const max = input.maxSentences ?? 12;
    lines.push('', `Required: ${min}–${max} sentences.`);
  }
  if (input.modelAnswer) {
    lines.push(
      '',
      'A MODEL ANSWER (calibration only — the candidate may say different true things; do not grade against its content):',
      input.modelAnswer,
    );
  }
  lines.push('', "THE CANDIDATE'S ANSWER — ASR transcript (on-device Russian recognizer):");
  lines.push(input.transcript.trim().length > 0 ? input.transcript : '(nothing recognized)');
  if (input.assistTranscript && input.assistTranscript.trim().length > 0) {
    lines.push(
      '',
      input.task === 'monologue'
        ? 'The same recording re-decoded by Whisper (usually the better reading for longer speech):'
        : 'The same recording re-decoded by Whisper:',
      input.assistTranscript,
    );
  }
  return [
    { role: 'system', content: system(input.task) },
    { role: 'user', content: lines.join('\n') },
  ];
}
