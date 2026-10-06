/**
 * Regenerate the recorded AI fixtures the T16 unit tests parse
 * (src/features/ai/__tests__/__fixtures__/). Run from apps/mobile:
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/capture-ai-fixtures.ts
 *
 * (or `set -a; source ../../.env; set +a` first — never paste the key.)
 *
 * Uses the SAME in-repo prompt builders the app ships, so the fixtures
 * always reflect the current templates. Responses contain only synthetic
 * study content — nothing personal, no secrets — and are safe to commit.
 * Tests never hit the network; this script is the only live caller.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssessmentMessages } from '../src/features/ai/prompts/assessment';
import { buildEnrichmentMessages } from '../src/features/ai/prompts/enrichment';
import { buildExplainMessages } from '../src/features/ai/prompts/explain';
import {
  buildGrammarLessonMessages,
  type GrammarLessonInput,
} from '../src/features/ai/prompts/grammar-lesson';
import { buildImportAnnotateMessages } from '../src/features/ai/prompts/import-annotate';
import { buildJournalFeedbackMessages } from '../src/features/ai/prompts/journal-feedback';
import {
  buildWordProfileMessages,
  type WordProfileInput,
} from '../src/features/ai/prompts/word-profile';
import { buildRescueMessages, type RescueInput } from '../src/features/ai/prompts/scenario-rescue';
import {
  buildExamWritingMessages,
  type ExamWritingInput,
} from '../src/features/ai/prompts/exam-writing';

const MODEL = 'anthropic/claude-sonnet-5';
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/features/ai/__tests__/__fixtures__',
);

const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}

/** Deliberately flawed A2-ish entry — exercises several correction kinds. */
const JOURNAL_ENTRY = [
  'Вчера я идти в магазин с моя невеста.',
  'Мы купили много продукты и один странный зеркало.',
  'Ночью я слышал стук в стене, но я не боюсь темноты.',
].join(' ');

const ENRICHMENT_ITEMS = [
  {
    id: 'fx-word-1',
    kind: 'word' as const,
    surface: 'словами',
    context: 'Он говорил простыми словами, но я всё равно не понял.',
  },
  {
    id: 'fx-word-2',
    kind: 'word' as const,
    surface: 'наверху',
    translation: 'upstairs',
    context: 'Кто-то ходит наверху, но дом пустой.',
  },
  {
    id: 'fx-phrase-1',
    kind: 'phrase' as const,
    surface: 'по крайней мере',
    context: 'По крайней мере, дверь была закрыта.',
  },
];

/** Synthetic-but-plausible T18 assessment bundle (sparse early-days data). */
const ASSESSMENT_BUNDLE = {
  stats: {
    'A1 lemmas encountered / collected / reviewed-shaky / young / mature': '140 / 14 / 12 / 2 / 0',
    'A2 lemmas encountered / collected / reviewed-shaky / young / mature': '27 / 4 / 4 / 0 / 0',
    'Grammar topics in installed content': 42,
    'Grammar topics seen in reading / with reviewed vocabulary': '30 / 18',
    'Total reviews completed': 65,
    'Total reading time (minutes)': 60,
    'Stories finished': 5,
    'Current activity streak (days)': 2,
    'Pronunciation attempts / average score (0-100, speech-recognition match)': '14 / 92',
    'Checkpoint a1-checkpoint-001': '100% (passed)',
  },
  journal: [
    {
      ru: 'Вчера я идти в магазин с моя невеста. Мы купили много продукты и один странный зеркало. Ночью я слышал стук в стене, но я не боюсь темноты.',
      corrected:
        'Вчера я ходил в магазин с моей невестой. Мы купили много продуктов и одно странное зеркало. Ночью я слышал стук в стене, но я не боюсь темноты.',
      createdAt: Date.UTC(2026, 7, 21),
    },
  ],
};

/**
 * T29 import-annotation batch: conversational + literary + the recorded
 * edge cases (name, latin brand, digits, emoji, «» quotes) in one batch so
 * the fixture exercises the whole token contract.
 */
const IMPORT_SENTENCES = [
  { id: 'c1', ru: 'Привет, любимый!' },
  {
    id: 'c2',
    ru: 'Мы с мамой купили продукты в магазине «Пятёрочка» и заказали пиццу через Yandex.',
  },
  { id: 'c3', ru: 'Приходи к нам в 19:30, будет вкусный борщ 🙂' },
  { id: 'c4', ru: 'Анна Ахматова писала: «Я научилась просто, мудро жить».' },
];

/**
 * T52 word-profile inputs (WORD_FORMS §6.3): a verb, a noun, an adjective
 * and a phrase — captured at Sonnet 5 / effort medium through the SAME
 * request shape the app's run profile sends (`verbosity` + `reasoning`
 * + `usage.include`, mirrored inline because run-profile.ts opens the
 * native DB and cannot load under Node).
 */
const WORD_PROFILE_INPUTS: { name: string; input: WordProfileInput }[] = [
  {
    name: 'word-profile-verb',
    input: {
      language: 'ru',
      kind: 'word',
      headword: 'говорить',
      surface: 'говорил',
      translation: 'to speak, to talk',
      grammar: 'past, masc.',
      pos: 'verb',
      level: 'A1',
      contexts: ['Он говорил тихо, но я всё слышал.', 'Не говори никому.'],
    },
  },
  {
    name: 'word-profile-noun',
    input: {
      language: 'ru',
      kind: 'word',
      headword: 'окно',
      surface: 'окна',
      translation: 'window',
      pos: 'noun',
      level: 'A1',
      contexts: ['Кто-то стучал в окно, но за окном никого не было.'],
    },
  },
  {
    name: 'word-profile-adj',
    input: {
      language: 'ru',
      kind: 'word',
      headword: 'страшный',
      surface: 'страшно',
      translation: 'scary, terrible',
      grammar: 'short form / adverb',
      pos: 'adj',
      level: 'A2',
      contexts: ['Мне было страшно идти по тёмному коридору.'],
    },
  },
  {
    name: 'word-profile-phrase',
    input: {
      language: 'ru',
      kind: 'phrase',
      headword: 'волосы встали дыбом',
      translation: "one's hair stood on end",
      level: 'B1',
      contexts: ['Когда я услышал шаги наверху, у меня волосы встали дыбом.'],
    },
  },
];
/** The T52 capture notch: Sonnet 5 = Anthropic «Fast», effort medium. */
const WORD_PROFILE_EXTRAS = {
  verbosity: 'medium',
  reasoning: { enabled: true, exclude: true },
  usage: { include: true },
};
const WORD_PROFILE_MAX_TOKENS = 16_384;

/**
 * T54 grammar-lesson input (WORD_FORMS §6.2 + §6.3): «говорить» ×
 * `verb-nonpast`, grounded in the STORED section of the captured verb
 * profile (`word-profile-verb.json`) so the fixture teaches from exactly
 * what the app would pass. Same notch as the profiles (Sonnet 5, medium).
 */
function grammarLessonInput(): GrammarLessonInput {
  const verb = JSON.parse(readFileSync(join(OUT_DIR, 'word-profile-verb.json'), 'utf8')) as {
    choices: { message: { content: string } }[];
  };
  const raw = verb.choices[0]!.message.content;
  const profile = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
    pos: string;
    headword: { plain: string };
    overview: { gloss: string; facts: { label: string; value: string }[] };
    sections: GrammarLessonInput['section'][];
  };
  const section = profile.sections.find((s) => s.id === 'verb-nonpast');
  if (!section) throw new Error('word-profile-verb.json has no verb-nonpast section');
  return {
    language: 'ru',
    headword: profile.headword.plain,
    pos: profile.pos,
    gloss: profile.overview.gloss,
    section,
    sectionTitleEn: 'Present & future',
    facts: profile.overview.facts,
    encounters: [
      { ru: 'Он говорил тихо, но я всё слышал.', storyTitle: 'Высокий Пёс' },
      { ru: 'Не говори никому.', storyTitle: 'Ужасная правда' },
    ],
    learnerLevel: 'A1',
  };
}
const GRAMMAR_LESSON_MAX_TOKENS = 12_288;

/**
 * T60 scenario-rescue fixtures (SPEAKING_SCENARIOS §5.3): the SAME turn
 * («Откуда ты?», podcast A1 t03) with an off-script-but-valid answer the
 * offline judge misses (⇒ accept) and a wrong speech act (⇒ reject).
 * Captured at the Anthropic `fastest` notch the app uses (Haiku 4.5, effort
 * low, temperature 0, 200 tokens) — `RESCUE_MODEL` below mirrors
 * `DEFAULT_MODEL_TABLE.anthropic.fastest`.
 */
const RESCUE_MODEL = 'anthropic/claude-haiku-4.5';
const RESCUE_TURN: Omit<RescueInput, 'transcript'> = {
  language: 'ru',
  questionRu: 'Очень приятно! Откуда ты?',
  questionEn: 'Nice to meet you! Where are you from?',
  slots: [
    {
      kind: 'forms',
      id: 'origin',
      required: true,
      acceptsNumber: false,
      options: [
        { key: 'usa', lemma: 'Америка', forms: ['америк*', 'сша', 'штат*'] },
        { key: 'colorado', lemma: 'Колорадо', forms: ['колорадо'] },
        { key: 'elsewhere', lemma: 'из', forms: ['из'] },
      ],
    },
  ],
  accept: ['Я из Америки.', 'Из Колорадо.', 'Я из США.'],
  allowedKeys: ['usa', 'colorado', 'elsewhere'],
};
const RESCUE_CASES: { name: string; transcript: string }[] = [
  // Valid, off-script: names the city only — no «из», no authored form (a real offline miss).
  { name: 'scenario-rescue-accept', transcript: 'я родился в денвере и живу там всю жизнь' },
  // Wrong speech act: a thank-you instead of an answer.
  { name: 'scenario-rescue-reject', transcript: 'спасибо большое очень приятно' },
];
const RESCUE_EXTRAS = {
  verbosity: 'low',
  reasoning: { enabled: true, exclude: true },
  usage: { include: true },
};

/**
 * T72 exam-writing fixtures (TORFL_EXAM_PREP §6.2): the fixture mock's letter
 * task (`a1-exam-fixture` / `wr01`) graded for one good and one weak letter,
 * on BOTH providers of the run-profile table at the «Exam grading» default
 * notch — Anthropic normal (Opus 5.5) at effort HIGH, and the GPT-class
 * normal (GPT-6 Sol Pro) at effort high — so the Session log can compare
 * the two graders' scores for the same letters. Temperature 0.2 = the queue.
 */
const EXAM_WRITING_TASK: Omit<ExamWritingInput, 'letter'> = {
  taskRu: 'Ваш друг хочет знать о вашей жизни. Напишите ему письмо.',
  bullets: [
    { id: 'b1', ru: 'как вас зовут' },
    { id: 'b2', ru: 'где вы живёте' },
    { id: 'b3', ru: 'где вы работаете' },
    { id: 'b4', ru: 'что вы любите делать' },
  ],
  minSentences: 10,
  minQuestions: 2,
  maxQuestions: 5,
  modelLetter: null,
};
const EXAM_WRITING_LETTERS: { name: string; letter: string }[] = [
  {
    name: 'good',
    letter: [
      'Привет, Саша!',
      'Меня зовут Митч. Мне тридцать шесть лет. Я живу в Колорадо.',
      'Я работаю программистом. Это интересная работа.',
      'Я люблю читать и слушать музыку. Ещё мне нравится готовить.',
      'А как ты? Где ты сейчас живёшь? Что ты любишь делать?',
      'Пока! Жду ответа.',
      'Твой друг Митч',
    ].join('\n'),
  },
  {
    name: 'weak',
    // Short, several real A1 errors, one bullet missing, no question, no greeting.
    letter:
      'Меня зовут Митч. Я живу в Колорадо с моя невеста. Я работать в компания. Я люблю читать книга. Пока.',
  },
];
const EXAM_WRITING_MODELS: {
  tag: string;
  model: string;
  extras: Record<string, unknown>;
}[] = [
  {
    tag: 'claude',
    model: 'anthropic/claude-opus-5.5',
    extras: {
      verbosity: 'high',
      reasoning: { enabled: true, exclude: true },
      usage: { include: true },
    },
  },
  {
    tag: 'gpt',
    model: 'openai/gpt-6-sol-pro',
    extras: { reasoning: { effort: 'high', exclude: true }, usage: { include: true } },
  },
];
const EXAM_WRITING_MAX_TOKENS = 8_192;

async function chat(
  messages: unknown,
  maxTokens: number,
  opts: { temperature?: number; extras?: Record<string, unknown> } = {},
): Promise<unknown> {
  return chatWith(MODEL, messages, maxTokens, opts);
}

async function chatWith(
  model: string,
  messages: unknown,
  maxTokens: number,
  opts: { temperature?: number; extras?: Record<string, unknown> } = {},
): Promise<unknown> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: opts.temperature ?? 0.3,
      ...(opts.extras ?? {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function slim(raw: unknown): { model: string; content: string } {
  // Persist only the envelope slice the app consumes — no ids/usage/etc.
  const body = raw as { model?: string; choices: { message: { content: string } }[] };
  return { model: body.model ?? MODEL, content: body.choices[0]!.message.content };
}

/**
 * T52 fixtures keep `usage` + `choices[0].finish_reason` too, so the T51
 * usage parser is exercised by a real response (client.test.ts). Shape =
 * the OpenRouter envelope slice `OpenRouterResponseSchema` reads.
 */
function slimWithUsage(raw: unknown): {
  model: string;
  choices: { message: { content: string }; finish_reason: string | null }[];
  usage: unknown;
} {
  const body = raw as {
    model?: string;
    choices: { message: { content: string }; finish_reason?: string | null }[];
    usage?: unknown;
  };
  const first = body.choices[0]!;
  return {
    model: body.model ?? MODEL,
    choices: [
      { message: { content: first.message.content }, finish_reason: first.finish_reason ?? null },
    ],
    usage: body.usage ?? null,
  };
}

/** Optional filter: `npx tsx scripts/capture-ai-fixtures.ts assessment` recaptures one fixture. */
const ONLY = process.argv[2];
const wants = (name: string) => !ONLY || ONLY === name;

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  if (wants('journal-feedback')) {
    console.log('capturing journal feedback…');
    const feedback = slim(await chat(buildJournalFeedbackMessages(JOURNAL_ENTRY), 4096));
    writeFileSync(
      join(OUT_DIR, 'journal-feedback.json'),
      JSON.stringify({ entryRu: JOURNAL_ENTRY, ...feedback }, null, 2),
    );
  }

  if (wants('enrichment')) {
    console.log('capturing enrichment…');
    const enrichment = slim(await chat(buildEnrichmentMessages(ENRICHMENT_ITEMS), 4096));
    writeFileSync(
      join(OUT_DIR, 'enrichment.json'),
      JSON.stringify({ items: ENRICHMENT_ITEMS, ...enrichment }, null, 2),
    );
  }

  if (wants('explain')) {
    console.log('capturing explain (sentence)…');
    const explain = slim(
      await chat(
        buildExplainMessages({
          kind: 'sentence',
          ru: 'Ночью я слышу стук в стене.',
          en: 'At night I hear a knocking in the wall.',
        }),
        1024,
      ),
    );
    writeFileSync(join(OUT_DIR, 'explain-sentence.json'), JSON.stringify(explain, null, 2));
  }

  if (wants('assessment')) {
    console.log('capturing assessment…');
    const assessment = slim(await chat(buildAssessmentMessages(ASSESSMENT_BUNDLE), 2048));
    writeFileSync(
      join(OUT_DIR, 'assessment.json'),
      JSON.stringify({ bundle: ASSESSMENT_BUNDLE, ...assessment }, null, 2),
    );
  }

  if (wants('import-annotate')) {
    console.log('capturing import annotation…');
    const annotate = slim(await chat(buildImportAnnotateMessages(IMPORT_SENTENCES), 8192));
    writeFileSync(
      join(OUT_DIR, 'import-annotate.json'),
      JSON.stringify({ sentences: IMPORT_SENTENCES, ...annotate }, null, 2),
    );
  }

  for (const { name, input } of WORD_PROFILE_INPUTS) {
    if (!wants(name)) continue;
    console.log(`capturing ${name} («${input.headword}», ${MODEL}, effort medium)…`);
    const raw = await chat(buildWordProfileMessages(input), WORD_PROFILE_MAX_TOKENS, {
      temperature: 0.2,
      extras: WORD_PROFILE_EXTRAS,
    });
    writeFileSync(
      join(OUT_DIR, `${name}.json`),
      JSON.stringify({ input, ...slimWithUsage(raw) }, null, 2),
    );
  }

  if (wants('grammar-lesson')) {
    const input = grammarLessonInput();
    console.log(`capturing grammar-lesson («${input.headword}» × ${input.section.id}, ${MODEL})…`);
    const raw = await chat(buildGrammarLessonMessages(input), GRAMMAR_LESSON_MAX_TOKENS, {
      temperature: 0.4,
      extras: WORD_PROFILE_EXTRAS,
    });
    writeFileSync(
      join(OUT_DIR, 'grammar-lesson.json'),
      JSON.stringify({ input, ...slimWithUsage(raw) }, null, 2),
    );
  }

  for (const { name, transcript } of RESCUE_CASES) {
    if (!wants(name)) continue;
    console.log(`capturing ${name} (${RESCUE_MODEL}, fastest/low)…`);
    const input: RescueInput = { ...RESCUE_TURN, transcript };
    const raw = await chatWith(RESCUE_MODEL, buildRescueMessages(input), 200, {
      temperature: 0,
      extras: RESCUE_EXTRAS,
    });
    writeFileSync(
      join(OUT_DIR, `${name}.json`),
      JSON.stringify({ input, ...slimWithUsage(raw) }, null, 2),
    );
  }

  for (const { tag, model, extras } of EXAM_WRITING_MODELS) {
    for (const { name, letter } of EXAM_WRITING_LETTERS) {
      const fixtureName = `exam-writing-${name}-${tag}`;
      if (!wants(fixtureName) && !wants('exam-writing')) continue;
      console.log(`capturing ${fixtureName} (${model}, effort high)…`);
      const input: ExamWritingInput = { ...EXAM_WRITING_TASK, letter };
      const startedAt = Date.now();
      const raw = await chatWith(model, buildExamWritingMessages(input), EXAM_WRITING_MAX_TOKENS, {
        temperature: 0.2,
        extras,
      });
      const ms = Date.now() - startedAt;
      writeFileSync(
        join(OUT_DIR, `${fixtureName}.json`),
        JSON.stringify({ input, ms, ...slimWithUsage(raw) }, null, 2),
      );
    }
  }

  console.log(`done → ${OUT_DIR}`);
}

void main();
