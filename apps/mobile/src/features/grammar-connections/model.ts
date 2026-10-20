import { GrammarQuerySchema } from '@sumrak/schema';
import { z } from 'zod';

export const GRAMMAR_SKILL = 'location-destination';
export const PILOT_LESSON = { packId: 'a1-hotel-f04', unitId: 'u3' };
export const PILOT_PACKS = [
  { id: 'a1-no-end-house-001', version: 3 },
  { id: 'a1-tall-dog-001', version: 3 },
] as const;
export const LOCATION_TOPICS = ['prepositional-location', 'accusative-direction'] as const;
// Published M25 units do not yet author grammarQuery. Use a reviewed companion
// query for this one unit; prefer its schema-validated field when present.
export const PILOT_QUERY = GrammarQuerySchema.parse({ pos: 'noun' });
/** Reviewed constructions, not every sentence with a broad location tag. */
export const REVIEWED_EXAMPLES = [
  { packId: 'a1-no-end-house-001', sentenceId: 'nea1p1-s04', text: 'Мы дружили в колледже.' },
  {
    packId: 'a1-no-end-house-001',
    sentenceId: 'nea1p1-s08',
    text: 'После колледжа я жил в маленькой квартире и видел Питера редко.',
  },
  { packId: 'a1-no-end-house-001', sentenceId: 'nea1p2-s36', text: 'И я вхожу в третью комнату.' },
  { packId: 'a1-tall-dog-001', sentenceId: 'tda1p2-s06', text: 'Я встаю и иду в её комнату.' },
  { packId: 'a1-tall-dog-001', sentenceId: 'tda1p2-s07', text: 'В доме тихо и темно.' },
  {
    packId: 'a1-tall-dog-001',
    sentenceId: 'tda1p2-s08',
    text: 'В её комнате горит розовый ночник.',
  },
] as const;

export const FORM_TASKS = [
  {
    id: 'gc-location-1',
    contextId: 'hotel-waiting',
    meaning: 'Say where you are waiting.',
    trigger: 'Где?',
    stem: 'Я жду вас в … (коридор).',
    answers: ['коридоре', 'в коридоре', 'я жду вас в коридоре'],
    explanation: 'Waiting in a location: в + prepositional. Коридор → коридоре.',
  },
  {
    id: 'gc-destination-1',
    contextId: 'hotel-arrival',
    meaning: 'Say where you are going.',
    trigger: 'Куда?',
    stem: 'Я иду в … (коридор).',
    answers: ['коридор', 'в коридор', 'я иду в коридор'],
    explanation: 'A destination: в + accusative. Inanimate masculine коридор stays коридор.',
  },
  {
    id: 'gc-location-2',
    contextId: 'cafe-meeting',
    meaning: 'You are already inside the room. Say where you are sitting.',
    trigger: 'Где?',
    stem: 'Я сижу в … (комната).',
    answers: ['комнате', 'в комнате', 'я сижу в комнате'],
    explanation: 'The location is в комнате: the noun takes the prepositional ending -е.',
  },
  {
    id: 'gc-destination-2',
    contextId: 'home-visit',
    meaning: 'You enter the room. Give the destination.',
    trigger: 'Куда?',
    stem: 'Я вхожу в … (комната).',
    answers: ['комнату', 'в комнату', 'я вхожу в комнату'],
    explanation: 'The destination is в комнату: feminine -а becomes accusative -у.',
  },
] as const;

export function gradeForm(taskId: string, trigger: string, answer: string) {
  const task = FORM_TASKS.find((item) => item.id === taskId);
  if (!task) return false;
  // None of the reviewed keys tests ё; do not introduce fuzzy ending matching.
  const normalized = answer
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.!?,]/g, '')
    .trim();
  return task.trigger === trigger && task.answers.some((accepted) => accepted === normalized);
}

export const GrammarAttemptSchema = z.strictObject({
  version: z.literal(1),
  skillId: z.literal(GRAMMAR_SKILL),
  taskId: z.string(),
  contextId: z.string(),
  trigger: z.string(),
  answer: z.string(),
  ownSentence: z.string(),
  helpCount: z.number().int().nonnegative(),
  exposure: z.enum(['first', 'repeat']),
  grader: z.literal('authored-key'),
  productionGrader: z.literal('self-review'),
  correct: z.boolean(),
});
