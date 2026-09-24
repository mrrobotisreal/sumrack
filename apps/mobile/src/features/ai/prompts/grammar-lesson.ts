import type { ProfileLanguage, ProfileSection } from '@/features/word-forms/profile-schema';

import type { ChatMessage } from '../client';
import { LANGUAGE_NAMES } from './word-profile';

/**
 * Grammar-lesson prompt (M16/T54, WORD_FORMS §6.2 — the system text is
 * VERBATIM from the design file; only `{LANGUAGE_NAME}`, `{SECTION_TITLE_EN}`
 * and `{HEADWORD}` are substituted). The user turn carries the STORED
 * section as JSON (ground truth the lesson may caveat but never silently
 * contradict), the overview facts, the learner's own encounters and the
 * learner level. Response contract = `GrammarLessonSchema` (lesson-core.ts):
 * bounded markdown, no automatic retry on failure.
 */

const SYSTEM_TEMPLATE = `You are a warm, precise {LANGUAGE_NAME} tutor writing for an English-speaking adult learner (~A1–A2 now, aiming for C1). Write ONE focused lesson in English, in Markdown, about ONE grammatical facet of ONE word: the section "{SECTION_TITLE_EN}" of «{HEADWORD}».

Ground truth: the structured forms below were generated earlier and the learner sees them as a table. Do not contradict them silently. If you are confident a form is wrong, keep teaching from the correct form and add a single line starting "Caveat:" naming the discrepancy.

Structure (use these headings):
## What this is and why it matters for «{HEADWORD}»   — 2–3 sentences.
## The pattern                                          — stem, endings, stress movement, exceptions; spell the rule out so it transfers to other words of the same class.
## The forms                                            — a Markdown table with stress marks and a gloss per form (only the forms of THIS section).
## In the wild                                          — at least 2, ideally 3–4, realistic sentences exactly as the word is used in life, chats, books or news; each: the {LANGUAGE_NAME} sentence with stress marks → a faithful English rendering → one line naming the form used and why. Prefer the situations in the learner's own encounters when given.
## Watch out                                            — 2–4 typical learner mistakes for this section + one memory hook.
## Check yourself                                       — 3 short questions; answers after a "---" line.

Rules: 350–700 words; Cyrillic NFC with ё preserved; stress marks (U+0301) on every {LANGUAGE_NAME} word of two or more syllables in the table and the examples; no preamble, no closing pleasantries; do not restate the whole profile — stay inside the section. Register notes where relevant (colloquial / bookish / vulgar).`;

/** The rendered system prompt for one word × section (exported for the prompt test). */
export function buildGrammarLessonSystem(
  language: ProfileLanguage,
  sectionTitleEn: string,
  headword: string,
): string {
  const name: string = LANGUAGE_NAMES[language];
  return SYSTEM_TEMPLATE.replaceAll('{LANGUAGE_NAME}', name)
    .replaceAll('{SECTION_TITLE_EN}', sectionTitleEn)
    .replaceAll('{HEADWORD}', headword);
}

/** One encounter line of the user turn: the sentence + the story it came from (when known). */
export interface LessonEncounter {
  ru: string;
  storyTitle?: string | null;
}

export interface GrammarLessonInput {
  language: ProfileLanguage;
  /** The profile's plain headword (ё preserved, no stress marks). */
  headword: string;
  /** The profile's `pos` slug and overview gloss. */
  pos: string;
  gloss: string;
  /** The STORED section (the current profile version's) — passed as JSON verbatim. */
  section: ProfileSection;
  /** Catalog title when the id is known, else the section's own (`sectionTitle()` in format.ts). */
  sectionTitleEn: string;
  /** Overview facts rendered as `label: value` lines. */
  facts: readonly { label: string; value: string }[];
  /** Up to 3 of the learner's own encounters (the caller trims). */
  encounters?: readonly LessonEncounter[];
  /** CEFR level from the latest assessment, else `A1` (§6.2). */
  learnerLevel: string;
}

/** The §6.2 user turn — the encounters block is omitted when there are none. */
export function buildGrammarLessonUserTurn(input: GrammarLessonInput): string {
  const lines = [
    `Word: «${input.headword}» (${input.pos}, gloss "${input.gloss}")`,
    `Section: ${input.section.id} — ${input.sectionTitleEn}`,
    `Structured forms (JSON): ${JSON.stringify(input.section)}`,
  ];
  const facts = input.facts.filter((f) => f.label.trim() && f.value.trim());
  lines.push(
    facts.length > 0
      ? `Overview facts:\n${facts.map((f) => `${f.label.trim()}: ${f.value.trim()}`).join('\n')}`
      : 'Overview facts: (none)',
  );
  const encounters = (input.encounters ?? [])
    .map((e) => ({ ru: e.ru.trim(), storyTitle: e.storyTitle?.trim() }))
    .filter((e) => e.ru);
  if (encounters.length > 0) {
    lines.push("Learner's own encounters:");
    for (const e of encounters) {
      lines.push(e.storyTitle ? `- «${e.ru}» (from «${e.storyTitle}»)` : `- «${e.ru}»`);
    }
  }
  lines.push(`Learner level: ${input.learnerLevel}`);
  return lines.join('\n');
}

export function buildGrammarLessonMessages(input: GrammarLessonInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildGrammarLessonSystem(input.language, input.sectionTitleEn, input.headword),
    },
    { role: 'user', content: buildGrammarLessonUserTurn(input) },
  ];
}
