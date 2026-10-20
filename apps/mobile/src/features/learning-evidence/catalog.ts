import { z } from 'zod';

export const SKILL_IDS = [
  'location-destination',
  'genitive-possession-absence',
  'dative-verbs',
  'adjective-agreement',
  'past-gender',
  'aspect-context',
  'motion-verbs',
  'number-agreement',
  'question-formation',
  'polite-requests',
] as const;
export type SkillId = (typeof SKILL_IDS)[number];
export const PILOT_SKILLS = [
  'location-destination',
  'dative-verbs',
  'adjective-agreement',
] as const;
export type PilotSkill = (typeof PILOT_SKILLS)[number];
export const SkillSchema = z.enum(PILOT_SKILLS);
export function isPilotSkill(id: string): id is PilotSkill {
  return SkillSchema.safeParse(id).success;
}

export const SKILLS: Record<PilotSkill, { title: string; explanation: string; example: string }> = {
  'location-destination': {
    title: 'Location or destination',
    explanation:
      'First choose the meaning: где? describes where someone is (в/на + prepositional); куда? describes a destination (в/на + accusative). A moving person can still be moving within one place: Я гуляю в парке.',
    example:
      'Я сижу в кухне. → Я иду в кухню.\nI am sitting in the kitchen. → I am going into the kitchen.',
  },
  'dative-verbs': {
    title: 'Dative after verbs',
    explanation:
      'Звонить and помогать ask кому? Use the dative for the person: сестре, брату, мне. With дать or подарить, the recipient is dative and the thing given is accusative.',
    example: 'Я звоню сестре. Я помогаю брату.\nI call my sister. I help my brother.',
  },
  'adjective-agreement': {
    title: 'Adjective agreement',
    explanation:
      'Match an adjective to the noun’s gender and number: новый стол, новая сумка, новое окно, новые книги. In other cases the adjective also follows the noun’s case.',
    example: 'Это новая чашка, а это новое блюдце.\nThis is a new cup, and this is a new saucer.',
  },
};

const PromptSchema = z.object({
  id: z.string().min(1),
  skill: SkillSchema,
  context: z.string().min(1),
  instruction: z.string().min(1),
  sentence: z.string().min(1),
  answer: z.string().min(1),
  explanation: z.string().min(1),
});
/** Authored everyday material, reviewed against the stated case/meaning; no exam items. */
export const PRACTICE = z.array(PromptSchema).parse([
  {
    id: 'location-kitchen-v1',
    skill: 'location-destination',
    context: 'home-cooking',
    instruction: 'You are going into the kitchen to make tea. Complete with the form of кухня.',
    sentence: 'Я иду в ____, чтобы приготовить чай.',
    answer: 'кухню',
    explanation: 'The kitchen is your destination: куда? В + accusative, кухня → кухню.',
  },
  {
    id: 'location-pharmacy-v1',
    skill: 'location-destination',
    context: 'neighborhood-errand',
    instruction: 'You are already inside the pharmacy. Complete with the form of аптека.',
    sentence: 'Я сейчас в ____ и покупаю лекарство.',
    answer: 'аптеке',
    explanation: 'You are already there: где? В + prepositional, аптека → аптеке.',
  },
  {
    id: 'dative-neighbor-v1',
    skill: 'dative-verbs',
    context: 'neighbor-help',
    instruction: 'You help your female neighbor carry a bag. Complete with the form of соседка.',
    sentence: 'Я помогаю ____ нести сумку.',
    answer: 'соседке',
    explanation: 'Помогать кому? takes the dative: соседка → соседке.',
  },
  {
    id: 'dative-dentist-v1',
    skill: 'dative-verbs',
    context: 'appointment-call',
    instruction:
      'You call a male dentist about an appointment. Complete with the form of стоматолог.',
    sentence: 'Утром я звоню ____.',
    answer: 'стоматологу',
    explanation: 'Звонить кому? takes the dative: стоматолог → стоматологу.',
  },
  {
    id: 'agreement-coat-v1',
    skill: 'adjective-agreement',
    context: 'clothes-shopping',
    instruction: 'Describe a warm coat. Complete with the form of тёплый.',
    sentence: 'Мне нужно ____ пальто.',
    answer: 'тёплое',
    explanation: 'Пальто is neuter, even though it does not decline: тёплое пальто.',
  },
  {
    id: 'agreement-berries-v1',
    skill: 'adjective-agreement',
    context: 'market-fruit',
    instruction: 'Describe fresh berries. Complete with the form of свежий.',
    sentence: 'На столе лежат ____ ягоды.',
    answer: 'свежие',
    explanation: 'Ягоды is plural: the adjective is свежие.',
  },
]);
export type PracticePrompt = (typeof PRACTICE)[number];
