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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAssessmentMessages } from '../src/features/ai/prompts/assessment';
import { buildEnrichmentMessages } from '../src/features/ai/prompts/enrichment';
import { buildExplainMessages } from '../src/features/ai/prompts/explain';
import { buildImportAnnotateMessages } from '../src/features/ai/prompts/import-annotate';
import { buildJournalFeedbackMessages } from '../src/features/ai/prompts/journal-feedback';

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

async function chat(messages: unknown, maxTokens: number): Promise<unknown> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function slim(raw: unknown): { model: string; content: string } {
  // Persist only the envelope slice the app consumes — no ids/usage/etc.
  const body = raw as { model?: string; choices: { message: { content: string } }[] };
  return { model: body.model ?? MODEL, content: body.choices[0]!.message.content };
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

  console.log(`done → ${OUT_DIR}`);
}

void main();
