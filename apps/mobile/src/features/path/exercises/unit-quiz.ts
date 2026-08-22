import { ExerciseSpecSchema, type ExerciseSpec } from '@sumrak/schema';

import type { Repositories } from '@/db/repositories';
import { answersMatch } from '@/lib/text';

/**
 * Unit-quiz generation (T17, design §7.5 "unit quiz"): the quiz is assembled
 * from the unit's OWN sentences and annotations — authored exercises are a
 * checkpoint thing; a course unit quizzes what it just taught. Generated
 * specs go through the exact same `ExerciseSpec` runner as authored
 * checkpoint tests (one engine, two sources) and are Zod-validated before
 * they're served, so the generator can never emit something the runner (or a
 * future authored override) couldn't.
 *
 * Read-state is irrelevant here on purpose: the quiz quotes the unit's own
 * material — taking the quiz early spoils nothing but the quiz (T13's
 * unseen-story rule protects OTHER stories, not a unit's own test).
 */

export interface QuizToken {
  text: string;
  isPunct: boolean;
  spaceBefore: boolean;
  lemma: string | null;
  lemmaNorm: string | null;
  translation: string | null;
  pos: string | null;
}

export interface QuizSentence {
  id: string;
  ru: string;
  en: string;
  tokens: QuizToken[];
}

export const UNIT_QUIZ_SIZE = 10;

function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface Candidate {
  sentence: QuizSentence;
  tokenIndex: number;
  token: QuizToken;
}

/** Content words worth quizzing: annotated, real words, not ultra-short. */
function contentWords(sentences: readonly QuizSentence[]): Candidate[] {
  const out: Candidate[] = [];
  for (const sentence of sentences) {
    sentence.tokens.forEach((token, tokenIndex) => {
      if (token.isPunct || !token.lemma || !token.translation) return;
      if (token.text.length < 3) return;
      out.push({ sentence, tokenIndex, token });
    });
  }
  return out;
}

/** Rebuild the sentence text with one token replaced by the cloze blank. */
function clozeSentence(sentence: QuizSentence, tokenIndex: number): string {
  let ru = '';
  sentence.tokens.forEach((t, i) => {
    ru += (t.spaceBefore ? ' ' : '') + (i === tokenIndex ? '___' : t.text);
  });
  return ru;
}

function wordTokens(sentence: QuizSentence): QuizToken[] {
  return sentence.tokens.filter((t) => !t.isPunct);
}

/**
 * Generate a unit quiz from unit sentences. Deterministic in SHAPE
 * (kind mix), random in which lemmas/sentences are drawn. Each bank of
 * distractors is checked for display collisions the same way the live games
 * are (T06/T13 rules).
 */
export function generateUnitQuiz(
  sentences: readonly QuizSentence[],
  size = UNIT_QUIZ_SIZE,
): ExerciseSpec[] {
  const specs: ExerciseSpec[] = [];
  const usedLemmas = new Set<string>();
  const usedSentences = new Set<string>();
  let n = 0;

  const candidates = shuffle(contentWords(sentences));
  const allWords = contentWords(sentences);

  const freshCandidate = () =>
    candidates.find(
      (c) =>
        !usedLemmas.has(c.token.lemmaNorm ?? c.token.lemma!) && !usedSentences.has(c.sentence.id),
    ) ?? candidates.find((c) => !usedLemmas.has(c.token.lemmaNorm ?? c.token.lemma!));

  const take = (c: Candidate) => {
    usedLemmas.add(c.token.lemmaNorm ?? c.token.lemma!);
    usedSentences.add(c.sentence.id);
  };

  const tryCloze = (): ExerciseSpec | null => {
    const c = freshCandidate();
    if (!c) return null;
    const seen = new Set([c.token.text.toLowerCase()]);
    const distractors: string[] = [];
    for (const other of shuffle(allWords)) {
      const text = other.token.text.toLowerCase();
      if (seen.has(text) || answersMatch(c.token.text, other.token.text)) continue;
      if (other.token.pos !== c.token.pos && distractors.length >= 2) continue;
      seen.add(text);
      distractors.push(other.token.text);
      if (distractors.length === 3) break;
    }
    if (distractors.length < 2) return null;
    take(c);
    return {
      id: `uq-cloze-${++n}`,
      kind: 'cloze',
      sentenceRu: clozeSentence(c.sentence, c.tokenIndex),
      answer: c.token.text,
      choices: shuffle([c.token.text, ...distractors]),
    };
  };

  const tryMc = (): ExerciseSpec | null => {
    const c = freshCandidate();
    if (!c) return null;
    const correct = c.token.translation!;
    const seen = new Set([correct.trim().toLowerCase()]);
    const distractors: string[] = [];
    for (const other of shuffle(allWords)) {
      const t = other.token.translation!.trim();
      const key = t.toLowerCase();
      if (
        seen.has(key) ||
        (other.token.lemmaNorm ?? other.token.lemma) === (c.token.lemmaNorm ?? c.token.lemma)
      )
        continue;
      seen.add(key);
      distractors.push(t);
      if (distractors.length === 3) break;
    }
    if (distractors.length < 3) return null;
    take(c);
    const choices = shuffle([correct, ...distractors]);
    return {
      id: `uq-mc-${++n}`,
      kind: 'multiple-choice',
      direction: 'ru-en',
      prompt: c.token.lemma!,
      choices,
      correctIndex: choices.indexOf(correct),
    };
  };

  const trySb = (): ExerciseSpec | null => {
    const sentence = shuffle(sentences).find((s) => {
      const words = wordTokens(s);
      return words.length >= 3 && words.length <= 8 && !usedSentences.has(s.id);
    });
    if (!sentence) return null;
    usedSentences.add(sentence.id);
    // Tiles lowercased so capitalization never leaks the first word (T13).
    const tokens = wordTokens(sentence).map((t) => t.text.toLowerCase());
    const distractors: string[] = [];
    for (const other of shuffle(allWords)) {
      const text = other.token.text.toLowerCase();
      if (tokens.some((t) => answersMatch(t, text)) || distractors.includes(text)) continue;
      distractors.push(text);
      if (distractors.length === 2) break;
    }
    return {
      id: `uq-sb-${++n}`,
      kind: 'sentence-builder',
      en: sentence.en,
      tokens,
      ...(distractors.length > 0 ? { distractors } : {}),
    };
  };

  const tryListening = (): ExerciseSpec | null => {
    const pool = sentences.filter((s) => {
      const words = wordTokens(s).length;
      return words >= 2 && words <= 8;
    });
    const target = shuffle(pool).find((s) => !usedSentences.has(s.id)) ?? shuffle(pool)[0];
    if (!target) return null;
    usedSentences.add(target.id);
    const seen = new Set([target.ru]);
    const distractors: string[] = [];
    for (const other of shuffle(pool)) {
      if (seen.has(other.ru)) continue;
      seen.add(other.ru);
      distractors.push(other.ru);
      if (distractors.length === 3) break;
    }
    if (distractors.length < 2) return null;
    take0(target.id);
    return {
      id: `uq-listen-${++n}`,
      kind: 'listening',
      text: target.ru,
      choices: shuffle([target.ru, ...distractors]),
    };
  };
  const take0 = (sentenceId: string) => usedSentences.add(sentenceId);

  // Kind mix: 3 cloze · 3 MC · 2 SB · 2 listening, shortfalls fall back to
  // MC → cloze; the quiz is whatever the content can honestly support.
  const plan: (() => ExerciseSpec | null)[] = [
    tryCloze,
    tryMc,
    trySb,
    tryListening,
    tryCloze,
    tryMc,
    trySb,
    tryListening,
    tryCloze,
    tryMc,
  ];
  for (const build of plan) {
    if (specs.length >= size) break;
    const spec = build() ?? tryMc() ?? tryCloze();
    if (spec) specs.push(spec);
  }

  // Zod gate (DoD): generated specs obey the exact authored-exercise contract.
  return shuffle(specs).map((s) => ExerciseSpecSchema.parse(s));
}

/** Load a unit's sentences from content tables and generate its quiz. */
export async function buildUnitQuizForPack(
  repos: Repositories,
  packId: string,
): Promise<ExerciseSpec[]> {
  const stories = (await repos.content.listStories()).filter((s) => s.packId === packId);
  const sentences: QuizSentence[] = [];
  for (const story of stories) {
    const detail = await repos.content.getStoryDetail(packId, story.id);
    if (!detail) continue;
    for (const s of detail.sentences) {
      sentences.push({
        id: s.id,
        ru: s.ru,
        en: s.en,
        tokens: s.tokens.map((t) => ({
          text: t.text,
          isPunct: t.isPunct,
          spaceBefore: t.spaceBefore,
          lemma: t.lemma,
          lemmaNorm: t.lemmaNorm,
          translation: t.translation,
          pos: t.pos,
        })),
      });
    }
  }
  return generateUnitQuiz(sentences);
}
