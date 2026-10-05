# Authoring drafts for Сумрак (Sumrak)

**This document is self-contained.** If you are a Claude session asked to author a new story draft, everything you need is here: the draft file grammar, the annotation rules, the gotchas, and a complete worked example. You do not need the app, the design doc, or network access — only this doc and the `pipeline` CLI.

## What a draft is

A **draft** is one markdown file containing **one story**: its metadata, its sentences (Russian + English), and a full token-by-token annotation table for every sentence. The pipeline turns drafts into a validated `pack.json` — the content format the Sumrak app imports. The pipeline **never invents content**: every word's dictionary form and gloss must be authored by you, and any gap stops the build with a `file:line:` error.

A **pack** is the unit the app installs. A pack with several stories = several draft files (one per story) that share identical `pack:` frontmatter, passed to the CLI together in reading order.

Since T25 there is a second draft kind: **dialogue drafts** (one file = one branching dialogue) — see the [Dialogue drafts](#dialogue-drafts-dialoguemd--t25) section below. Everything in the story sections (sentence blocks, alignment, lemma conventions, gotchas) applies to dialogue lines unchanged.

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

**Voice ids must resolve to a voice on the ElevenLabs account** — the resolver matches the alias before " - tagline" in the account's voice list. Copy the id from a recently published draft rather than inventing one; a wrong id fails at the first render call (annotate only shape-checks it). Since ADR-0016 the default voice is **`elevenlabs:Mr. Wintrow`** (Mitch's professional clone on the new account, `professional`, id `HQ4Xi3gPf8Q6bJUlao6z`) — a direction that names a `register:` and no `voice:` renders with it. Character voices are cast per family in its `SERIES.md`; confirm against the account before an audio session (the old account's My-Voices library — `Anton`, `Ivan`, `Lunya - Little Fairy` … — is **not** on the new one; see `sentenceAudio` below for carrying such lines).

### Narration audio — the default path (Multilingual v2 · Mr. Wintrow · registers)

`pipeline audio` renders every story track with **`eleven_multilingual_v2` · `language_code: ru` · `elevenlabs:Mr. Wintrow` · `mp3_44100_192` · speaker boost on** unless a direction says otherwise (ADR-0016, 2026-09-20 — the CT011e re-voice made default). Multilingual v2 accepts `previous_text` (our `stylePrompt`) and continuous voice settings but has **no audio-tag channel**; expressiveness comes from the register preset, the `stylePrompt`, `settings`, and `contextCues` (next section).

A **register** is a preset that fills a direction's defaults — `voice`, `style` (the register slug, which the app shows as a Russian label), `settings` and `stylePrompt`. Name it in the `voice:` block and omit everything the preset already covers:

```yaml
voice:
  - id: nw001a1-wintrow-anchor
    register: anchor # narrator | anchor | lecturer | host | voiceover | guide
    deliveryNotes: >- # human-only, as before
      Evening-bulletin pace; each sentence is its own item.
```

| register    | `style` label in-app | default for `category` | `stability / similarityBoost / style / speed / useSpeakerBoost` | `stylePrompt` (sent as `previous_text`)                                                                                                 |
| ----------- | -------------------- | ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `narrator`  | Рассказчик           | `stories`              | `0.50 / 0.75 / 0.00 / 1.00 / true` (No End House §5.6, CT011e)  | «Я рассказываю эту историю медленно, тихо, будто вспоминаю то, чего не хотел бы помнить.»                                               |
| `anchor`    | Диктор               | `news`                 | `0.70 / 0.80 / 0.15 / 1.05 / true`                              | «Добрый вечер. В эфире вечерний выпуск новостей. Коротко о главном.»                                                                    |
| `lecturer`  | Лектор               | `education`, `torfl`   | `0.65 / 0.80 / 0.20 / 0.97 / true`                              | «Итак, продолжим лекцию. Сегодня мы разберём эту тему спокойно и по порядку. Обратите внимание на примеры.»                             |
| `host`      | Ведущий              | `podcast`              | `0.35 / 0.75 / 0.50 / 1.05 / true`                              | «Привет-привет! Вы слушаете наш подкаст. Устраивайтесь поудобнее — сегодня будет интересно, и я, честно говоря, сам не могу дождаться.» |
| `voiceover` | Закадровый голос     | `documentary`          | `0.60 / 0.80 / 0.25 / 0.95 / true`                              | «Здесь, вдали от городов, природа живёт по своим законам. Каждый год здесь повторяется одна и та же история.»                           |
| `guide`     | Гид                  | `travel`               | `0.40 / 0.75 / 0.45 / 1.02 / true`                              | «Смотрите, мы только что приехали, и я вам сейчас всё покажу. Это место — одно из моих любимых.»                                        |

Precedence (`packages/pipeline/src/registers.ts`, `applyRegister`):

1. An explicit `register:` applies its preset. **Anything authored in the block wins field by field** — `voice`, `style`, `stylePrompt` replace the preset's; `settings` **merge key-wise** (an authored `stability: 0.4` overrides only `stability`; the other four knobs still come from the preset). `model`, `language`, cues and everything else pass through untouched.
2. No `register:`, but the pack has a `category:` with a default register (table above) **and** the block omits `settings`, `stylePrompt` **and** `style` → the category's preset applies exactly as in 1. A block that carries any of those three is left **exactly as written** (every pre-M14 draft is such a block).
3. Otherwise the block is used as authored. Without a register, `voice` and `style` are **required**.

The resolved `voice`/`style` are what `pack.json`'s `AudioTrack` records and what the track id / audition file names use. `deliveryNotes` stay human-only. A family or anthology bible may pin tuned settings after audition, exactly as before — presets are starting points. Seeds, the audition → ear-check → finalize loop, and the per-request character-cap split rule are unchanged.

A track whose character alignment can't be trusted ships with zero word stamps (the app falls back to sentence-level karaoke) — the report says so; re-render with another seed rather than shipping bad stamps.

### Steering on v2: stylePrompt, contextCues, sentenceVoices, sentenceAudio

**`stylePrompt`** is fed to ElevenLabs as `previous_text` — write it in Russian, in the piece's register, as if it were the narrator's preceding lines (a register preset supplies one; author your own to replace it). **`settings`** maps to provider voice settings (`stability`, `similarityBoost`, `style`, `speed`, `useSpeakerBoost` — boost defaults on for untagged (v2) renders). A direction may pin its own **`model:`** (wins over the CLI `--model`) and **`language:`** (sent as `language_code`; defaults to `ru` on untagged models; never sent to v3 / v4).

**Context cues (No End House re-voice, 2026-09-19):** v2 has no audio tags, so per-sentence mood is steered with **`contextCues: { <sentence-id>: '<context text>' }`** — a short Russian stage direction («Я шепчу с ужасом:», or a news anchor's «А теперь — к погоде.») rendered immediately BEFORE the sentence and then **cut out of the audio** using the provider's character timestamps, with every later word stamp shifted back by the cut (a `{}` in the text stands for the sentence, so `'Он умоляет: {} — всхлипывает он.'` renders an attribution after the line and cuts that too). Context characters bill like any other; the listener never hears them; nothing reaches `pack.json`; an unknown id is an error. Works on any model.

**Per-sentence voice override (CT011):** `sentenceVoices: { <sentence-id>: 'elevenlabs:<other voice>' }` renders those sentences in a second voice — a child's line inside a first-person narration, a podcast guest. The story is rendered as consecutive same-voice runs (each its own provider request), the override runs are level-matched to the narrator runs' mean level (never boosted into clipping), the runs are concatenated sample-accurately, and every run's word stamps are offset by the runs before it so karaoke stays exact across each seam. The pack still carries **one** track per part; nothing about the override reaches `pack.json`. Override runs get no narrator `audioTag` (v3) and no `stylePrompt`. Works on v3 and non-v3 models alike. An id not in the story is an error. Per-request character caps apply per run.

**Pre-rendered clips:** `sentenceAudio: { <sentence-id>: <path relative to the draft> }` splices a pre-rendered clip in as that sentence's audio with no provider request (a character line from a voice this account no longer has, cut out of an earlier track); a sibling `<clip>.stamps.json` (`WordStamp[]` relative to the clip start) carries its word stamps, otherwise the run ships unstamped while the rest of the track stays stamped. Clips are level-matched and spliced exactly like `sentenceVoices`.

### Eleven v3 / v4 tags (audioTag / audioCues) — opt-in

Neither tagged model is the narration default. Opt in **per direction** with `model: eleven_v3` or `model: eleven_v4` in the `voice:` block (wins over the CLI flag) or **per run** with `--model eleven_v4`; a CT that wants it says why in its ticket. The pipeline's gate is `isTaggedModel` (`eleven_v3*` and `eleven_v4`; **`eleven_v4_turbo` is refused** — it is the realtime model). On a tagged model, `previous_text` is not sent (v3 rejects it; v4 accepts it but the tag is the steering channel — `stylePrompt` is ignored there), `language_code` is not sent, and speaker boost is not defaulted on; steering is the tag channel: `audioTag: '[whispers]'` — one or more `[bracketed]` v3 tags — is prepended once to the whole track, and **per-sentence cues (CT011 Tier 2)** `audioCues: { <sentence-id>: '[tags]' }` insert tags right before that sentence (after its paragraph break) for mid-track mood shifts — e.g. `audioCues: { nea1p9-s105: '[calm] [ominous]' }`. Both are **tagged-model-only** (on untagged models they are silently not applied — the plain text renders; not an error), **render-time only** (tag characters shift the token spans so word stamps stay exact and are never stamped themselves), and **never reach `pack.json`**. A cue keyed to a sentence id that is not in the story is an error regardless of model. Tag characters count toward the provider's per-request character cap. Every family voiced before 2026-09-19 was rendered this way; those records in the CT tickets and `SERIES.md` §5 tables stand as history (ADR-0016).

#### Eleven v4 — what the account probe proved (T64, 2026-09-28)

Ten `with-timestamps` requests on `eleven_v4` with one of Mitch's designed voices («Lietenant Gromov»); MP3s, `metrics.json`, `pause-floors.json`, Whisper transcripts and the `verdict.json` live in `Stories/_build/_v4-probe/`. Every scenario host renders on v4 from CT025 on (Mitch's rule); narration stays on Multilingual v2 (ADR-0016).

| Question                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `eleven_v4` on the with-timestamps endpoint | **Accepted**; character alignment returned and it echoes the input text exactly (tag included) — word stamps work as on v3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| (b) `seed`                                      | **Take-deterministic, not sample-deterministic** (same as v3): two renders at one seed = identical duration, identical alignment, identical byte length, different bytes. Pinned seeds reproduce the take for the audition → finalize handshake.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| (c) `language_code`                             | **Accepted** (v3 rejects it). The pipeline does not send it on v4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| (d) `previous_text`                             | **Accepted** (v3 rejects it). Not sent on v4 — the tag is the channel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| (e) Short emotion tag (7 words)                 | **Applied**: alignment span 0.08 s, transcript = the Russian line only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| (f) Long tag (18 words)                         | **Do not.** v4 did not read the tag aloud — it rendered the line **twice** (the tag span swallowed a whole first rendition, 14 s instead of 5). Keep tags ≤ ~8 words; more detail = 2–3 short comma-separated ideas, never a sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| (g) In-tag sound effect (`[a door slams]`)      | **Rendered**, inside the tag's own alignment span (0–0.72 s, the loudest part of the file); speech starts after it; stamps stay exact because tag characters are never stamped. Put the effect tag **first**, then the emotion tag.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| (h) Filters / noises / spaces / distances       | **Not on the API — neither as tags nor as a request field.** `[old radio]` and `[tunnel, far]` were inert (no band-limiting, no reverb, same pause floors); `[small room, near]` made the model voice a stray «Так» inside the tag; `[café noise]` was inconclusive at best. The OpenAPI body for the endpoint has no effects field (`text, model_id, language_code, voice_settings, seed, previous_text, next_text, previous/next_request_ids, pronunciation_dictionary_locators, apply_text_normalization, apply_language_text_normalization, use_pvc_as_ivc`); the only effects fields in the whole spec are Agents-side (`conversation_config.background_sound`, `audio_effects.background_noise_id`), and the Agents docs call the voice filter dashboard-only. The UI's controls are post-processing on ElevenLabs' side. |
| (i) `voice_settings`                            | All five fields **accepted** (200); `style`, `speed` and `use_speaker_boost` are **inert** on v4 (the take was byte-length-identical to the baseline — speed 0.95 would have lengthened it). v4 exposes stability + similarity only; send those when a line needs them, never the other three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**v4 tag rules (from the probe + Mitch's UI notes):** ≤ ~8 words per tag · comma-separated ideas, not sentences · vocal sounds (`[sighs]`, `[laughs]`, `[clears throat]`) and in-tag sound effects work — effect tag first, emotion tag second · never write production-control words (room / distance / filter / noise) into a tag · Whisper-scan every audition and every final (`leak-scan.py`) exactly as on v3.

**v4 production controls — the cheat-sheet (vocabulary + when).** The vocabulary Mitch saw in the UI: **filters** Old Radio · Robot · Cheap Microphone · Phone · Low Quality Phone · Bright Phone; **noises** (ambience) Call Center · Café · City · Keyboard; **spaces** (room) Small Room · Big Room · Hall · Tunnel · Street · Valley · Forest; **distances** Near · Medium · Far. Guidance for a production design: a space + a distance only when the scene has a room (a duty room, a shop counter); a noise only when the script's scene has that ambience; a filter only for a phone / radio / robot line; never stack more than one filter. **Because the API renders none of them, a design is authored as a per-line `production` note in the driver's `tags.json` (`{ "tag": "[…]", "production": "small room, near" }`, or an `_production` map) and written to `<host>-v4/production.sidecar.json` — it is never sent to ElevenLabs. Applying it is a local post-processing step (ffmpeg: band-pass for phone / old radio, `aecho` / convolution for a space, an ambience bed mixed under the line) — a decision for Mitch, recorded as OPEN in T64; until then the sidecar documents the intent and the tags + in-tag effects carry the scene.**

**Inline notation in source docs (CT013):** a story doc may carry its cue
script inline — an italic _Leading tag_ line per part (→ `audioTag`), `{Имя}`
at the start of a dialogue paragraph (→ `sentenceVoices` on the one block that
paragraph becomes), and `[tag]` immediately before a sentence (→ `audioCues` on
that sentence's id; a cue at the head of a multi-sentence paragraph keys to the
first sentence only). None of it is story content: drafts are authored from the
STRIPPED body, and a small converter (`Stories/_build/<pack>/cues-from-doc.py`,
modes `--strip` / `--rekey` / `--apply`) writes the `voice:` blocks by exact
sentence-text match, failing loudly on any mismatch. The reusable contract is
`sumrak-content/series/lost-shadow/SERIES.md` §2.1.

**Speech/narration split for inline-attributed dialogue (CT015):** when a
story's dialogue carries attribution and action _inside_ dash paragraphs
(«— Да? — Голос у Рейнольдса низкий, мягкий и спокойный. — Кто это?»), the
one-paragraph-one-block merge rule cannot express a second voice. Such a
family authors one block per VOICE SEGMENT instead: a dash paragraph splits at
every sentence-initial «— » that opens a new sentence with a capital letter;
each segment — a run of one character's pure speech, a narrator attribution
sentence, or a single sentence mixing speech and attribution («— Коннер, —
говорит наконец старик.», which is narrator) — is one `## id` block, so a
`{Имя}` marker can sit mid-paragraph and always maps to exactly one
`sentenceVoices` id. The converter emits the block split as
`stripped/part-N.blocks.txt` (one numbered block per line) and drafts are
authored to it verbatim. Very short character runs («— Да?») render fine on
`eleven_v3` but should be gated per run with ASR (a run that hallucinates on
two seeds folds back to the narrator by removing its marker). The contract is
`sumrak-content/series/roadwork/SERIES.md` §2.1 (additions 1–3).

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

### Theme & track (course units — T30)

Two more optional extras-frontmatter keys flow verbatim into the pack JSON:

```yaml
theme: # ambient room theme (V2 §5.2) — drives the house map (T30)
  scene: hallway #   and the ambient room scenes (T31)
  accent: '#C08A4A' # optional '#RRGGBB' scene accent
track: family # path track (V2 §6.1); OMIT for the main track
```

- **Known scenes** (the app's house set, §5.1 room order, top floor → cellar): `hallway`, `living-room`, `kitchen`, `pantry`, `nursery`, `cellar`. Units carrying one of these render as rooms of the house cross-section on the Путь tab. Any _other_ string is valid and forward-compatible — the unit simply renders with the default path presentation until an app update knows the scene.
- **Track naming**: kebab-case ids like story/pack ids. Omitted = the main track (`main` is applied app-side — never author `track: main`). The Alina arc uses `track: family`, which the app titles «Семья»; new tracks render with their raw id until the app learns a display name.
- Both keys are course-unit concerns today; the schema allows them on any pack type so future content shapes need no schema bump.

## Draft file grammar

A draft has two parts: **YAML frontmatter** between `---` fences, then **sentence blocks**.

### Frontmatter

```yaml
---
pack:
  id: a1-creepypasta-002 # stable kebab-case id, never renumbered
  version: 1 # integer ≥ 1; bump to update a published pack
  type: stories # stories | course-unit | checkpoint | prompts | dialogue | scenario | exam
  title: { ru: 'Фотография', en: 'The Photograph' }
  level: A1 # A1 | A2 | B1 | B2 | C1  (no C2)
  tags: ['creepypasta', 'horror', 'grammar:genitive']
  category: stories # OPTIONAL (M14): stories | news | education | podcast | documentary | travel | torfl (M18)
  genre: horror # OPTIONAL (M14): fiction genre — horror | mystery | scifi | fantasy | action |
  #   comedy | romance | drama | family | slice-of-life | absurd | fairy-tale
story:
  id: the-photograph # unique within the pack
  title: { ru: 'Фотография', en: 'The Photograph' }
  subtitle: { ru: 'Эпизод 1', en: 'Episode 1' } # OPTIONAL (M14): dek / tagline / lesson subtitle
  source: # OPTIONAL (M14): provenance — `name` at minimum
    name: 'Сумрак' #   publication / channel / author-as-publisher
    url: 'https://example.invalid/x' #   original URL when one exists
    publishedAt: '2026-09-14' #   ISO calendar date YYYY-MM-DD (news sorts newest-first on it)
    author: 'Мистер Уинтроу' #   byline
  level: A1 # may differ from the pack level
voice: # OPTIONAL — voice direction for narration (used by `pipeline audio`, T09)
  - id: photo-wintrow-narrator # audio track id this rendition will get
    register: narrator # M14 preset: fills voice (Mr. Wintrow), style, settings, stylePrompt
    stylePrompt: >- # OPTIONAL — replaces the preset's; sent as previous_text
      Медленно, тихо, с тревогой — как человек, который рассказывает о том,
      во что не хочет верить.
    deliveryNotes: >- # free-form notes: pacing, pauses, emphasis
      Pause slightly before the last sentence.
---
```

Rules:

- `pack:` and `story:` are required; `voice:` is optional (add it when you already know how the story should be narrated — `annotate` validates its shape and otherwise ignores it). A `voice:` block names either a `register:` or both `voice:` and `style:` (the pre-M14 form — see the narration section above).
- All ids are lowercase kebab-case (`[a-z0-9-]`), stable forever — never renumber or reuse.
- In a multi-story pack, every draft's `pack:` section must be **byte-identical** in meaning (same id, version, type, title, level, tags, category, genre) or the pipeline refuses.
- **`category` / `genre` (M14, `docs/design/LIBRARY_CATEGORIES.md` §2)** are plain kebab-case slugs the **app** classifies — unknown values are valid and render with their raw slug until the app learns them; `genre` only means something on the `stories` shelf and is never tied to `category` by the schema. `category` is per pack (every story in a pack sits on the same shelf). **Every new CT names `category` (+ `genre` for fiction) and `register`.** App-side defaults when absent: `stories` / `course-unit` packs → `stories` + `horror`; `dialogue` packs → `stories` with no genre; imported pastes always sit on their own «Импортировано» shelf.
- **`subtitle` / `source` (M14)** are per story: `subtitle` is the dek / episode tagline / lesson subtitle; `source` is provenance — `name` always (Mitch's own pieces: `name: 'Mitchell Wintrow'` or «Сумрак»), `publishedAt` for anything dated (it drives the news shelf's newest-first order), `url`/`author` when they exist. Fiction rungs normally carry neither.

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

| Column        | Word tokens                                                                                                                                                                                                                                                                                                         | Punctuation tokens          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `text`        | **Required.** The surface form exactly as it appears in the sentence, capitalization included.                                                                                                                                                                                                                      | The punctuation mark itself |
| `lemma`       | **Required.** Dictionary form: nominative singular for nouns/adjectives, imperfective infinitive for verbs (see below).                                                                                                                                                                                             | Must be empty               |
| `translation` | **Required.** Context-appropriate English gloss of _this occurrence_ («дома» in "окно дома" → "of the house").                                                                                                                                                                                                      | Must be empty               |
| `pos`         | Recommended. `noun`, `verb`, `adj`, `adv`, `pron`, `prep`, `conj`, `part`, `pred`, `num`, `name`, `interj`. `pred` covers impersonal predicatives («есть», «нет», «можно», «страшно» in «мне страшно»); a short-form adjective with an explicit subject stays `adj` with "short form" noted in `grammar` («я сыт»). | Must be empty               |
| `grammar`     | Recommended. Compact notes: `f.sg. nom.`, `1sg. pres. (impf.)`, `+ gen.`, `pf. of говорить`.                                                                                                                                                                                                                        | Must be empty               |
| `level`       | Recommended. CEFR level **of the lemma** (`A1`–`C1`), not of the surface form or the sentence.                                                                                                                                                                                                                      | Must be empty               |
| `note`        | Optional. Idiom/culture note shown in the word popup.                                                                                                                                                                                                                                                               | Optional                    |

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
4. **Lemma conventions**: verbs → imperfective infinitive as a rule, with the aspect noted in `grammar` (`1sg. pres. (impf.)`; for perfective forms use the perfective infinitive as lemma and note `pf. of <impf.>` in grammar). Nouns/adjectives → nominative singular (masculine for adjectives). Personal pronoun forms («меня», «ней», «его» _him_) → their nominative («я», «она», «он»); possessive «его/её/их» (_his/her/their_) → itself; declining possessives «мой/твой/наш/ваш» → masculine nominative singular («моём» → «мой»), tagged `pron`. Pronoun-adjectives («этот», «каждый», «весь», «такой») → masculine nominative singular, tagged `pron`, with adjective-style grammar notes (`m.sg. acc. (time expression)`). Numerals, cardinal and ordinal («девять», «десятом») → tagged `num`, lemma = nominative («девять», «десятый»); note case government on the governed noun's row (`m.pl. gen. (after 5+)`). Comparative «как» (_like_) → `conj`. Adverbs → the adverb itself, even when historically a frozen noun form («дома» _at home_ → «дома», not «дом»; «утром» _in the morning_ as an adverb → «утром»).
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
  - id: door-wintrow-narrator
    register: narrator
    deliveryNotes: >-
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

## Dialogue drafts (`*.dialogue.md` — T25)

A **dialogue draft** is one markdown file containing **one branching dialogue**: NPCs speak to the learner, the learner answers out loud, and on-device ASR picks the branch (the speak-your-choice simulator, design V2 §3). One dialogue = one draft file; a multi-dialogue pack is several files with identical `pack:` frontmatter. Story drafts and dialogue drafts can even share a pack — the pipeline tells them apart by the frontmatter (`dialogue:` section present), never by filename.

Everything you know from story drafts carries over unchanged: the sentence block (RU/EN/GRAMMAR + 7-column token table), the alignment rule, all the lemma conventions and gotchas above, NFC, ё. **Every line of a dialogue — NPC and player alike — is a fully annotated sentence**, tap-word explorable in the app like story text.

### Frontmatter

```yaml
---
pack:
  id: a2-dialogue-001
  version: 1
  type: dialogue # the pack type for dialogue packs
  title: { ru: 'Ужин у мамы', en: "Dinner at Mama's" }
  level: A2
  tags: ['dialogue', 'family']
dialogue:
  id: dinner-mini # unique within the pack
  title: { ru: 'Ужин у мамы', en: "Dinner at Mama's" }
  level: A2 # may differ from the pack level, like story.level
  startNodeId: din-n01 # OPTIONAL — defaults to the first scene block
characters:
  - id: mama # who can speak; ids are referenced by SPEAKER:
    name: { ru: 'Мама', en: 'Mama' }
    voice: elevenlabs:Mariia # provider-prefixed, like story voice ids
    style: warm
  - id: player # RESERVED id: the learner. Its voice/style name the
    name: { ru: 'Ты', en: 'You' } # neutral "coach" voice used for optional
    voice: elevenlabs:Ivan # model audio of player lines (T26)
    style: neutral
endings:
  - id: end-good # referenced by nodes' ENDING: lines
    title: { ru: 'Отличное впечатление', en: 'A great impression' }
    recap: { ru: 'Ты поел, и все довольны.', en: 'You ate, and everyone is pleased.' }
    tone: good # good | bad | strange
---
```

### Scene blocks

The body is a sequence of **scene blocks** — one per node of the graph. A linear node ends with `NEXT:`, a terminal node with `ENDING:` — each on its own line directly after the token table (blank lines around it are fine):

```markdown
## din-n01

SPEAKER: mama

RU: Проходи, дорогой!
EN: Come in, dear!

| text    | lemma     | translation | pos  | grammar                    | level | note |
| ------- | --------- | ----------- | ---- | -------------------------- | ----- | ---- |
| Проходи | проходить | come in     | verb | 2sg. imper. (impf.)        | A2    |      |
| ,       |           |             |      |                            |       |      |
| дорогой | дорогой   | dear        | adj  | m.sg. nom. (as an address) | A2    |      |
| !       |           |             |      |                            |       |      |

NEXT: din-n02
```

A terminal node is identical but closes with `ENDING: <ending-id>` instead (e.g. `ENDING: end-good`). A choice point closes with `CHOICES:` and its choice blocks:

```markdown
## din-n02

SPEAKER: mama

RU: Ты голодный?
EN: Are you hungry?

| text     | lemma    | translation | pos  | grammar         | level | note |
| -------- | -------- | ----------- | ---- | --------------- | ----- | ---- |
| Ты       | ты       | you         | pron | nom. (informal) | A1    |      |
| голодный | голодный | hungry      | adj  | m.sg. nom.      | A2    |      |
| ?        |          |             |      |                 |       |      |

CHOICES:

### din-n02-c1 -> din-n03

RU: Да, я очень голодный.
EN: Yes, I'm very hungry.

| text     | lemma    | translation | pos  | grammar    | level | note |
| -------- | -------- | ----------- | ---- | ---------- | ----- | ---- |
| Да       | да       | yes         | part |            | A1    |      |
| ,        |          |             |      |            |       |      |
| я        | я        | I           | pron | nom.       | A1    |      |
| очень    | очень    | very        | adv  |            | A1    |      |
| голодный | голодный | hungry      | adj  | m.sg. nom. | A2    |      |
| .        |          |             |      |            |       |      |

ALT: Да, очень.
HINT: Скажи, что ты голодный. | Say that you're hungry.
```

Block by block:

- `## <node-id>` — starts a node. One node = **one spoken sentence**. Node ids are kebab-case, unique, and **double as the sentence id**, so they share the pack-wide sentence-id namespace with story sentences and choice ids — prefix them with a dialogue slug (`din-n01`, `din-n02`, …).
- `SPEAKER: <characterId>` — who says this line; must be a `characters:` id. `SPEAKER: player` is allowed for a scripted (non-branching) player line.
- Then the standard sentence block: `RU:` / `EN:` / optional `GRAMMAR:` + the token table, exactly as in story drafts.
- Then **exactly one** of:
  - `NEXT: <node-id>` — linear continuation;
  - `ENDING: <ending-id>` — the dialogue finishes here with that ending;
  - `CHOICES:` — this is a **choice point**: the player answers this line out loud.

### Choices

Choices live **on the node being answered** (an NPC line, usually a question) — there are no separate player nodes; each choice IS the player's spoken line. After `CHOICES:`, write 2–4 choice blocks:

- `### <choice-id> -> <node-id>` — the choice id (convention: `<node-id>-c1`, `-c2`, …; it doubles as the choice's sentence id) and the node the story branches to.
- The player's line as a standard sentence block (RU/EN + token table — annotate it fully; choice cards are tap-word explorable too).
- `ALT: <alternate phrasing>` — optional, repeatable. Natural rephrasings the ASR matcher should also accept for this choice («Да, очень.» for «Да, я очень голодный.»). Write them as a speaker would actually say them; matching is case/punctuation/ё-tolerant on the app side.
- `HINT: <ru nudge> | <en nudge>` — optional, one line, both halves required (escape a literal `|` as `\|`). Shown on long-press when the learner is stuck.

No `SPEAKER:` in choices — choices always speak as `player`. A node with `CHOICES:` must **not** have `SPEAKER: player` (the player can't await their own answer).

### Graph rules (the pipeline enforces all of these)

- `startNodeId` and every `NEXT:` / `-> target` / `ENDING:` must resolve.
- Every node must be **reachable** from the start — an unreachable node is a dead branch and an error.
- Every ending must be referenced by at least one node, and at least one ending must be reachable.
- **Cycles are allowed** («Ещё борща?» can loop) — but every node on a cycle must still have a path to an ending. A cycle with no exit is a dead trap and an error.
- Bounds: ≤ 60 nodes per dialogue, 2–4 choices per choice point.

### The branch map

`annotate` and `validate` print a **branch map** for every dialogue — a tree of the graph with each line's RU preview, choice fan-out, `⇒ ending` markers, `↩` back-references for already-shown nodes, path-length stats, per-ending reachability, and warnings. Read it after every annotate run: it is the fastest way to see a dangling branch, a lopsided path, or an ending you forgot to wire. It is an authoring aid only — nothing parses it.

### Dialogue gotchas

1. **One sentence per node.** A node is one spoken line. If a character says two sentences, that's two nodes chained with `NEXT:` (each gets its own audio in T26).
2. **Ids are a single namespace.** Node ids and choice ids are sentence ids; they must be unique across the entire pack (stories included). Slug-prefix everything.
3. **Wire every ending.** Defining an ending in frontmatter is not enough — some node must `ENDING:` it, and it must be reachable.
4. **Give loops an exit.** If choices can circle back (great for pushy-mama dinner loops), make sure at least one choice leads onward.
5. **ALT lines are for natural variation**, not for wrong answers — every ALT should mean the same thing as the choice's RU. Branch-changing answers are separate choices.
6. Content guidance: keep choices clearly distinct from each other in _wording_ (the ASR matcher scores against each), and keep player lines speakable — short, natural, rhythmic.

### Dialogue audio (T26)

`pipeline audio` renders dialogues **per node**: every NPC line becomes its own small Opus file in that node's character voice, written to `audio/<dialogue-id>/<sentence-id>.opus` with its own word stamps (the ≥95 % aligner gate and monotonicity rules apply per node; an untrusted alignment ships that node with no stamps → sentence-level highlight).

- **Character steering**: give a character an optional `audioTag: '[warm]'` in the frontmatter (one or more `[bracketed]` Eleven v3 / v4 tags, same mechanics as a story track's `audioTag`) — it conditions delivery without being spoken. `style` stays a human label. Dialogue renders on the same default model as stories (Multilingual v2, `language_code ru` — ADR-0016), where tags are not applied; pass `--model eleven_v4` (or `eleven_v3`) for a run that needs them.
- **Audition & seeds group per (dialogue, character)** — not per node. `--audition N` renders N takes of ONE representative line per character (their longest), e.g. `dinner-mini--mama--take1--seed…mp3`; pick a take per character and finalize with `--seed dinner-mini/mama=<seed>`. Pinned seeds reproduce the same take (identical duration + word timing) across runs; the raw PCM is not bit-identical (v3 seeds are take-deterministic, not sample-deterministic).
- **`--player-audio`** additionally renders **coach audio** — every choice, plus any scripted `SPEAKER: player` line — in the reserved `player` character's voice ("hear how to say it", optional per V2 §3.2). Omit the flag and no coach files are rendered.
- **Cost gate**: every `audio` run first prints node/choice/request/character counts and asks to proceed; pass `--yes` for scripted runs. An unconfirmed run makes zero ElevenLabs calls.
- `--dialogues <id,id>` filters like `--stories`; pack.json merges across runs, so dialogues and stories of a mixed pack can be rendered in separate batches.

## Reference files

- `packages/pipeline/fixtures/the-photograph.draft.md` — the canonical full-length story example: the T02 sample pack «Фотография» in draft form; `annotate` reproduces that pack exactly.
- `packages/pipeline/fixtures/m14/` — the M14 category fixtures: `news-090-1/2.draft.md` (`category: news`, `register: anchor`, `subtitle` + `source` on each story → `a2-news-090`), `podcast-090.draft.md` (`podcast` / `host` → `a2-podcast-090`), `comedy-090.draft.md` (`stories` + `genre: comedy` / `narrator` → `a1-comedy-090`); `annotate` reproduces their `packages/schema/fixtures/packs/<id>/pack.json` byte-for-byte.
- `packages/pipeline/fixtures/the-dinner.dialogue.md` — the canonical dialogue example: the T25 fixture pack «Ужин у мамы» (11 nodes, 2 choice points, 3 endings, a legal loop) in draft form; `annotate` reproduces `packages/schema/fixtures/packs/a2-dialogue-001` exactly.
- `packages/pipeline/fixtures/radio-check.scenario.md` — the canonical scenario example: the T56 fixture pack «Проверка связи» (6 turns, a free slot with a reject reaction, a forms slot branching on `good`/`bad`/`default`, 15 glossary entries, 3 nudges, a placeholder host) in draft form; `annotate` reproduces `packages/schema/fixtures/packs/a1-scenario-fixture` exactly, and its coverage report flags exactly «отлично» and «эфир».
- `packages/pipeline/fixtures/exam-fixture/` — the canonical exam example (T67): story drafts `rd-01` (a 6-sentence reading text) and `ls-01` (a 5-line two-voice dialogue) + `mock.exam.md` (`a1-mock-fx`, all five subtests in the official order, a few items each — deliberately not official-shape, so `validate` prints six `⚠ official-shape:` lines) + `drill.exam.md` (`a1-drill-fx`, a lexgram drill with `explain` and one `typed`/`half` item); `annotate exam-fixture/*.md` reproduces `packages/schema/fixtures/packs/a1-exam-fixture` exactly.
- `packages/pipeline/fixtures/broken/` — deliberately broken drafts showing the big failure classes (missing lemma, misaligned table, dead branch, trap cycle, dangling references; for scenarios: a dangling `on` target, `EXPECT:` without `RETRY:`, `branchOn` on a free slot, plus two broken `pack.json`s — half-voiced and mouth-track mismatch; for exams (`exam-*`, annotate them with `exam-fixture/rd-01` + `ls-01`): a dangling `storyId`, a non-contiguous span, Σ points ≠ `maxPoints`, `answer` out of range, a speaking item in a reading subtest, a monologue group of 3, a bullet cue with punctuation, and the half-voiced `exam-half-voiced.pack.json`) and their error messages.
- `packages/schema/src/pack.ts` + `packages/schema/src/dialogue.ts` (+ `scenario.ts`, `exam.ts`) — the Zod schemas every emitted pack must satisfy (the pipeline runs them for you).

## Content guidance for Sumrak stories

Target reader: an adult A1→C1 learner who loves Dark-Somnium-style creepypasta. For story packs:

- **A1**: 8–15 short sentences, present tense heavy, high-frequency vocabulary, one or two A2 words max per story (tag them honestly). Dread comes from implication, not complex syntax.
- Sentences should be **narratable**: they become ElevenLabs audio, so favor rhythm and natural speech over textbook stiffness.
- Reuse core vocabulary across a pack's stories (the app's FSRS engine feeds on repeated encounters in fresh contexts).
- Tag grammar topics honestly and consistently — they drive "what needs work" recommendations.

### Non-fiction registers (M14)

The news, education, podcast, documentary and travel shelves are fed by the same CT flow (source → Claude adaptation to the target rung → draft with a full token table → `annotate` → `audio` → `publish`); each item is a **story in a story pack** with `category:` on the pack, `register:` on its direction, `source:` on the story (`name` at minimum, `publishedAt` for anything dated) and `subtitle:` when the source has a dek. Style rules per shelf:

- **news** (`register: anchor`): short declarative sentences; the lede first (who / what / where in sentence one); dateline facts — places, dates, numbers; past tense for events, present for standing facts; no first person; `contextCues` for item breaks («А теперь — к погоде.»).
- **education** (`register: lecturer`): definitions via «X — это Y» (tag `zero-copula`, the «это» row as the gloss marker) followed by **one worked example per concept**; imperative address to the learner — «обратите внимание», «сравните», «запомните»; numbered steps where order matters.
- **podcast** (`register: host`): conversational particles and fillers — «ну», «кстати», «знаете», «честно говоря»; rhetorical questions the host then answers; direct address («напишите мне», «вы»); a guest speaks through `sentenceVoices` on their lines (a casting decision recorded in the anthology bible).
- **documentary** (`register: voiceover`): measured third person; numbers, dates and measurements stated plainly; place names in full — a multi-word place name is one `name` token per word (the roadwork bible's «Северная Каролина» rule), and a river / range / city keeps its capital in the lemma.
- **travel** (`register: guide`): second person «вы» throughout; imperatives — «посмотрите», «поверните», «попробуйте»; sensory adjectives (light, smell, sound, texture); the guide's own opinion is allowed («одно из моих любимых»).

**News drafts in practice (CT019, the first `category: news` pack):** a news article arrives as an editorially final `ARTICLE.md` whose `## Текст / Body` carries `[…]` lines of free Russian stage direction («Диктор объявляет новый сюжет:») immediately before a paragraph or a `###` heading; a scratch converter (`Stories/_build/a2-news-001/cues-from-doc.py --cue-kind context`, modes `--strip` / `--rekey` / `--apply` / `--table`) strips them into `stripped/item-NN.txt` (the pack text, byte for byte — headings become plain sentence blocks with no terminal period) and re-keys each to the FIRST sentence of its paragraph as a `contextCues` entry, so the `voice:` block carries only `id` / `register: anchor` / `deliveryNotes` / `contextCues`. **Ukrainian proper names are written in Ukrainian orthography inside the Russian text** («Київ», «Володимир Зеленський», «Крим»), indeclinable, `name` rows with lemma = surface, no level, and are **sent to ElevenLabs exactly as written** (never transliterated for the voice); the ASR-WER gate excludes those tokens. Any scratch script with a `[а-я]` word regex must be widened to `[а-яёіїєґ]` or those names vanish from its counts. The reusable contract is `sumrak-content/series/news/SERIES.md` §1 (the naming canon) and §2.1 (the converter).

**Anthology packs grow by appending** (the SAR-stories rule, `sumrak-content/series/sar-stories/SERIES.md` §2; `LIBRARY_CATEGORIES.md` §6): one open-ended pack per shelf and rung — `a2-news-001`, `a2-edu-001`, `a2-podcast-001`, `a2-doc-001`, `a2-travel-001` (the level prefix follows the rung; a second rung is a new pack id). New items are new drafts appended **after** the existing ones at a `pack.version` bump; old items are never reordered, re-ided or re-rendered; one build dir per pack forever so every earlier opus is carried.

## Scenario drafts (`*.scenario.md` — M17, T56)

A **scenario draft** is one markdown file containing **one blind speaking scenario** («Сценарии», design `docs/design/SPEAKING_SCENARIOS.md` §2 at the workspace root): a host talks to the learner, the learner answers **out loud with no text on screen**, and an offline judge scores the answer against an authored **expectation**. One scenario = one draft file (`type: scenario` pack); the pipeline recognizes it by the `scenario:` frontmatter section, never by filename. Story, dialogue and scenario drafts may share a pack.

Everything from story and dialogue drafts carries over unchanged: the sentence block (RU/EN/GRAMMAR + 7-column token table), the alignment rule, the lemma conventions, NFC, ё. **Every line the cast can speak is a fully annotated sentence** — host lines, the confused/hint/second retry lines, reject reactions, glossary clips and nudges — because T57 renders each of them as its own audio file and the debrief makes them tap-word explorable.

### Frontmatter

Five top-level keys, **all five required**: `pack:`, `scenario:`, `characters:` (≥ 2: the host + `player`), `scene:` and `endings:` (≥ 1). Inside `scene:` every field is optional, but the block itself must exist — the minimal legal form is `scene: { layout: center }` (or an empty `scene: {}`).

```yaml
---
pack:
  id: a1-scn-radio-001
  version: 1
  type: scenario # the pack type for scenario packs
  title: { ru: 'Проверка связи', en: 'Sound Check' }
  level: A1
  tags: ['scenario', 'radio']
scenario:
  id: radio-a1 # unique within the pack; prefixes every generated sentence id
  familyId: radio # the situation shared by the A1/A2/… rungs
  title: { ru: 'Проверка связи', en: 'Sound Check' }
  level: A1
  language: ru # OPTIONAL, ru | uk (default ru)
  brief:
    { ru: 'Короткая проверка связи перед эфиром.', en: 'A short sound check before going on air.' }
  startTurnId: radio-a1-t01 # OPTIONAL — defaults to the first turn block
characters:
  - id: host # exactly ONE character has role: host — the one drawn on screen
    name: { ru: 'Ведущий', en: 'Host' }
    voice: elevenlabs:Daniel # a library voice on the account — never Mr. Wintrow (ADR-0019 decision 6)
    style: radio-host
    role: host # host | npc | player
    portrait: # OPTIONAL art; see below
      placeholder: { kind: man, hue: 25 } # man | woman | youth | elder — the app draws a stand-in
    cues: # OPTIONAL, render-time only (T57): steering for the retry variants
      confused: 'Извини, я не совсем понял. Ты можешь повторить?'
      hint: 'Warmer and slower — the host is helping, not testing.'
  - id: player # RESERVED: the learner, role: player, required; never speaks a scripted line
    name: { ru: 'Вы', en: 'You' }
    voice: elevenlabs:River # the coach voice for accept[0] model answers (T57 --player-audio)
    style: neutral
    role: player
scene: # REQUIRED block; every field inside it is optional
  bed: studio # OPTIONAL room-tone slug (the app owns the known set)
  layout: center # center | left | desk (default center)
  accent: '#c26a3a' # OPTIONAL hex
  # backdrop: scene/backdrop.png   OPTIONAL PNG, 1080×1920
endings:
  - id: end-ok # referenced by turns' ENDING: lines
    title: { ru: 'Связь есть', en: 'Connected' }
    recap: { ru: 'Проверка пройдена.', en: 'Sound check passed.' }
    tone: good # good | bad | strange
---
```

**Portraits.** A character either has `placeholder` (no PNGs needed — this is how every fixture and every pre-art rung ships) or real layers: `body: scene/<id>/body.png` (mouth closed, eyes open), optional `eyelids: scene/<id>/eyelids.png`, and a required `mouthAnchor: { x, y, w, h, rotate? }` in **fractions of the body image** where the SVG mouth is drawn, plus `mouthStyle: default | wide | small | beard`. `body` + `mouthAnchor` are required unless `placeholder` is set. `cues` never reach `pack.json`; they are read from the draft by `pipeline audio` (T57).

### Turn blocks

The body is a sequence of **turn blocks** — one per node of the graph. A turn is 1–3 spoken lines; a **monologue turn** just talks and moves on; a **prompting turn** ends in a question, carries `EXPECT:` + `RETRY:`, and waits for the learner:

```markdown
## radio-a1-t02

SPEAKER: host

SAY:

RU: Отлично.
EN: Great.

| text    | lemma   | translation | pos | grammar     | level | note |
| ------- | ------- | ----------- | --- | ----------- | ----- | ---- |
| Отлично | отлично | great       | adv | predicative | A2    |      |
| .       |         |             |     |             |       |      |

SAY:

RU: Как вас зовут?
EN: What's your name?

| text  | lemma | translation | pos  | grammar                                 | level | note |
| ----- | ----- | ----------- | ---- | --------------------------------------- | ----- | ---- |
| Как   | как   | how         | adv  | interrogative                           | A1    |      |
| вас   | вы    | you         | pron | acc.                                    | A1    |      |
| зовут | звать | (they) call | verb | 3pl. pres. (impf., indefinite-personal) | A1    |      |
| ?     |       |             |      |                                         |       |      |

EXPECT:
slot name required free minTokens=1
accept: Меня зовут Митч. | Я Митч.
reject: хорошо, спасибо -> REACT:

RU: Нет, имя.
EN: No, your name.

| text | lemma | translation | pos  | grammar    | level | note |
| ---- | ----- | ----------- | ---- | ---------- | ----- | ---- |
| Нет  | нет   | no          | part |            | A1    |      |
| ,    |       |             |      |            |       |      |
| имя  | имя   | name        | noun | n.sg. nom. | A1    |      |
| .    |       |             |      |            |       |      |

RETRY:
CONFUSED:

RU: Не расслышал.
EN: Didn't catch that.

| text      | lemma      | translation            | pos  | grammar          | level | note |
| --------- | ---------- | ---------------------- | ---- | ---------------- | ----- | ---- |
| Не        | не         | not                    | part | negation         | A1    |      |
| расслышал | расслышать | caught (heard clearly) | verb | m.sg. past (pf.) | B1    |      |
| .         |            |                        |      |                  |       |      |

HINT:

RU: Скажите: «Меня зовут…».
EN: Say: "My name is…".

| … full token table … |

SECOND:

RU: Например: «Меня зовут Митч».
EN: For example: "My name is Mitch."

| … full token table … |

LIFELINE: «Меня зовут …». | "Меня зовут …" (My name is …).

NEXT: radio-a1-t03
```

Line by line:

- `## <turn-id>` — starts a turn. Kebab-case, unique; convention `<scenario>-t<NN>` with a letter suffix for branch targets (`radio-a1-t04g`, `-t04b`, `-t04d`). **The turn id is the sentence id of its LAST `SAY:` line**; earlier lines are `<turn-id>-a`, `<turn-id>-b`. All of these share the pack-wide sentence-id namespace.
- `SPEAKER: <characterId>` — a `characters:` id; **never `player`**.
- `SAY:` — opens one sentence block (RU/EN/GRAMMAR + token table). Repeat 1–3 times. When the turn has `EXPECT:`, the last `SAY:` is **the prompt**: it is what replays after every retry line.
- `EXPECT:` — makes this a prompting turn. Its indented sub-lines (indentation is cosmetic; the keywords are what count):
  - `slot <id> <required|optional> forms: key=lemma: form, form* | key=lemma: … | number` — a **forms slot**: each option is a branch **key**, the dictionary **lemma** (for FSRS grading), and the accepted **surface forms**; a trailing `*` on a form is a stem glob («голов*»). The parser splits `key=` … at the **first `:`**, so a lemma may contain spaces (`f95=девяносто пятый: девяносто пятый, 95`). A bare `| number` at the end means a numeral also satisfies the slot, with branch key `number`.
  - `slot <id> <required|optional> free [minTokens=N] [cues="зовут, я …"]` — a **free slot**: anything with ≥ N content tokens (stopwords never count); `cues` = phrases at least one of which must appear.
  - `slot <id> <required|optional> number` — a **numeral slot** (1–100 words or digits); its only branch key is `number`.
  - `accept: <paraphrase> | <paraphrase>` — whole-utterance paraphrases; **the first one is the model answer** (debrief + coach audio). Required.
  - `branchOn: <slot-id>` — which slot's matched key drives `NEXT: on …`. Required when the turn branches; must name a forms or number slot (never a free one).
  - `reject: <form>, <form> [-> REACT:]` — a group of **confusables**: forms that mean the answer was the wrong speech act («спасибо» when a name was asked). With `-> REACT:` a sentence block follows: the targeted line played instead of the generic confused line. Up to 4 groups.
- `RETRY:` — required iff `EXPECT:` is present, and inside it **`CONFUSED:`, `HINT:` and `LIFELINE:` are all required**; only `SECOND:` is optional. `CONFUSED:` (miss #1) and `HINT:` (miss #2+) each open a sentence block; `SECOND:` (miss #3+) usually speaks the model answer; `LIFELINE: <ru> | <en>` is the text shown on tap after the second miss (both halves required; escape a literal `|` as `\|`). Their sentence ids are `<turn-id>-conf`, `-hint`, `-sec`; a reaction is `<turn-id>-react` (`-react-2`, … for further groups).
- Then **exactly one** of:
  - `NEXT: <turn-id>` — linear;
  - `NEXT: on good=<turn-id> bad=<turn-id> default=<turn-id>` — **branch by slot key**: ≤ 4 keys, each an option key of the `branchOn` slot (or `number`), plus the mandatory `default` taken when no key matched (or the turn was skipped). Several keys (and `default`) may point at the same turn — a branch point does not need distinct downstream turns;
  - `ENDING: <ending-id>`.

### Glossary

After the turns, a `## glossary` section holds the «Что значит X?» / «Как сказать X?» material — one `###` block per entry:

```markdown
## glossary

### связь | connection | forms: связь, связи, связ* | translit: конекшн, канекшен

EXPLAIN:

RU: Связь — это connection.
EN: «Связь» means connection.

| text       | lemma      | translation | pos     | grammar                      | level | note |
| ---------- | ---------- | ----------- | ------- | ---------------------------- | ----- | ---- |
| Связь      | связь      | connection  | noun    | f.sg. nom.                   | B1    |      |
| —          |            |             |         |                              |       |      |
| это        | это        | is          | pron    | demonstrative (gloss marker) | A1    |      |
| connection | connection | connection  | foreign | English                      |       |      |
| .          |            |             |         |                              |       |      |

HOWTOSAY:

RU: Connection — по-русски «связь».
EN: Connection is «связь» in Russian.

| … full token table … |
```

- Heading: `### <ru headword> | <english> | forms: <form>, <form*> [| translit: <cyrillic>, …] [| id: <slug>]`. `forms` are the surface forms/globs the learner might say when asking «что значит …». `translit` (optional) are **hand-written extras** — how the Russian ASR hears the English word; the pipeline **generates** candidates from the English automatically (`translit.ts`) and merges yours first. `id:` overrides the entry slug, which otherwise comes from the English (`to hear` → `to-hear`).
- Entry id = `<scenario>-gl-<slug>`; the clips are `<entry-id>-ex` (EXPLAIN) and `<entry-id>-how` (HOWTOSAY). Both blocks are required, both spoken by the host.
- The English words inside the clips are ordinary word tokens: `pos: foreign`, lemma = the word, no level, `grammar: English`. Russian «по-русски» is an adverb.

### Nudges

A `## nudges` section with **exactly three** blocks — the host's service lines the engine needs at any turn:

```markdown
## nudges

### silence

RU: Вы там?
EN: Are you there?

| … token table … |

### which-word

…

### dont-know

…
```

`### silence` (25 s of nothing), `### which-word` («что значит …» found nothing), `### dont-know` («как сказать …» found nothing). An optional `SPEAKER:` line names another cast member; the default is the host. Sentence ids: `<scenario>-nudge-<kind>`.

### Graph rules (the pipeline enforces all of these)

- Exactly one `role: host`; the reserved `player` with `role: player`; every `SPEAKER:` resolves and is never `player`.
- `EXPECT:` ⇔ `RETRY:`; exactly one of `NEXT:` / `ENDING:`.
- `NEXT: on …` needs `branchOn:`; every key must be an option key of that slot (`number` for numeral slots and `| number` forms slots); ≤ 4 keys; `default` is mandatory.
- `startTurnId`, every `NEXT:` target (linear, `on`, `default`) and every `ENDING:` must resolve; every turn reachable; every ending referenced; **no dead traps** (cycles are allowed when they keep an exit — the same `analyzeDialogueGraph` as dialogues, through the `scenarioGraphInput` adapter).
- Slot forms: NFC, no punctuation, a glob is one trailing `*`; option keys unique per slot; slot ids unique per turn; glossary ids and headwords unique.
- Bounds: ≤ 40 turns, 1–3 `SAY:` per turn, 1–6 slots per expectation, ≤ 180 glossary entries (120 → 180 in T64, 2026-09-28).
- Audio is all-or-nothing per scenario (T57 renders every line kind at once).

### The branch map and the coverage report

`annotate` and `validate` print a **branch map** for every scenario — the turn tree with the prompt's RU preview, an **expect column** (`[name: free≥1 ✗1]` = one free slot, one reject group; `[mood: good|bad|ok ⇢mood]` = a forms slot with its branch keys, branching on it; `[monologue]`), the `on` edges labelled `mood: good → radio-a1-t04g` and the `default` edge, `⇒ ending` markers, path stats and warnings.

They also print the **glossary coverage report**: every **content lemma the cast says** (turn lines, retry lines, reactions, nudges — glossary clips themselves are not scanned) that no glossary entry covers, with counts and the sentences it occurs in. Content = tokens whose `pos` is `noun`, `verb`, `adj` or `adv`, minus the judge's stopword list (§5.1 `STOP_RU`: «как», «так», «там», «тут», «очень», «спасибо», «пожалуйста», …); `num`, `name` and all function POS never count. A lemma is covered when it equals an entry's headword or one of its `forms` (exact or glob prefix — `forms: зовут, звать` covers the lemma «звать»). **The CT rule is: cover every content lemma the host says**, plus the family's «likely how-to-say» English list from the scripts file — the report is your checklist; it is informational, never a failure.

### Scenario gotchas

1. **The last `SAY:` is the prompt.** Put the question last; the confused/hint lines are followed by that line automatically, so they must never re-ask it themselves.
2. **Ids are one namespace.** `<turn>-a/-b`, `-conf/-hint/-sec`, `-react`, `<scn>-gl-<slug>-ex/-how`, `<scn>-nudge-<kind>` all collide with story and dialogue sentence ids; prefix turn ids with the scenario slug.
3. **`key=lemma: forms`** — the lemma comes before the first colon; forms after it; the whole option ends at the next `|`. A `|` inside a form is not possible (forms are punctuation-free anyway).
4. **`default` is not optional** on a branching `NEXT:` — it is where a skipped turn goes.
5. **Free slots cannot branch.** Branch on a forms or number slot; keep the free slot for names and open answers.
6. **Reject groups are for wrong speech acts**, never for wrong facts (a «спасибо» when a name was asked; not a wrong name).
7. **Confused lines never contain the answer; the hint contains a `Скажите: «…»` pattern; `SECOND:` IS the model answer** (rung rules, scripts file Appendix C).
8. **Every content lemma the host says goes in the glossary** — read the coverage report after every annotate run; the two the fixture leaves out («отлично», «эфир») are there on purpose so the report always has something to show.
9. **`cues:` on a character are render-time only.** They never appear in `pack.json`; T57's `pipeline audio` reads them from the draft.
10. Indentation under `EXPECT:` / `RETRY:` is cosmetic; a sentence block after `REACT:`/`CONFUSED:`/… starts at column 0 like every other block.

### Scenario audio (T57)

> **Scenario host voices — the six fixed voice IDs (Mitch, 2026-10-04).** The six «Сценарии» hosts render ONLY from these ElevenLabs voice ids, no exceptions: Кирилл `8dhAblFTpeeEB1XoNWkd` · Елена Сергеевна `24cpwcP86kWKZVm5xL51` · Оксана `jbdzge6XKKuimi00dJwg` · Витя `KZH0fz8sc0VdgvPJ9sYb` · лейтенант Громов `KCHQFvRLLOBtTYbW6N09` · Незнакомец `ArHXzPPSKFNaYrb6JndW`. Write the raw id into the draft (`voice: 'elevenlabs:8dhAblFTpeeEB1XoNWkd'` — `resolveVoiceId` passes a 20-character id through untouched) rather than the voice's display name: the account keeps retired look-alike designs under similar names, and a name lookup could silently re-cast a host. The per-family drivers `packages/pipeline/_<host>-v4-render.mts` (and `_<host>-a2-v4-render.mts`) pin the same ids. The coach stays `River` on Multilingual v2. Roster + history: `sumrak-content/series/scenarios/SCENARIOS.md` §2.

`pipeline audio` renders a scenario **per line** on Multilingual v2 — every `SAY:`, `CONFUSED:`/`HINT:`/`SECOND:`, `REACT:`, glossary `EXPLAIN:`/`HOWTOSAY:` and nudge becomes its own Opus file in the speaking character's library voice at `audio/<scenario-id>/<sentence-id>.opus`, with word stamps (the ≥95 % aligner gate + monotonicity per line; an untrusted alignment ships that line with no stamps) and a **mouth track** written into the line's `audio.mouth`. The per-line core (`line-audio.ts`) is the one dialogues use; scenarios add the variant steering and the mouth track.

- **Variants and steering.** v2 has no audio tags, so the retry registers are steered by `previous_text` + settings deltas, per SPEAKING_SCENARIOS §3: a `CONFUSED:` line is rendered with the character's `cues.confused` as `previous_text` and **stability −0.1 / style +0.1**; a `HINT:` line with `cues.hint` and **speed 0.95**; every other line (`SAY:`, `SECOND:`, `REACT:`, glossary clips, nudges, coach) renders with the base settings (stability 0.5 · similarity 0.75 · style 0 · speaker boost) and no `previous_text`. When a character has no `cues:` the defaults apply (confused = «Извини, я не совсем понял. Ты можешь повторить?», hint = «Ничего, не спеши. Я помогу — давай ещё раз, медленно.»). The cue text is _conditioning_, never rendered, so it can be Russian or an English stage direction. **What v2 steering actually buys is small**: on the fixture the same text at the same seed came out ~0.2 s longer and ~0.5–1 dB softer as `confused`/`hint` than as plain `say` (`Stories/_build/a1-scenario-fixture/audition/ab/`) — a slower, softer take, not a different emotion. Write the confused/hint _text_ to carry the register; the steering only nudges delivery.
- **Audition & seeds group per (scenario, character)** — `--audition N` renders N takes of the character's **longest line** _and_, when the character has confused lines, N takes of their **longest confused line** (the steering is what the audition decides), e.g. `radio-a1--host--confused--take1--seed…mp3`. Pin with `--seed radio-a1/host=<seed>`; the whole cast of that scenario then renders with that seed.
- **`--player-audio`** additionally renders **coach audio**: `accept[0]` of every `EXPECT:` (the debrief's model answer) in the reserved `player` character's voice — an Ivan/River-class library voice, **never `Mr. Wintrow`** (ADR-0019 decision 6). Coach lines are free text (no annotated sentence), so they ship as `audio/<scenario-id>/<turn-id>-coach.opus` on `turns[].expect.coachAudio` with a duration and a mouth track but **no word stamps**. Omit the flag and no coach files exist; a later filtered run carries existing ones over.
- **`--scenarios <id,id>`** filters like `--dialogues`; `pack.json` merges across runs (lines and coach files already on disk are carried over), so a mixed pack's stories, dialogues and scenarios can be rendered in separate batches.
- **Mouth track** (`mouth-track.ts`, pure): the Opus is decoded to PCM, RMS per 40 ms → dBFS → viseme by the ladder `< −42` → 0 · `< −32` → 1 · `< −24` → 2 · `< −17` → 3 · else 4, with ±2 dB hysteresis so lips don't flicker; when the line's stamps are trusted every window outside a word stamp is forced to `0` (breaths and room tone never move the mouth); the **round rule** encodes windows inside a word whose _first vowel_ is о/у/ю/ё as `4` — the app draws `4` round for such words and wide otherwise (§8.2; stress is ignored on purpose). Track length is fixed from `durationMs` (`ceil(ms / 40)`), never from the sample count.
- **`--mouth-only`** recomputes every mouth track of an already-rendered `<pack-dir>/pack.json` from the Opus files on disk and rewrites `pack.json` — drafts optional, **zero ElevenLabs calls** — for tuning the ladder; it is idempotent on an unchanged ladder (the fixture reproduces byte-identical).
- **Cost gate**: every run prints `N scenario line(s), M scenario coach render(s) — R ElevenLabs request(s), ~C characters` and asks to proceed; `--yes` for scripted runs; an unconfirmed run makes zero calls. **Cost expectations** (fixture «Проверка связи», 54 lines + 2 coach, 1,115 chars): the 2-take audition = 6 requests / 150 chars in 12 s; the full finalize = 56 requests / 1,115 chars in 89 s → 90 s of audio, 444 KB of Opus. A real A1 rung (~120 lines, ~3,000 chars) is therefore ≈ 3 min and ≈ 3 k characters of the plan.
- **`scene/` ships wholesale.** `publish` copies `pack.json`, every line/coach `audio/…opus`, and **every file under `<pack-dir>/scene/`** (any depth, dotfiles skipped) — the PNG layers the portraits/backdrop reference. The size line reports `scene/` separately («of which scene/ 4.68 MB (Wi-Fi-gated PNG layers)»): the app's sync gate treats `scene/` + `.png` like large audio (T58). The CT session copies Mitch's art in from `Stories/scenarios/<family>/art/sized/` — `backdrop.png` → `scene/backdrop.png`, `body.png` → `scene/<host-id>/body.png`, `eyelids2.png` → `scene/<host-id>/eyelids.png` (≈ 4.7 MB per family) — and sets the portrait's `body`/`eyelids`/`mouthAnchor`; **`mouthAnchor` fractions are measured with T61's anchor picker** (dev screen) once it lands; until then keep `placeholder`.

## Exam drafts (`*.exam.md` — M18, T67)

An **exam pack** (`type: exam`, design `docs/design/TORFL_EXAM_PREP.md` §3 at the workspace root, ADR-0020) holds one or more structured tests — **exam → subtests → parts → items** — in `mock` mode (a faithful timed ТРКИ) or `drill` mode (practice with instant feedback). It is authored as two kinds of file given to `annotate` **together**:

1. **Story drafts** (ordinary `*.draft.md`, everything above applies unchanged) for every reading passage, listening script, examiner line and model answer — full 7-column token tables, `pack:` byte-identical across the pack, `voice:` directions for `pipeline audio` (multi-voice listening dialogues via `sentenceVoices`). **Exam audio is story audio**: no other audio exists or is rendered.
2. **One exam draft per exam** (`*.exam.md`): **YAML frontmatter only** — a single `exam:` key (+ an optional `pack:`). The markdown body below the closing `---` is author notes; `annotate` ignores it. The pipeline recognizes an exam draft by the `exam:` key, never by filename.

```bash
pnpm pipeline annotate stories/*.draft.md mock-01.exam.md drills.exam.md -o packs/a1-torfl-mock-001/pack.json
pnpm pipeline validate packs/a1-torfl-mock-001/pack.json     # the four exam reports (below)
pnpm pipeline audio  packs/a1-torfl-mock-001/pack.json stories/*.draft.md …   # renders the STORIES, exactly as for a story pack
```

`pack:` in an exam draft follows the extras precedent: **optional next to story drafts** (it must then match them byte-for-byte), **required when the pack has no story drafts** (a lexgram-only drill bank, CT028) — and such a story-less pack's items may carry **no** story refs. Exams appear in `pack.exams` in the order their drafts are given on the command line. Use `type: exam` and `category: torfl` (the «ТРКИ» shelf; default register `lecturer`).

### The exam object

```yaml
---
exam:
  id: a1-mock-01 # unique within the pack
  format: torfl # the only format today
  level: A1
  mode: mock # mock | drill
  title: { ru: 'Вариант 1', en: 'Mock exam 1' }
  blurb: 'One line for a drill card.' # OPTIONAL, drills
  subtests: # mocks: writing → lexgram → reading → listening → speaking (official order)
    - id: lexgram # unique within the exam
      kind: lexgram # writing | lexgram | reading | listening | speaking
      title: { ru: 'Лексика. Грамматика', en: 'Vocabulary. Grammar' }
      instructions: { ru: 'Время выполнения теста — 40 минут. …', en: '40 minutes · …' }
      durationMin: 40
      dictionary: false # the SPbU dictionary rule: reading + writing true, the rest false
      navigation: free # free (paper subtests) | linear (listening, speaking)
      pointsPerItem: 1 # objective subtests: this, or `points` on every item
      maxPoints: 70 # objective: MUST equal Σ item points; rubric subtests: 100
      audioPlays: 2 # listening subtests of mock exams: REQUIRED (official 2)
      parts:
        - id: p1 # unique within the subtest
          instructions:
            {
              ru: 'Задания 1–24. Выберите один вариант ответа.',
              en: 'Items 1–24. Choose one answer.',
            }
          timeSec: 300 # OPTIONAL — speaking parts: 300 / 300 / 600
          items: […] # ≥ 1
---
```

**Required vs optional — the same for mocks and drills:** an exam needs `id`, `format`, `level`, `mode`, `title`, `subtests` (`blurb` optional). Every subtest needs `id`, `kind`, `title`, `instructions`, `durationMin`, `dictionary`, `navigation`, `maxPoints` and `parts`; `pointsPerItem` is optional (objective subtests need it **or** per-item `points`) and `audioPlays` is optional except on a mock's listening subtest. Every part needs `id`, `instructions`, `items`; `timeSec` is optional. A drill's `durationMin` is the exam-pace budget the app may show, not an enforced timer.

Every item has `id` (**unique per exam**, across subtests; never a sentence id — the two namespaces are separate), `kind`, `topic` (a TORFL §3.4 slug — see the census below), optional `explain` (English, may quote Russian; shown after answering in drills and in review after a mock) and, on objective items only, optional `points` (overrides `pointsPerItem`).

**Which kinds go where:** `lexgram` / `reading` / `listening` parts hold only `choice` and `typed`; a `writing` part holds **exactly one** `writing` item; `speaking` parts hold only the three speaking kinds.

**`choice`** — A–Г single choice. `options` 2–4 (unique after lower-casing, ё → е and space-collapsing), `answer` = the **0-based** index. The `stem` has **at most one gap**: «…» (U+2026), ASCII `...` or `___` all count as a gap. `stemEn` (optional) is the drill-only translation.

```yaml
- {
    id: lg01,
    kind: choice,
    topic: case-prep,
    stem: 'Нина любит играть … компьютере.',
    options: ['в', 'на'],
    answer: 1,
    explain: 'играть на компьютере — «на» + prepositional.',
  }
- id: rd05
  kind: choice
  topic: read-detail
  passage: { storyId: rd-02, sentenceIds: [tfa1m01r02-s03, tfa1m01r02-s04] } # optional span
  stem: 'Анна работает в …'
  options: ['школе', 'банке', 'магазине']
  answer: 1
```

**`typed`** — free text. `prompt`, `accept` (full credit; ё/е-tolerant, trailing-`*` stem globs allowed), optional `half` (half credit — right meaning, wrong form). Same `passage` / `audio` refs as `choice`.

```yaml
- {
    id: dr06,
    kind: typed,
    topic: case-prep,
    prompt: 'Громов отдыхает в (парк).',
    accept: ['парке'],
    half: ['парк', 'парку'],
  }
```

**`writing`** — the letter. `task` (the situation, `{ru, en}`), `bullets` (3–15 of `{ id, text: {ru, en}, cues: [...] }` — the points to cover; **`bullets`, not `points`**, which is the score field), `minSentences` (≥ 5), `minQuestions` (default 0), optional `maxQuestions` (≥ `minQuestions`), optional `model` (the model letter — a story ref).

```yaml
- id: wr01
  kind: writing
  topic: write-letter
  task: { ru: 'Напишите письмо другу о своей жизни.', en: 'Write to a friend about your life.' }
  bullets:
    - { id: b1, text: { ru: 'как вас зовут', en: 'your name' }, cues: ['зовут'] }
    - { id: b2, text: { ru: 'где вы живёте', en: 'where you live' }, cues: ['живу', 'живём'] }
    - { id: b3, text: { ru: 'где вы работаете', en: 'where you work' }, cues: ['работа*'] }
  minSentences: 13
  minQuestions: 4
  maxQuestions: 5
  model: { storyId: md-letter-01 }
```

**`speaking-reply`** (task 1) / **`speaking-situation`** (task 2) — `prompt` (**required** story ref: the examiner's line or the read-aloud situation), `situation` (`{ru, en}`, **required** on `speaking-situation`), `expect` (**the M17 expectation, verbatim** — `slots` + `accept`, `accept[0]` is the model answer; same slot kinds and form rules as a scenario's `EXPECT:`, written as YAML), `minTokens` (default 4 — «да / нет / не знаю» is not a full answer).

```yaml
- id: sp01
  kind: speaking-reply
  topic: speak-reply
  prompt: { storyId: ex-01, sentenceIds: [tfa1m01e01-s01] }
  expect:
    slots:
      - kind: forms
        id: city
        required: true
        options: [{ key: city, lemma: 'город', forms: ['москв*', 'казан*'] }]
    accept: ['Я живу в Москве.']
- id: sp06
  kind: speaking-situation
  topic: speak-situation
  prompt: { storyId: ex-02, sentenceIds: [tfa1m01e02-s01] }
  situation: { ru: 'Вы в кафе. Закажите чай.', en: 'You are in a café. Order tea.' }
  expect:
    slots: [{ kind: free, id: order, required: true, minTokens: 2, cues: ['чай'] }]
    accept: ['Дайте, пожалуйста, чай.']
```

**`speaking-monologue`** (task 3) — `topicTitle` (`{ru, en}`), `questions` (4–12 of `{ ru, cues: [...] }`), `group` (two items sharing a group = «choose one of two topics»; a group has **exactly 2** members), `minSentences` / `maxSentences` (defaults 10 / 12), `prepSec` / `answerSec` (defaults 480 / 120), optional `model`.

```yaml
- id: sp11
  kind: speaking-monologue
  topic: speak-monologue
  group: m1
  topicTitle: { ru: 'О себе', en: 'About myself' }
  questions:
    - { ru: 'Как вас зовут?', cues: ['зовут'] }
    - { ru: 'Откуда вы?', cues: ['из'] }
    - { ru: 'Где вы живёте?', cues: ['живу'] }
    - { ru: 'Что вы любите делать?', cues: ['люблю', 'нравится'] }
  model: { storyId: md-self }
```

**Cues** (writing bullets, monologue questions, speaking slot forms) follow the M17 slot-form rule: NFC, letters/digits/spaces/in-word hyphens only, **no punctuation**, a glob is a single **trailing** `*` (`работа*`).

### Story refs

`passage` (reading), `audio` (listening), `prompt` (speaking) and `model` (writing / monologue) are `{ storyId, sentenceIds?, trackId? }`:

- `storyId` must be a story **in this pack** (one of the story drafts given to the same `annotate` run).
- `sentenceIds` (optional) must exist in that story and be a **contiguous run in story order** (`[s03, s04]`, never `[s04, s03]` or `[s01, s03]`). Absent = the whole story.
- `trackId` (optional) must be one of that story's audio track ids — so it only validates **after** `pipeline audio` has rendered the story; leave it out while drafting (absent = the story's first track).
- **Listening inheritance:** in a listening part, items after the first may omit `audio` and inherit **the part's first item's** `audio` (one dialogue → several questions). The first item must carry one.
- **Audio is all-or-nothing:** once any story in the pack has a track, every story referenced by an `audio` or `prompt` ref needs one too. Passages and models may stay silent.

### Points arithmetic

Objective subtests (`lexgram`, `reading`, `listening`): each item is worth its `points` or the subtest's `pointsPerItem`, and **Σ must equal `maxPoints`** (±0.001) — the official A1 matrix is lexgram 70 × 1 = 70, reading 25 × 4 = 100, listening 20 × 5 = 100. Writing and speaking are **rubric %**: their items never carry `points`; set `maxPoints: 100`.

### The four reports

`annotate` and `validate` print, for every exam:

- **Matrix map** — subtest → parts → items with kind / topic / points and `Σ x / maxPoints ✓`; rubric subtests show `rubric % of 100`.
- **Topic census** — items per topic slug. A slug outside TORFL §3.4, or listed there under a different subtest kind, is flagged `?` — a warning, never an error (the app renders unknown slugs raw). The §3.4 slugs (data in `src/exam-topics.ts`):
  - lexgram — `lex-verbs` · `lex-family` · `lex-negation` · `agr` · `pron` · `case-prep` · `case-acc` · `case-gen` · `case-dat` · `case-instr` · `verb-forms` · `verb-aspect` · `verb-motion` · `conj`
  - reading — `read-continue` · `read-signs` · `read-topic` · `read-detail`
  - listening — `listen-where` · `listen-who` · `listen-phrase` · `listen-detail` · `listen-info`
  - writing — `write-letter` · speaking — `speak-reply` · `speak-situation` · `speak-monologue`
- **Official-shape check** — for a `mock` with `format: torfl`, `level: A1` only: `⚠ official-shape:` lines for every deviation from the official A1 numbers (five subtests in the SPbU order; lexgram 70 items / 70 points / 40 min / no dictionary / free; reading 25 / 100 / 40 / dictionary / free; listening 20 / 100 / 30 / no dictionary / linear / `audioPlays: 2`; writing 30 min with dictionary; speaking 20 min, linear, parts 300 / 300 / 600 s), or `✓ official shape (TORFL A1 mock)`. Drills print «not checked». **Warnings never change the exit code** — a short practice mock is legal.
- **Ref table** — every ref → story · sentence span · track, `✓` / `✗`; inherited listening audio is marked `audio↑`.

Schema errors (everything in this section that says "must") fail `annotate` with exit 1 and a `file:line:` pointing at the offending YAML node in the exam draft — ref errors included.

### Ids (the TORFL convention)

Story ids: `rd-<NN>` reading texts · `ls-<NN>` listening scripts · `ex-<NN>` examiner lines · `md-<slug>` model answers · `lx-<topic>` lexicon topics. Sentence ids: `tf<level><pack-code><NN>-sNN`, e.g. `tfa1m01r01-s01` = A1, mock 01 (`m01`; drill and study packs take the code the CT bible assigns — e.g. `lx` for the lexicon, `fx` for the T67 fixture), story kind + number `r01` (`r` reading, `l` listening, `e` examiner, `d` model answer), sentence 01. It is a convention the pipeline does not enforce (sentence ids only have to be unique pack-wide), so follow the bible. Exam ids: `a1-mock-NN`, drill ids per the CT bible. The CT bible `sumrak-content/series/torfl/TORFL.md` is the canonical id table.

### Exam gotchas

1. **`answer` is 0-based.** А = 0, Б = 1, В = 2, Г = 3.
2. **Quote YAML strings with `:`, `#`, `«»` or a leading `-`/`[`/`{`** — `stem: 'Он сказал: «…»'`. Single quotes are safest; a single quote inside is doubled (`'it''s'`).
3. **Stems with two blanks are refused** — split the item, or reword one blank into the text.
4. **`bullets` is the writing list; `points` is the score.** A writing or speaking item with `points` is an error.
5. **Give the story drafts in the same `annotate` call** as the exam drafts; an exam draft given alone may carry no story refs.
6. **`trackId` waits for audio** — add it (if at all) after `pipeline audio`; until then omit it.
7. **Mock listening needs `audioPlays`;** drill listening does not (drills replay freely).
8. **Item ids are per exam, not per subtest** — prefix by subtest (`lg01`, `rd01`, `ls01`, `wr01`, `sp01`).
9. **The body is ignored** — anything below the closing `---` (a key, the answer table you derived, notes) never reaches the pack.
