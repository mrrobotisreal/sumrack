import type { ExamSpeakingInput } from '../prompts/exam-speaking';
import type { ExamWritingInput } from '../prompts/exam-writing';

/**
 * T76 capture cases: the five A2 grading inputs (letter strong + weak, note, reply, monologue) the
 * dev-only capture screen sends to BOTH graders and `capture-ai-fixtures.ts` documents. Task text and
 * bullets are the `a2-exam-fixture` mock's (wr01 / wr02 / sp01 / sp05), so a captured grade reads
 * against what the exam printed. The candidate texts are authored with realistic A2 slips.
 */

export type A2CaptureCase =
  | { name: string; kind: 'writing'; input: ExamWritingInput }
  | { name: string; kind: 'speaking'; input: ExamSpeakingInput };

const LETTER_TASK = {
  taskRu: 'Вы закончили курс русского языка. Напишите письмо другу и расскажите об этом.',
  bullets: [
    { id: 'b1', ru: 'где и когда был курс' },
    { id: 'b2', ru: 'сколько времени вы учили русский' },
    { id: 'b3', ru: 'кто был преподавателем' },
    { id: 'b4', ru: 'что было самым трудным' },
    { id: 'b5', ru: 'что вам понравилось' },
    { id: 'b6', ru: 'спросите друга, хочет ли он тоже учиться' },
  ],
  minSentences: 10,
  minQuestions: 3,
  maxQuestions: 5,
  level: 'A2' as const,
  taskTopic: 'write-letter',
};

const NOTE_TASK = {
  taskRu:
    'Напишите другу сообщение и предложите встретиться. Укажите причину, день, время и место.',
  bullets: [
    { id: 'b1', ru: 'причина: почему вы не можете в другой день' },
    { id: 'b2', ru: 'какой день' },
    { id: 'b3', ru: 'во сколько' },
    { id: 'b4', ru: 'где' },
  ],
  minSentences: 5,
  minQuestions: 0,
  maxQuestions: null,
  level: 'A2' as const,
  taskTopic: 'write-note',
};

export const A2_CAPTURE_CASES: A2CaptureCase[] = [
  {
    name: 'a2-letter-strong',
    kind: 'writing',
    input: {
      ...LETTER_TASK,
      modelLetter: null,
      letter: [
        'Привет, Саша!',
        'Как дела? Я давно тебе не писал, потому что был очень занят.',
        'Недавно я закончил курс русского языка в Денвере. Курс начался в январе и закончился в июне.',
        'Я учил русский язык шесть месяцев, четыре раза в неделю.',
        'Нашим преподавателем была Ирина Петровна. Она очень добрая и терпеливая, и всегда объясняла нам грамматику простыми словами.',
        'Самым трудным были падежи и глаголы движения. Когда я говорил, я часто путал окончания.',
        'Но мне очень понравилось, что мы каждый день разговаривали и смотрели русские фильмы.',
        'Теперь я могу читать простые тексты и говорить с друзьями.',
        'А ты хочешь тоже учить русский? Может быть, мы можем заниматься вместе? Когда ты будешь свободен?',
        'Пиши мне скорее!',
        'Твой друг Митч',
      ].join('\n'),
    },
  },
  {
    name: 'a2-letter-weak',
    kind: 'writing',
    input: {
      ...LETTER_TASK,
      modelLetter: null,
      // Short, A1-level, one tense, no connectors, wrong cases, two bullets missing, one question.
      letter:
        'Привет Саша. Я закончил курс русский язык. Курс был в Денвер. Я учить русский три месяц. Мне нравится курс. Ты хотеть учиться?',
    },
  },
  {
    name: 'a2-note',
    kind: 'writing',
    input: {
      ...NOTE_TASK,
      modelLetter: null,
      // Reason, day and time present; the place is missing; one case slip.
      letter:
        'Привет, Алина! В пятницу я работаю допоздна, поэтому предлагаю встретиться в субботу. Давай в три часа дня? Напиши, если тебе удобно.',
    },
  },
  {
    name: 'a2-reply',
    kind: 'speaking',
    input: {
      task: 'reply',
      promptRu: 'Как вы обычно проводите выходные?',
      transcript:
        'обычно по выходным я гуляю с друзьями в парке а вечером мы идём в кафе или смотрим фильм дома',
      assistTranscript:
        'Обычно по выходным я гуляю с друзьями в парке, а вечером мы идём в кафе или смотрим фильм дома.',
      modelAnswer: 'Обычно я гуляю с друзьями.',
      level: 'A2',
    },
  },
  {
    name: 'a2-monologue',
    kind: 'speaking',
    input: {
      task: 'monologue',
      promptRu: 'Мой любимый праздник',
      questionsRu: [
        'Какой ваш любимый праздник?',
        'Когда он бывает?',
        'Как вы его празднуете?',
        'Кто бывает с вами?',
        'Что вы едите и пьёте?',
        'Что вам нравится больше всего?',
      ],
      minSentences: 12,
      maxSentences: 15,
      level: 'A2',
      transcript:
        'мой любимый праздник это новый год он бывает в конце декабря и в начале январь у нас в семье мы всегда готовим много еды за несколько дней перед праздником мама делает салат оливье а я помогаю ей на кухне вечером тридцать первого декабря приходят мои родители и мои друзья мы вместе сидим за столом и разговариваем в двенадцать часов мы смотрим по телевизору президент и пьём шампанское потом мы дарим друг другу подарки на новый год я всегда получаю что-нибудь интересное больше всего мне нравится когда вся семья вместе и мы смеёмся и поём песни после праздника я два дня отдыхаю дома',
      assistTranscript:
        'Мой любимый праздник — это Новый год. Он бывает в конце декабря и в начале январь. У нас в семье мы всегда готовим много еды за несколько дней перед праздником. Мама делает салат оливье, а я помогаю ей на кухне. Вечером тридцать первого декабря приходят мои родители и мои друзья. Мы вместе сидим за столом и разговариваем. В двенадцать часов мы смотрим по телевизору президент и пьём шампанское. Потом мы дарим друг другу подарки. На Новый год я всегда получаю что-нибудь интересное. Больше всего мне нравится, когда вся семья вместе, и мы смеёмся и поём песни. После праздника я два дня отдыхаю дома.',
      modelAnswer: null,
    },
  },
];
