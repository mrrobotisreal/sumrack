# Authoring drafts for Сумрак (Sumrak)

**This document is self-contained.** If you are a Claude session asked to author a new story draft, everything you need is here: the draft file grammar, the annotation rules, the gotchas, and a complete worked example. You do not need the app, the design doc, or network access — only this doc and the `pipeline` CLI.

## What a draft is

A **draft** is one markdown file containing **one story**: its metadata, its sentences (Russian + English), and a full token-by-token annotation table for every sentence. The pipeline turns drafts into a validated `pack.json` — the content format the Sumrak app imports. The pipeline **never invents content**: every word's dictionary form and gloss must be authored by you, and any gap stops the build with a `file:line:` error.

A **pack** is the unit the app installs. A pack with several stories = several draft files (one per story) that share identical `pack:` frontmatter, passed to the CLI together in reading order.

## Running the pipeline

From the `Sumrak` repo root:

```bash
# draft(s) → pack.json (validated against the shared Zod schema before writing)
pnpm pipeline annotate path/to/story.draft.md -o path/to/pack.json

# multi-story pack: all drafts, in reading order
pnpm pipeline annotate s1.draft.md s2.draft.md s3.draft.md -o pack.json

# validate an existing pack.json independently
pnpm pipeline validate path/to/pack.json

# narration (T09; needs ELEVENLABS_API_KEY in the env or a gitignored .env at
# the repo root — the pipeline never prints the value). First audition:
pnpm pipeline audio s1.draft.md s2.draft.md -o packs/my-pack --audition 3
# …listen to packs/my-pack/audition/*.mp3, pick a seed per track, finalize:
pnpm pipeline audio s1.draft.md s2.draft.md -o packs/my-pack \
  --seed my-track-id=123456 --seed other-track-id=654321
# finalize writes audio/*.opus + pack.json (with word stamps) into the pack
# dir; a per-track stamp report (coverage %, monotonicity) prints per run.
# Iterate story-by-story with --stories / --tracks — pack.json merges.

# publish the finished pack dir into the content repo (commit; push is opt-in)
pnpm pipeline publish packs/my-pack --content ../sumrak-content --push
```

**Voice ids must resolve to a voice on the ElevenLabs account** — the resolver matches the alias before " - tagline" in the account's voice list. Copy the id from a recently published draft (e.g. `elevenlabs:Ivan` for creepy-whisper in pack 003 v2) rather than inventing one; a wrong id fails at the first render call. (T22: the worked example previously said `elevenlabs:Anton`, a fixture-era id.)

Audio notes: the `voice:` frontmatter drives rendering — `stylePrompt` is fed
to ElevenLabs as `previous_text` (write it in Russian, in the story's mood, as
if it were the narrator's preceding lines), `settings` maps to provider voice
settings (`stability`, `style`, `speed`, `similarityBoost`), and `deliveryNotes`
stay human-only. A track whose character alignment can't be trusted ships with
zero word stamps (the app falls back to sentence-level karaoke) — the report
says so; re-render with another seed rather than shipping bad stamps.
`pipeline publish` refuses same-version content changes: bump `pack.version`
in every draft of the pack instead.

`pnpm pipeline` runs at the repo root, so relative paths resolve from there. Exit codes: `0` success, `1` validation errors (all of them listed, `file:line: message`), `2` usage.

## Pack extras (course-unit / checkpoint / prompts packs — T17)

Non-story sections live in ONE extras markdown file per pack, passed with `--extras` to `annotate` and `audio`:

```markdown
---
pack: # OPTIONAL next to drafts (must equal their pack meta);
  id: a1-checkpoint-001 # REQUIRED when the pack has no story drafts
  version: 1 #   (checkpoint / prompts packs)
  type: checkpoint
  title: { ru: 'Контрольная A1 → A2', en: 'A1 → A2 Checkpoint' }
  level: A1
  tags: ['checkpoint']
lesson: # lesson META — its `body` is the markdown BELOW the fence
  id: unit-lesson
  title: { ru: 'Урок', en: 'Lesson' }
  grammarTopics: [prepositional-location]
prompts:
  - id: prompt-1
    level: A1
    prompt: { ru: 'Опишите вашу комнату.', en: 'Describe your room.' }
exercises: # authored ExerciseSpec[] (see packages/schema — 5 kinds:
  - id: ex-1 #   multiple-choice, cloze, sentence-builder, listening,
    kind: multiple-choice #   pronunciation)
    direction: ru-en
    prompt: 'дверь'
    choices: ['door', 'window']
    correctIndex: 0
---

## The lesson markdown body goes here (only when `lesson:` meta is present)
```

- A `course-unit` pack = story drafts **plus** `--extras` (schema requires the lesson). A `checkpoint`/`prompts` pack can be extras-only: `pnpm pipeline annotate --extras cp.extras.md -o pack.json`.
- The body below the fence **is** `lesson.body`; declaring `lesson:` with an empty body (or a body with no `lesson:`) is an error.
- Everything is NFC-normalized, ё preserved, and the merged pack is validated against the shared schema like any other.
- Unit quizzes are GENERATED by the app from the unit's stories — author `exercises:` only for checkpoints.

## Draft file grammar

A draft has two parts: **YAML frontmatter** between `---` fences, then **sentence blocks**.

### Frontmatter

```yaml
---
pack:
  id: a1-creepypasta-002 # stable kebab-case id, never renumbered
  version: 1 # integer ≥ 1; bump to update a published pack
  type: stories # stories | course-unit | checkpoint | prompts
  title: { ru: 'Фотография', en: 'The Photograph' }
  level: A1 # A1 | A2 | B1 | B2 | C1  (no C2)
  tags: ['creepypasta', 'horror', 'grammar:genitive']
story:
  id: the-photograph # unique within the pack
  title: { ru: 'Фотография', en: 'The Photograph' }
  level: A1 # may differ from the pack level
voice: # OPTIONAL — voice direction for narration (used by `pipeline audio`, T09)
  - id: photo-anton-creepy # audio track id this rendition will get
    voice: elevenlabs:Ivan # provider-prefixed voice id
    style: creepy-whisper # short style label
    stylePrompt: >- # prompt-style delivery description
      Slow, hushed, uneasy narration — a man describing something
      he does not want to believe.
    deliveryNotes: >- # free-form notes: pacing, pauses, emphasis
      Pause slightly before the last sentence.
---
```

Rules:

- `pack:` and `story:` are required; `voice:` is optional (add it when you already know how the story should be narrated — `annotate` validates its shape and otherwise ignores it).
- All ids are lowercase kebab-case (`[a-z0-9-]`), stable forever — never renumber or reuse.
- In a multi-story pack, every draft's `pack:` section must be **byte-identical** in meaning (same id, version, type, title, level, tags) or the pipeline refuses.

### Sentence blocks

After the frontmatter, the body is a sequence of sentence blocks:

```markdown
## photo-s01

RU: У меня есть старая фотография.
EN: I have an old photograph.
GRAMMAR: possession-u-genitive

| text       | lemma      | translation     | pos  | grammar                            | level | note |
| ---------- | ---------- | --------------- | ---- | ---------------------------------- | ----- | ---- |
| У          | у          | at (possession) | prep | + gen.; у меня есть = I have       | A1    |      |
| меня       | я          | me              | pron | gen.                               | A1    |      |
| есть       | есть       | there is        | pred | existential (у меня есть = I have) | A1    |      |
| старая     | старый     | old             | adj  | f.sg. nom.                         | A1    |      |
| фотография | фотография | photograph      | noun | f.sg. nom.                         | A1    |      |
| .          |            |                 |      |                                    |       |      |
```

Line by line:

- `## <sentence-id>` — starts a sentence. The id is **unique across the whole pack** (not just this story), because the app's user data references sentence ids pack-wide. Convention: a short story slug + counter, e.g. `photo-s01`, `photo-s02`, …
- `RU:` — the full Russian sentence, exactly as it should appear in the app. Single spaces only.
- `EN:` — the natural English translation (shown by the reader's "reveal" toggle). Translate the meaning, not word-by-word.
- `GRAMMAR:` — optional, comma-separated grammar topics this sentence exercises (`past-tense, genitive-plural`). Use kebab-case topic names consistently across stories; they feed the app's grammar-coverage tracking.
- The **token table** — one row per token, in sentence order. Header must be exactly `text | lemma | translation | pos | grammar | level | note`.

Also allowed in the body: blank lines, single-line HTML comments (`<!-- … -->`), and decorative `# Heading` lines (ignored). Anything else is an error — the parser never skips content silently.

### Token table columns

| Column        | Word tokens                                                                                                             | Punctuation tokens          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `text`        | **Required.** The surface form exactly as it appears in the sentence, capitalization included.                          | The punctuation mark itself |
| `lemma`       | **Required.** Dictionary form: nominative singular for nouns/adjectives, imperfective infinitive for verbs (see below). | Must be empty               |
| `translation` | **Required.** Context-appropriate English gloss of _this occurrence_ («дома» in "окно дома" → "of the house").          | Must be empty               |
| `pos`         | Recommended. `noun`, `verb`, `adj`, `adv`, `pron`, `prep`, `conj`, `part`, `pred`, `num`, `name`, `interj`.             | Must be empty               |
| `grammar`     | Recommended. Compact notes: `f.sg. nom.`, `1sg. pres. (impf.)`, `+ gen.`, `pf. of говорить`.                            | Must be empty               |
| `level`       | Recommended. CEFR level **of the lemma** (`A1`–`C1`), not of the surface form or the sentence.                          | Must be empty               |
| `note`        | Optional. Idiom/culture note shown in the word popup.                                                                   | Optional                    |

- **A token is punctuation automatically** when its `text` contains no letters or digits (`.`, `,`, `:`, `«`, `»`, `—`, `…`, `!`, `?`). You never mark it; you only leave its annotation cells empty. Hyphenated words like «кто-то» contain letters, so they are word tokens (keep them as **one** token).
- Missing `lemma` or `translation` on a word token is a **hard error with a line number** — by design the pipeline never auto-fills. `pos`/`grammar`/`level` may be omitted where they genuinely add nothing (e.g. particles), but fill them in as a rule; the app's progress model runs on `level`.
- An empty cell means "absent". To put a literal `|` inside a cell, write `\|`.

### The alignment rule (most important)

The `text` column, read top to bottom, must **reconstruct the RU: sentence exactly** — every character, in order, including punctuation. The pipeline walks the sentence as it reads your rows and fails (with the offending row's line number and a `⟨here⟩` marker showing where matching broke) if a token is missing, misspelled, misordered, or duplicated.

Spacing is **derived, not authored**: the pipeline sees where spaces sit in `RU:` and records the non-default cases (like «...» quotes hugging their content) automatically. You never write spacing flags — just make sure the `text` cells match the sentence.

Practical workflow: write the `RU:` sentence first, then split it into tokens mechanically — words and punctuation marks, left to right, nothing skipped, nothing merged (except hyphenated words, which stay whole).

## Gotchas

1. **ё is sacred.** Always write ё where Russian orthography has it («чёрный», «моём», «всё») — in `RU:`, in `text`, and in `lemma`. The pipeline preserves it exactly (it NFC-normalizes Unicode but never folds ё→е); the app handles ё/е-tolerant _matching_ on its own. Writing «черный» in a draft bakes the wrong form into content forever.
2. **Punctuation is its own row.** «Стук в стене.» is four tokens: `Стук`, `в`, `стене`, `.` — forgetting the final period row is the most common alignment error.
3. **Capitalization in `text`, lowercase in `lemma`.** Surface «У» keeps its capital; its lemma is «у». (Proper names keep their capital in the lemma too.)
4. **Lemma conventions**: verbs → imperfective infinitive as a rule, with the aspect noted in `grammar` (`1sg. pres. (impf.)`; for perfective forms use the perfective infinitive as lemma and note `pf. of <impf.>` in grammar). Nouns/adjectives → nominative singular (masculine for adjectives). Personal pronoun forms («меня», «ней», «его» _him_) → their nominative («я», «она», «он»); possessive «его/её/их» (_his/her/their_) → itself; declining possessives «мой/твой/наш/ваш» → masculine nominative singular («моём» → «мой»), tagged `pron`. Pronoun-adjectives («этот», «каждый», «весь», «такой») → masculine nominative singular, tagged `pron`, with adjective-style grammar notes (`m.sg. acc. (time expression)`). Numerals, cardinal and ordinal («девять», «десятом») → tagged `num`, lemma = nominative («девять», «десятый»); note case government on the governed noun's row (`m.pl. gen. (after 5+)`). Comparative «как» (_like_) → `conj`.
5. **Glosses are contextual.** `translation` is what the word means _here_, so «стоит» in «В окне стоит человек» is "stands", not "costs". Add the general sense to `note` if it helps.
6. **Sentence ids are pack-wide unique and permanent.** Prefix them with a story slug (`photo-s01`, `knock-s01`) so two stories in one pack can never collide.
7. **Single spaces only** in `RU:` — a double space is an alignment error. Use « » for quotes (not " "), — for dashes, … for ellipsis; they're all just punctuation tokens.
8. **The grammar column is reader-facing.** Keep the compact-abbreviation style (`f.sg. nom.`, `m.pl. gen.`, `3sg. pres.`) consistent with existing packs — it renders in the tap-word popup.

## Complete worked example

A valid two-sentence draft, start to finish:

```markdown
---
pack:
  id: a1-example-001
  version: 1
  type: stories
  title: { ru: 'Дверь', en: 'The Door' }
  level: A1
  tags: ['creepypasta', 'horror']
story:
  id: the-door
  title: { ru: 'Дверь', en: 'The Door' }
  level: A1
voice:
  - id: door-anton-creepy
    voice: elevenlabs:Anton
    style: creepy-whisper
    stylePrompt: >-
      Quiet, confessional dread. The narrator is trying to stay calm.
---

# Дверь — The Door

## door-s01

RU: В моей квартире есть дверь.
EN: In my apartment there is a door.
GRAMMAR: prepositional-case, existential-est

| text     | lemma    | translation | pos  | grammar            | level | note |
| -------- | -------- | ----------- | ---- | ------------------ | ----- | ---- |
| В        | в        | in          | prep | + prep. (location) | A1    |      |
| моей     | мой      | my          | pron | f.sg. prep.        | A1    |      |
| квартире | квартира | apartment   | noun | f.sg. prep.        | A1    |      |
| есть     | есть     | there is    | pred | existential        | A1    |      |
| дверь    | дверь    | a door      | noun | f.sg. nom.         | A1    |      |
| .        |          |             |      |                    |       |      |

## door-s02

RU: Мама говорит: «Её нет».
EN: Mom says: "It isn't there."
GRAMMAR: genitive-negation, direct-speech

| text    | lemma    | translation | pos  | grammar                | level | note                             |
| ------- | -------- | ----------- | ---- | ---------------------- | ----- | -------------------------------- |
| Мама    | мама     | mom         | noun | f.sg. nom.             | A1    |                                  |
| говорит | говорить | says        | verb | 3sg. pres. (impf.)     | A1    |                                  |
| :       |          |             |      |                        |       |                                  |
| «       |          |             |      |                        |       |                                  |
| Её      | она      | it          | pron | gen. (object of нет)   | A1    |                                  |
| нет     | нет      | is not      | pred | + gen. = there is no … | A1    | нет + genitive negates existence |
| »       |          |             |      |                        |       |                                  |
| .       |          |             |      |                        |       |                                  |
```

Run it:

```bash
pnpm pipeline annotate the-door.draft.md -o pack.json
# ✓ a1-example-001 v1 → pack.json
#   1 story, 2 sentences, 14 tokens — schema-valid
```

## Reference files

- `packages/pipeline/fixtures/the-photograph.draft.md` — the canonical full-length example: the T02 sample pack «Фотография» in draft form; `annotate` reproduces that pack exactly.
- `packages/pipeline/fixtures/broken/` — deliberately broken drafts showing the two big failure classes (missing lemma, misaligned table) and their error messages.
- `packages/schema/src/pack.ts` — the Zod schema every emitted pack must satisfy (the pipeline runs it for you).

## Content guidance for Sumrak stories

Target reader: an adult A1→C1 learner who loves Dark-Somnium-style creepypasta. For story packs:

- **A1**: 8–15 short sentences, present tense heavy, high-frequency vocabulary, one or two A2 words max per story (tag them honestly). Dread comes from implication, not complex syntax.
- Sentences should be **narratable**: they become ElevenLabs audio, so favor rhythm and natural speech over textbook stiffness.
- Reuse core vocabulary across a pack's stories (the app's FSRS engine feeds on repeated encounters in fresh contexts).
- Tag grammar topics honestly and consistently — they drive "what needs work" recommendations.
