# Сумрак — Runbook

Operational how-tos for the things done rarely enough to forget. Written (and
followed verbatim as a test) in T22. Dev/release build mechanics live in the
repo [README](../README.md); this file covers content, voices, restore, and
diagnostics.

---

## 1. Add new content (a story pack)

Prereqs: repo installed (`pnpm install`), `ffmpeg` on PATH, `ELEVENLABS_API_KEY`
exported or in a gitignored `.env` at the `Sumrak` repo root, and a local clone
of the private content repo as a **sibling of this repo** (`../sumrak-content`,
i.e. the `sumrak-content` directory at the workspace root).

1. **Author the draft(s).** One markdown file per story; a pack with N stories =
   N drafts sharing identical `pack:` frontmatter. The complete, self-contained
   grammar (frontmatter, sentence blocks, 7-column token table, voice direction)
   is `packages/pipeline/docs/AUTHORING.md` — a fresh Claude session can author
   from that doc alone. Story sources live in `../Stories/<StoryName>/<LEVEL>/`
   (workspace convention), e.g. `../Stories/TheOldMirror/A1/the-old-mirror.draft.md`.
2. **Annotate & validate** (from the `Sumrak` repo root):
   ```sh
   pnpm pipeline annotate path/to/story1.draft.md path/to/story2.draft.md -o /tmp/pack-check.json
   ```
   Fix any `file:line:` errors until it exits 0. (Course-unit / checkpoint /
   prompts extras ride along via `--extras <file>` — see AUTHORING.md.)
3. **Render narration.** First audition takes (never touches pack.json):
   ```sh
   pnpm pipeline audio path/to/*.draft.md -o ../Stories/_build/<pack-id> --audition 3
   ```
   Listen to `../Stories/_build/<pack-id>/audition/*.mp3`, pick a seed per
   track, then finalize:
   ```sh
   pnpm pipeline audio path/to/*.draft.md -o ../Stories/_build/<pack-id> \
     --seed <track-id>=<seed> [--seed <track-id-2>=<seed>…]
   ```
   Check the printed stamp report: every track should say monotonic, ~100%
   coverage. A 0-stamp track falls back to sentence karaoke in the app —
   re-render with another seed instead of shipping that.
4. **Publish** (commits into the content repo; `--push` is opt-in):
   ```sh
   pnpm pipeline publish ../Stories/_build/<pack-id> --content ../sumrak-content --push
   ```
   Updating an existing pack: bump `pack.version` in every draft first —
   publish refuses same-version content drift.
5. **Sync on the phone.** Settings → Content sync must have the repo
   (`mrrobotisreal/sumrak-content`) and a fine-grained PAT (Contents:
   read-write) saved. Then Library → pull-to-refresh (or Packs → Check for
   updates). Audio can defer to Wi-Fi per the Wi-Fi-only toggle.

**Variant — a non-fiction pack (news / education / podcast / documentary /
travel, M14 / ADR-0016).** Same five steps, with three differences:

- **Frontmatter** (AUTHORING.md "Frontmatter" + "Non-fiction registers"):
  `pack.category: news` (one shelf per pack), each `story.source:` (`name`
  always, `publishedAt: YYYY-MM-DD` for anything dated, `url`/`author` when
  they exist) and `story.subtitle:` when the source has a dek; the `voice:`
  block names `register: anchor` (news) / `lecturer` / `host` / `voiceover` /
  `guide` and **omits `voice:`/`style:`** — the default voice `Mr. Wintrow` on
  `eleven_multilingual_v2` + `language_code ru` is filled in by the register.
  Fiction packs name `category: stories` + `genre:` and `register: narrator`.
  The pre-render summary prints the resolved model / voice / style per track
  before anything fires — check it says `eleven_multilingual_v2 … Mr. Wintrow`.
- **Anthology packs grow by appending**: one open-ended pack per shelf and
  rung (`a2-news-001`, `a2-edu-001`, `a2-podcast-001`, `a2-doc-001`,
  `a2-travel-001`). A new item = a new draft passed **after** the existing
  drafts, `pack.version` bumped in every draft, the same `_build/<pack-id>`
  dir (so earlier opus files are carried), `--stories <new-id>` on the audio
  run; never reorder or re-id old items (the SAR-stories rule,
  `../sumrak-content/series/sar-stories/SERIES.md` §2).
- **Publish** as usual; the manifest entry now carries `category`, which the
  app's Библиотека shelves read (T44–T45).

## 2. Add a TTS voice or the ASR model

Everything is on-device and on-demand; nothing ships in the APK.

- **TTS voice**: Settings → Voices & speech → download (Руслан / Ирина /
  Денис / Дмитрий, ~67 MB each, sha256-verified from the public k2-fsa release
  assets). Select the active voice in the same section; delete any voice to
  reclaim ~77 MB. At zero installed voices the app silently falls back to the
  Android system Russian voice.
- **ASR model** (pronunciation practice): Settings → Speech recognition →
  download (~60 MB, same verified-download mechanics). Delete/re-install any
  time; the pronunciation game gates itself with a "model needed" state.
- Both download over the network once and then work fully offline (airplane
  mode verified in T11/T12).

## 3. Restore from backup

Backups are encrypted snapshots of **user data only** (word bank, reviews,
journal, progress, settings — never content packs, never secrets). Sources:
GitHub (`sumrak-content/backups/`), the home server (`syncd` over Tailscale),
or a local exported file.

On a fresh install (or after data loss):

1. Open the app → Settings → **Restore from backup** (also reachable before
   any backup passphrase is configured).
2. Pick the source: GitHub (needs the PAT — on a truly fresh install the
   default repo is baked in), Home server (needs host + token saved in the
   syncd card), or Local file (SAF picker).
3. Pick the snapshot (newest first) and enter the **backup passphrase**. Key
   derivation takes ~11 s on-device — that's normal (PBKDF2, 210k iterations).
   A wrong passphrase fails cleanly; nothing is touched.
4. The restore replaces user tables in one transaction, reconciles installed
   packs against the snapshot's sync state, and auto-triggers a content sync
   to re-download anything missing.
5. **Post-restore checklist** (secrets and OS grants do not travel in
   backups, by design):
   - Re-enter the GitHub PAT (Settings → Content sync) if sync shows
     "not configured".
   - Re-enter the OpenRouter key (Settings → AI) for journal feedback /
     enrichment / assessment.
   - Re-grant notifications (Settings → Notifications master toggle) — a
     wiped install loses the OS permission.
   - Re-download TTS voices / the ASR model (§2) — model files are not part
     of user data.
   - If the Keystore alias died with the wipe, the backup card shows
     "Re-enter your passphrase" — doing so re-derives and re-caches the key.

## 4. Diagnostics

- **Error log**: Settings → Diagnostics → Error log. Everything the crash
  guard, global JS handler, and DB bootstrap catch lands there (on-device
  file, newest first, capped at 200). "Throw a test error" proves the crash
  guard end-to-end: the app shows the recovery screen instead of dying, and
  the error appears in the log.
- **DB debug** (dev builds only): Settings → Developer → Database debug.
  Its «Fixture packs (M14)» buttons (T44) import the M14 test packs
  `a2-news-090` / `a2-podcast-090` / `a1-comedy-090` from `@sumrak/schema`
  fixtures — a newspaper article with subtitle + source, a podcast episode,
  and a comedy story — so the category chips, reader header source line and
  badges can be exercised without a content sync (idempotent; re-tap shows
  `unchanged`). Remove them via the packs screen like any installed pack.
- **`review_log.source`** (T50): every grade records the activity that
  produced it (`flashcard` · `mc` · `cloze` · `sentence-builder` ·
  `listening` · `pronunciation` · `dialogue`; NULL = pre-T50 row). The DB
  debug screen has no review-log readout, so read it straight from the
  device DB on a debuggable build:

  ```sh
  adb shell run-as io.winapps.sumrak sqlite3 files/SQLite/sumrak.db \
    "SELECT source, COUNT(*) FROM review_log GROUP BY source"
  ```

  or pull `sumrak.db` **plus** its `-wal` and `-shm` sidecars (the T44
  trap — the WAL holds the newest rows) and open the three locally. The
  Словарь's familiarity sort counts only `flashcard` and NULL rows on
  ru-en / en-ru cards.

- All analytics are local (SQLite `analytics_events`); nothing reports to any
  third party, ever.

## 5. Switching between dev and release installs

Debug-signed (dev client) and release-signed builds cannot update over each
other. To switch: Settings → Backup → **Export to file** (or Back up now),
uninstall, install the other build, then §3 with the exported file. Same
`versionCode` rules as README "Versioning scheme".

## 6. Themed study soundtracks

The five study-ambience themes (`horror` default · `news` · `comedy` ·
`action` · `education`) are Opus beds bundled in the APK under
`apps/mobile/assets/audio/ambient/<theme>/` and listed in the hand-written
registry `apps/mobile/src/features/ambient-audio/beds.ts` (design
`docs/design/AMBIENT_SOUNDTRACKS.md`, ADR-0017). Which theme a pack gets is
`resolveAmbientTheme(classifyPack(pack))` in `theme.ts`: `news` /
`education` by category, `comedy` / `action` by genre under `stories`,
everything else (other genres, podcasts, travel, dialogues, games, review)
→ `horror`.

**Re-encode** (after replacing or adding a master):

```sh
export PATH="/opt/homebrew/bin:$PATH"   # ffmpeg + ffprobe from Homebrew
pnpm --filter sumrak-mobile encode:ambient            # skips unchanged masters (sha256)
pnpm --filter sumrak-mobile encode:ambient -- --force  # re-encode everything
```

- **Masters** live outside the repo in the workspace-root `assets/audio/`
  (`../assets/audio` from the `Sumrak` repo root): the Suno WAVs plus
  `creepy-bg-music-no-vocals.mp3` for horror. The theme → file table is the
  `SOURCES` constant at the top of `apps/mobile/scripts/encode-ambient-beds.mjs`.
- **−26 LUFS / −2 dBTP** is the level every bed is normalised to. It equals the
  original horror bed's measured loudness, so the volume slider's 20 % default
  means the same thing for every theme and the horror experience did not
  change. Don't "fix" it to −23 or −16.
- The script rewrites `assets/audio/ambient/beds.json`; a new or renamed bed
  also needs its `require()` in `sources.ts` and a row in `beds.ts`
  (`beds.test.ts` fails until both agree with the ledger). Commit the `.opus`
  files as plain files (no LFS).

**Add a bed** to an existing theme: drop the master into `../assets/audio/`,
append its file name to that theme's list in `SOURCES` (a `{ file, slug,
title }` object when the slug should differ from the file name), run
`encode:ambient`, then add the `require()` to `sources.ts` and the
`{ slug, title, durationMs, source }` row to `beds.ts` — `durationMs` is the
ledger's value. `pnpm test` (`beds.test.ts`) fails until all three agree.
Rotation order = array order; append at the end so nobody's cursor moves.

**Add a theme**: a new `AmbientThemeId` member + `AMBIENT_THEMES` entry +
`AMBIENT_THEME_ORDER` slot in `beds.ts`, a row in the script's `SOURCES`, a
branch in `resolveAmbientTheme` (`theme.ts`), and its icon in
`SOUNDTRACK_ICONS` (`soundtracks.ts`). Nothing else knows the theme list —
the engine, cursors and the Settings list all iterate the registry.

**Cursors.** Each theme's resume point lives in the `settings` table under
`audio.ambientCursors` as `{ "<theme>": { "bed": "<slug>", "positionMs": N } }`.
Themes absent from the blob start on bed 1 at 0; a cursor inside the last
5 s of a bed starts the _next_ bed. Clear one theme with Settings →
Background music → Soundtracks → **Reset** (also restarts a live preview),
or clear all with `DELETE FROM settings WHERE key = 'audio.ambientCursors'`
from the dev DB screen / `run-as` sqlite. Listening in Settings (▶ preview)
is a real activity — the cursor advances just as it would while reading.

**Ducking (T41).** When per-story soundscapes arrive they play on a second
player and must duck this bed to 0 for the story's duration (design §9).

## 7. Word forms & lessons (M16)

Every word in the Словарь can carry a **word profile** (its full
conjugation/declension with stress, participles, verbal adverbs, aspect pair,
word family, government) and, per section of that profile, saved **grammar
lessons**. Both are generated once, online, by Claude or GPT through
OpenRouter, then stored forever and read offline (design
`<workspace>/docs/design/WORD_FORMS_AND_LESSONS.md`, ADR-0018). Nothing in
the reader, the games or the existing Словарь filters gained an online
dependency.

### 7.1 The preset («Grammar & word forms»)

Settings → AI → **Grammar & word forms**. Three controls: **Provider**
(Anthropic / OpenAI), **Quality** (Fastest · Fast · Normal · Best — the
model ladder) and **Effort** (Low · Medium · High · Ultra — the thinking
level; Ultra = extra-high, slowest and most expensive). The default is
Anthropic · Normal · High (= Claude Opus 5.5). The preset is the default for
every Generate / Learn sheet; each sheet can override it for one run and
has a «Save as my default» switch. The five older AI features (journal
feedback, enrichment, explain, assessment, import annotation) do **not**
use this preset — they keep the single model above it (ADR-0018 decision 6).

**Test** (the button under the controls) sends a one-line request through
the resolved model with the effort lever attached and prints «Served by
<model>». It is the truth about whether a notch works today; run it after
any slug edit or when a generation fails with «request rejected». «effort
n/a (provider rejected it)» after a Test means the provider refused the
effort parameter and the app retried without it (see 7.5).

### 7.2 Receipts (what the columns mean)

Every stored profile and lesson carries a receipt; the Forms tab footer,
the Versions sheet and the lesson screen print it as

    24 Sep 2026 21:43 · Anthropic · Claude Opus 5.5 (Normal) · High effort · $0.06 · 32 s

| column          | meaning                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| date/time       | when the row was stored (device local time)                                                                                                                                           |
| Provider        | the OpenRouter provider family that served it                                                                                                                                         |
| model (Quality) | the display name of the notch's default slug — or the raw slug when the table had been edited to something else (a receipt never claims a model it did not use)                       |
| Effort          | the effort notch that was requested; «effort n/a» = the provider rejected the parameter and the run went out without it                                                               |
| $               | OpenRouter usage accounting (`usage.include`), the whole generation including the one correction round — «< $0.01» under half a cent, «cost n/a» when the response had no usage block |
| s               | wall-clock seconds from request to stored row, both rounds included                                                                                                                   |

The same receipts feed the **estimate line** of every Generate sheet («~$0.11
· ~45 s · from 6 runs»): it is the mean of the stored receipts for the
selected provider × quality × effort × (profile | lesson) bucket in the
`grammar.stats` settings row. With no receipts for a notch the sheet says
«No data for this setting yet — the first run measures it» and never shows
a number. `DELETE FROM settings WHERE key = 'grammar.stats'` resets the
averages (the receipts on the rows themselves stay).

### 7.3 The batch («Generate forms for N words»)

The Словарь shows a row under the filter chips whenever bank items lack a
current profile: **«{N} words without forms · Generate all»**. Tapping it
opens the Generate sheet for the batch: the estimate is _per-word mean × N_,
and a caption «{k} skipped — no lemma yet» counts the words the batch
cannot run (a word without a lemma has no profile key — Edit or Enrich it
first, then it joins the next batch). Phrases are profiled too.

While it runs the row reads **«Generating forms · 12/37 · «страшный»…»**
with **Cancel**. Facts to rely on:

- **Sequential.** One request in flight, ever. A Best/Ultra batch of 40
  words is a ~1-hour job; leave the app, it continues on the next foreground.
- **Durable.** The queue is the `grammar.batch` row of the `settings` table.
  It is written _before_ each request and the word is removed _after_ its
  profile is stored, so killing the app loses at most one paid run (the one
  in flight) and never a stored profile. Relaunch → the row resumes with
  the done count preserved.
- **Pauses offline.** No request goes out without connectivity; the row
  reads «Paused — offline» and the worker resumes on reconnect / foreground
  / launch (the T16 queue triggers). A missing or rejected OpenRouter key
  pauses it the same way with the reason.
- **Failures are per word.** A model answer that fails validation twice
  (the service's one correction round) is _final_ for that word — it goes
  to «failed» instead of being re-run forever. Transport errors (timeouts,
  5xx, rate limits) retry 2 s / 8 s inside the pass, then wait for the next
  pump; three exhausted passes also mark the word failed.
- **Cancel** clears the pending list and keeps every profile already stored
  (the in-flight run, if any, still completes and is kept).
- **Retry** on the finished row («3 failed · 34 done · Retry») re-queues
  only the failed words; **×** dismisses the result.

Read the durable state directly on a debuggable build:

```sh
adb shell run-as io.winapps.sumrak sqlite3 files/SQLite/sumrak.db \
  "SELECT value FROM settings WHERE key = 'grammar.batch'"
```

Absent = no batch (finished clean, cancelled with nothing failed, or never
started). `pending` shrinks by one per stored profile; `done + failed +
pending = count` always. The batch also writes `profile_batch_started /
progress / finished / cancelled` to `analytics_events` with the same
counts. Deleting the row by hand is a safe «cancel».

### 7.4 Model table (the only place slugs live)

Settings → AI → Grammar & word forms → **Advanced: model ids**. One
OpenRouter slug per provider × quality; the defaults are decision 3 of the
design (Claude Haiku 4.5 · Sonnet 5.5 · Opus 5.5 · Fable 5.1 and GPT-6 Luna ·
Sol · Sol Pro · Astra). Slugs drift: when a notch starts failing with
«request rejected», paste the current slug from openrouter.ai/models into
that cell (blur commits; the regex refuses anything that is not
`vendor/model`), then **Test**. A receipt for a run made through an edited
slug prints the slug itself, not the display name. Reset a cell by
clearing it (the placeholder is the default).

### 7.5 Effort-param fallback («effort n/a»)

Anthropic models take the effort notch as the top-level `verbosity` field,
OpenAI models as `reasoning.effort` (Ultra = `xhigh` on both). If a
provider answers a 4xx that names `verbosity` / `reasoning` / `effort` /
«unsupported parameter», the app retries once without the lever (usage
accounting kept), stores the row with `effort_applied = 0`, prints «effort
n/a» in the receipt and writes `ai_effort_param_rejected {provider, model}`
to `analytics_events`. Through 2026-09-25 no default slug has rejected it.

### 7.6 Re-capturing the AI fixtures

The unit tests parse recorded responses under
`apps/mobile/src/features/ai/__tests__/__fixtures__/` (journal feedback,
enrichment, explain, assessment, import annotation, the four word profiles,
the grammar lesson). They are captured with the **same in-repo prompt
builders the app ships**, on Claude Sonnet 5 at medium effort, and must be
re-captured whenever a prompt template changes:

```sh
cd apps/mobile
set -a; source ../../.env; set +a          # OPENROUTER_API_KEY — never paste it
npx tsx scripts/capture-ai-fixtures.ts              # everything (≈ $0.20)
npx tsx scripts/capture-ai-fixtures.ts word-profile-verb   # one fixture
pnpm test                                            # the parsers must still pass
```

The fixtures keep `usage` and `finish_reason` (the T51 client parser is
exercised by a real response) and contain synthetic study content only —
safe to commit. Tests never call the network; this script is the only live
caller outside the app.

### 7.7 Cost expectations (measured, not priced)

The app never hardcodes prices; these are the receipts actually observed on
the S24U with Mitch's key. Use them to pick a notch before a batch.

**Profiles** (one word; the whole generation incl. a correction round when it fired):

| Provider · Quality · Effort              | Model           | mean time      | mean cost         | n   | measured                    |
| ---------------------------------------- | --------------- | -------------- | ----------------- | --- | --------------------------- |
| Anthropic · Normal · High                | Claude Opus 5.5 | 65 s (33–92 s) | $0.18 (0.08–0.26) | 5   | 2026-09-24 (T52)            |
| Anthropic · Normal · High                | Claude Opus 5.5 | 49 s           | $0.11             | 1   | 2026-09-24 (T53, «описать») |
| Anthropic · Normal · High                | Claude Opus 5.5 | 47 s           | $0.11             | 1   | 2026-09-24 (T54, «дешёвый») |
| OpenAI · Fast · Medium                   | GPT-6 Sol       | 63–64 s        | $0.04             | 2   | 2026-09-24 (T52/T53)        |
| Anthropic · Fast · Medium (host capture) | Claude Sonnet 5 | —              | ≈ $0.035          | 4   | 2026-09-24 (T52 fixtures)   |

Nouns are the cheap end (≈ 33 s · $0.08), verbs and adjectives the expensive
end (≈ 75 s · $0.21–0.26) — a verb profile is ~25 sections of forms.

**Lessons** (one word × one section):

| Provider · Quality · Effort              | Model           | mean time | mean cost | n   | measured                 |
| ---------------------------------------- | --------------- | --------- | --------- | --- | ------------------------ |
| Anthropic · Normal · High                | Claude Opus 5.5 | 32 s      | $0.06     | 4   | 2026-09-24 (T54)         |
| OpenAI · Best · Ultra                    | GPT-6 Astra     | 111 s     | $0.23     | 1   | 2026-09-24 (T54)         |
| Anthropic · Fast · Medium (host capture) | Claude Sonnet 5 | —         | $0.018    | 1   | 2026-09-24 (T54 fixture) |

<!-- T55 appends the 2026-09-25 matrix rows below this line -->

---

## 8. Speaking scenarios (M17)

«Сценарии» — blind speaking role-plays: a host talks, you answer out loud
with no text on screen, an offline judge scores the answer against authored
expectations, a talking cast moves its mouth to pipeline mouth tracks, every
attempt is recorded and reviewable afterwards. Design
`../../docs/design/SPEAKING_SCENARIOS.md`, scripts
`../../docs/design/SCENARIO_SCRIPTS_BATCH_1.md`, ADR-0019 (workspace root).
Entry points: Games → «Сценарии», the Today card «Сценарий», Settings →
Scenarios (run prefs) and Settings → Speech recognition → «Recordings».

### 8.1 Add a scenario family (a CT session)

One pack per rung, `a{level}-scn-<family>-001`, `type: scenario`, no
`category` (scenarios are not Library content). The authoring contract is
`packages/pipeline/docs/AUTHORING.md` → **«Scenario drafts»** (frontmatter,
turns, `EXPECT:` slots, retry lines, glossary, nudges, the branch map + the
glossary coverage report) and **«Scenario audio»** (per-line renders on
Multilingual v2, variant steering, `--player-audio` coach clips,
`--audition` / `--seed radio-a1/host=<seed>`, `--mouth-only`, the cost gate).
The founding pack's bible — cast roster, voices, cue notes, the numbering —
is `../../sumrak-content/series/scenarios/SCENARIOS.md` once CT020 writes it.

**The art rule.** Mitch's PNG layers live at
`Stories/scenarios/<family>/art/sized/` (workspace root). The CT session copies
`backdrop.png` → `<pack-dir>/scene/backdrop.png`, `body.png` →
`scene/<host-id>/body.png`, `eyelids2.png` → `scene/<host-id>/eyelids.png`
(≈ 4.7 MB per family — Wi-Fi-gated on the phone like large audio), sets the
host's `portrait.body` / `eyelids`, and measures **`mouthAnchor`** with the
**anchor picker**: dev build → Settings → Developer → **Scene gallery**
(`sumrak://dev-scene`), pick the family, drag the mouth box over the closed
lips, copy the printed `{ x, y, w, h, rotate }` fractions into the draft. The
podcast host measured `{ x 0.49, y 0.257, w 0.12, h 0.032, rotate 10 }` on the
1200×1600 body. **Re-publishing a rung with better art or re-auditioned lines
is a `pack.version` bump** in every draft, never a new id (publish refuses
same-version drift); already-published sentence ids stay byte-stable.

```sh
pnpm pipeline audio Stories/scenarios/<family>/*.scenario.md \
  -o ../Stories/_build/<pack-id> --audition 2            # pick a seed per (scenario, character)
pnpm pipeline audio … -o ../Stories/_build/<pack-id> \
  --seed <scenario-id>/<host-id>=<seed> --player-audio    # finalize + coach clips
pnpm pipeline publish ../Stories/_build/<pack-id> --content ../sumrak-content --push
```

The size line prints `scene/` separately («of which scene/ 4.68 MB»).

### 8.2 The assist model («как сказать…» in English)

Optional. Settings → Speech recognition → **Assist model** installs
**`whisper-base-int8`** (Whisper base, int8 encoder + decoder, 153 MB on disk,
+137 MB resident beside the Russian recognizer, ~190 ms per 2–3 s clip,
~430 ms cold load). It hears the English word inside «Как сказать _wallet_?»;
without it the app falls back to the glossary (`translit` forms) → the online
model → the «не знаю» nudge. Every Whisper archive is over GitHub's 100 MB
tree limit, so it downloads as an asset of the `models` **Release** on
`sumrak-content` (manifest `release: {tag, asset}`, PAT bearer +
`Accept: application/octet-stream`), then the k2-fsa mirror as the fallback.

T59's benchmark (20 synthetic «Как сказать <word>» clips per set, macOS `say`
renders — re-run on Mitch's own voice with `sumrak://dev-assist`):

| candidate              | glossary-fuzzy recovery (3 sets, ≥ 0.75) | exact word     | decode (median) | resident |
| ---------------------- | ---------------------------------------- | -------------- | --------------- | -------- |
| tiny-int8              | 75 / 65 / 70 %                           | 60 / 60 / 65 % | ~110 ms         | +79 MB   |
| **base-int8 (pinned)** | **80 / 75 / 80 %**                       | 60 / 70 / 65 % | ~190 ms         | +137 MB  |
| small-int8             | 70 / 75 / 85 %                           | 65 / 70 / 85 % | ~550 ms         | +353 MB  |

Delete / reinstall any time; the hub shows a one-time banner offering it.

### 8.3 Recordings and pruning

Every attempt you speak is kept. The T12 recorder writes a 16 kHz mono WAV
into the cache; when the judge's decision is persisted the file **moves** to
`files/recordings/scenario/<runId>/tNN-aM.wav` (NN = the turn's order, M =
the attempt number) and the attempt row stores that relative name. A
background queue then transcodes it to **Ogg/Opus 20 kbps** (`tNN-aM.ogg`,
~18 KB per 5 s), rewrites the row and deletes the WAV. On a device with no
Opus encoder (`ERR_OPUS_UNSUPPORTED`) the WAV stays and is played and bundled
as-is (~10× bigger; the bundle step warns once). The debrief plays either.

**Settings → Speech recognition → Recordings** shows the total on device,
**Keep for** (7 · 30 · 90 days), **Storage cap** (100 MB · 300 MB · 1 GB),
**Prune now** and the trash icon = **Delete all recordings**. The prune runs
at every app start and after every finished run (`scenario.recordings` in
the settings table: `{ v, pruneDays, capBytes, lastPruneAt }`):

1. unpinned runs whose finish (or start, if unfinished) is older than
   `pruneDays` lose their files;
2. if what remains still exceeds `capBytes`, the oldest unpinned **finished**
   runs go next until it fits;
3. **pinned runs are never pruned** (the pin is on the debrief header, also
   visible as 📌 in the runs list);
4. while a backup target is configured, a run whose media bundle has not been
   uploaded yet is spared by rule 1 (not by rule 2 — a target that keeps
   failing cannot grow the folder without bound).

Pruning deletes **files only**: the run, its attempts, transcripts, per-word
chips and scores all stay. In the debrief the media line then reads
**«Recordings archived in your backup» + Download** (a bundle exists) or
**«Recordings deleted»** (none does). `recordings_pruned {runs, bytes,
orphans, reason}` is the honest count (`reason` = start / post-run / manual /
delete-all). A run directory with no row (a wiped DB) is deleted as an
orphan.

### 8.4 Media bundles and lazy restore

After a run finishes **and** its transcodes are done, the app packs the run
directory into one **`SMB1`** blob (`'SMB1'` · u32 header length · JSON
`{ v:1, runId, files:[{ name, bytes, sha256 }] }` · the bodies — names and
sizes only, never a transcript), seals it with the **same passphrase key and
envelope as the snapshots** (`kind: 'media'` in the envelope header; T20 files
carry no `kind` and read as snapshots) and uploads it under the name
**`sumrak-media-<runId>.json`** to every enabled target:

- **GitHub**: `sumrak-content/backups/media/` (the snapshots stay in
  `backups/`);
- **syncd**: `PUT /backup?name=sumrak-media-<runId>.json` — the server
  accepts the media name since the SumrakAPI change of 2026-09-27 (build +
  deploy `syncd` from `SumrakAPI` `0142268` or later, `deploy/README.md`).

State on `scenario_runs.mediaBundleState`: `null` (not yet) → `pending`
(offline / target unreachable) → `uploaded` | `failed` (a target rejected it
for a non-transient reason). The **pump** retries pending, failed and
never-bundled finished runs at the automatic-backup trigger points (launch,
foreground, background) and from the Backup card's **«Media: N bundles · M
pending · tap to retry»** line. Bundles are **immutable**: a name a target
already holds counts as uploaded; **no retention** applies to them (~150 KB
each; 1,000 runs ≈ 150 MB, accepted — remote deletion for pruned runs is a
follow-up). Events: `media_bundle_uploaded / failed {bytes, target}`,
`media_bundle_downloaded`.

**Restore is lazy.** A snapshot restore (§3) brings every run and attempt row
back with `mediaLocal = false` and no files — the debrief shows
**Download** on each run that has an uploaded bundle. Download fetches
(syncd first, then GitHub), decrypts with the current key, verifies every
sha256, writes the files into the run directory, re-points the attempts and
flips `mediaLocal`. Nothing here blocks a screen; a failure shows one line in
the debrief and leaves the row untouched.

**Not configured?** Recordings stay local and are pruned on the same rules;
the debrief shows «Set up backup to keep recordings» once
(`scenario.backupHintShown`).

### 8.5 The debrief and the runs list

Ending card → **«Смотреть разбор»** opens that run's debrief; the hub's
**«Runs · N»** (and Today's card) opens the runs list (day-grouped, per
scenario or all; an unfinished run resumes in place). A debrief shows the
header (family/rung, ending tone, turns · misses · hints · skips · rescues ·
avg · XP, the pin), one card per turn in walk order — the host's line
(tap-word, «EN», ▶ replay), each attempt (▶ your recording, the level strip,
`Услышал:` with the per-word ✓/✗ chips against the target, badges
`matched` / `near miss` / `miss` / `rescued` / `assisted` / `skipped`, the
paraphrase score), meta asks where they happened, and **«Можно было
сказать»** = `accept[0]` with ▶ coach audio when the pack shipped it — then
**Practice these · N** (every required forms-slot lemma you missed goes to
the word bank in one tap), **Play again**, **Share transcript** (plain text
through the Android share sheet, no audio).

### 8.6 Judge lab and scene gallery (dev builds)

- **Judge lab** — Settings → Developer → Judge lab (`sumrak://dev-judge`):
  pick any installed scenario turn, type or speak an answer, see the verdict
  (`matched` / `miss` / `no-speech`), slots hit, paraphrase score, near-miss,
  branch key, the meta-intent chain, and the live endpointing meter with the
  `START` / `LOUD` chips. adb-drivable:
  `adb shell am start -a android.intent.action.VIEW -d "sumrak://dev-judge?turn=<turnId>&say=<text>"`.
- **Scene gallery** — Settings → Developer → Scene gallery
  (`sumrak://dev-scene?line=<sentenceId|index>&rate=0.8`): every installed
  cast in every pose, the mouth driven by a chosen line, the perf probe
  (gfxinfo ≤ 1.6 % janky on the S25 is the T61 baseline) and the **anchor
  picker** of §8.1.
- **DB debug** (§4) lists the installed scenarios (audio staged / mouth /
  stamps / assets) and the last five runs with pin · media · bundle state.

### 8.7 Endpointing presets

Settings → Scenarios → **End of turn**: `quick` = 0.8 s of trailing silence,
`normal` = 1.1 s (default — the preset that won T62's device runs),
`patient` = 1.6 s; a hard 20 s cap ends any turn, 6 s with no speech at all
is a `no-speech` endpoint (the host nudges). Speech onset `START 0.08` /
loud `0.05` on the module's normalized RMS — a silent room sits ~6× under
START; hold-to-talk (Settings → Scenarios → Hold to talk) bypasses all of it.
Calibration on Mitch's own voice is still open (the lab's chips are the tool).

### 8.8 Cost expectations (measured)

| what                                        | requests / chars | wall time                              | result                             |
| ------------------------------------------- | ---------------- | -------------------------------------- | ---------------------------------- |
| fixture «Проверка связи» audition (2 takes) | 6 / 150          | 12 s                                   | seed picked                        |
| fixture finalize (54 lines + 2 coach)       | 56 / 1,115       | 89 s                                   | 90 s of audio, 444 KB Opus         |
| a real A1 rung (~120 lines, ~3,000 chars)   | ≈ 3 k chars      | ≈ 3 min                                | (CT020 records the real numbers)   |
| online rescue, one miss                     | 1 request        | Haiku 4.5 ≈ 1.9 s · GPT-6 Luna ≈ 1.1 s | ≈ $0.0007                          |
| one attempt recording                       | —                | —                                      | 5 s → ~18.7 KB Opus (WAV ≈ 160 KB) |
| one media bundle (4–8 attempts)             | —                | —                                      | ≈ 100–200 KB sealed                |

ElevenLabs characters come off the monthly plan; the rescue rides the
OpenRouter key from Settings → AI (a phone without a key simply plays
offline — same game, slightly stricter).

## 9. TORFL exam prep (M18)

«ТРКИ» — Mitch's prep for the SPbU online **ТРКИ-А1 (ТЭУ)**: a Library
category + hub, drills with an exam FSRS deck and readiness bars, and
faithful **timed mock exams** of the five-subtest format (Письмо →
Лексика. Грамматика → Чтение → Аудирование → Говорение). Design
`../../docs/design/TORFL_EXAM_PREP.md`, decision ADR-0020 (workspace root).
Entry points: Библиотека → the **ТРКИ** chip (the pinned hub card),
Today's «ТРКИ» card, `sumrak://torfl`.

### 9.1 What is where

- **Hub** (`/torfl`): header + exam-date countdown (tap → month sheet →
  `torfl.examDate`), the SPbU pass rule, **Готовность** (five bars with the
  60 % / 66 % ticks + the predicted verdict), **Сегодня** (the recommended
  next step), **Пробные экзамены**, **Тренировки** (a five-tab strip of topic
  tiles + «Работа над ошибками · N» + «Молния» + «Билеты · N»), **Мои ответы**,
  **Тексты**, **История**.
- **Content** = `type: exam` packs (`a1-torfl-*`): items reference stories in
  the same pack (passages, listening scripts, examiner lines, model
  answers). Those stories are **not Library rows**: reach them from the hub's
  «Тексты», an item's review, or global search. The lexicon
  (`a1-torfl-lexicon-001`, `torfl:lexicon`) is an ordinary story pack whose
  reader has the **«Добавить все слова в Словарь»** chrome button.
- **Gate B (content publishing):** a `type: exam` manifest row is rejected
  whole by any build older than T67/T68, so an exam pack publishes only once
  **every syncing phone** runs a build with migration `0015_exams` (v1.6.2
  (10) or later — v1.7.0 (11) is the M18 release).

### 9.2 Scoring and the verdict

Objective subtests score per item (`choice` full or 0; `typed` full / half /
0 by the `accept` / `half` lists after NFC + lower + ё→е + punctuation
stripping); Лексика 70 × 1, Чтение 25 × 4, Аудирование 20 × 5; subtest pct =
Σ points / maxPoints, one decimal, unanswered = 0. **Verdict (SPbU):** pass
iff every subtest ≥ 66 %; **one** subtest in [60, 66) is still a pass («на
грани»); otherwise fail with the subtests to retake named. A provisional
writing/speaking pct makes the verdict **provisional** until the AI grades
land (the results screen flips in place).

**Dictionary rule** (the paper exam allows a bilingual dictionary): tap
lookup is **on** in Чтение passages, the Письмо editor («Словарь» sheet) and
speaking task 3's prep; **off** in Лексика, Аудирование and tasks 1–2
(Settings → ТРКИ → «Lookup in mock reading» can turn even reading off).
Drills always allow lookup.

### 9.3 Grading Письмо and Говорение (offline → AI → self)

1. **Offline provisional** at submission: writing = bullets covered + length
   / questions + letter form (55 of 100 points rescaled); speaking = the
   M17 judge on tasks 1–2 (60 / 20 of 100) and cue coverage + sentence
   estimate + fluency on task 3 (70 of 100), rescaled.
2. **AI rubric** through the durable queue (`exam_responses.gradingStatus`
   `pending-ai`) using **Settings → AI → «Exam grading»** (default Anthropic ·
   normal = Claude Opus 5.5 · effort **high**; measured ≈ $0.02–0.04 and
   10–20 s per response). Offline it simply waits; two failures →
   `ai-failed` with **«Повторить оценку»** on the row.
3. **Самопроверка** (writing): never online? Four 0 / ½ / 1 questions
   against the model letter split the 45 AI-only points → `gradedBy: 'self'`.

Fixture calibration (tests): Opus 5.5 is the stricter grader (weak letter 58
vs GPT-6 Sol Pro 74.5; speaking reply 96 / monologue 89 vs 97 / 95.5).

### 9.4 Mocks: timers, resume, listening, break

Every subtest runs on **wall-clock deadlines** (30 / 40 / 40 / 30 / 20 min)
persisted in the attempt — a kill mid-subtest resumes with the true remaining
time (hub banner + intro); a deadline passed while closed **auto-submits**
the answers as they were. Листening plays **exactly twice**, automatically,
with a 3 s gap and no controls; a play cut by a kill counts as heard and the
text plays again as the next play, never a third. A mock **never falls back
to TTS**: missing audio (Wi-Fi-gated, not downloaded) → «Скачай аудио по
Wi-Fi» and the subtest can be skipped. Skipped subtests are excluded from
the verdict (never 0 %). Settings → ТРКИ: English under the RU instructions,
the optional break screen between subtests, the drill timer.

Dev builds only: `sumrak://exam/run/<attemptId>?devDurationSec=45` shrinks
every subtest to N seconds (`devDurationOverrideSec` ignores it in release —
`exam-finish.test.ts` pins that; re-run it before any release build).

### 9.5 Speaking recordings, pins, media bundles (§8.5 for exams)

Every speaking answer is recorded (16 kHz WAV → **Ogg/Opus** by the shared
queue) under `files/recordings/exam/<attemptId>/t<task>-<itemId>.ogg`; the
response row stores the relative name. **Retention** = the scenario rules
over the exam root, chained after the scenario prune (Settings → Speech
recognition → **Recordings** shows «N KB scenarios · M KB exams», one «Keep
for» / «Storage cap» policy for both, «Prune now», the trash = both roots):

1. unpinned attempts older than `pruneDays` lose their files;
2. over `capBytes`, the oldest unpinned finished attempts go next;
3. **pinned attempts are never pruned** — the 📌 sits on the results screen
   header and on the speaking debrief;
4. while a backup target is configured, an attempt whose media bundle is not
   uploaded yet is spared by rule 1 (not rule 2).

Pruning deletes files only; the rows (transcript, points, AI comments) stay.
**Media bundles**: after a finished attempt's transcodes, its dir is packed as
`SMB1`, sealed with the backup key (`kind: 'media'`) and uploaded to both
targets as **`sumrak-media-exam-<attemptid>.json`** — the attempt id
**lowercased**, because syncd's `MediaFileRe` (SumrakAPI
`internal/naming/naming.go:24`) accepts lowercase stems only; no API change.
State lives in the **`torfl.media`** settings row (`{ v:1, attempts: { id: {
state, name } } }` — `exam_attempts` has no bundle columns and T74 shipped no
migration), so it rides the snapshot. The pump (launch / foreground /
background / Backup card «Media: N bundles») retries pending + failed and
picks up never-bundled finished attempts. **Lazy restore:** after a snapshot
restore the files are gone but the ledger knows — the speaking debrief's
media line reads «Записи в резервной копии» with **«Скачать запись»** (syncd
first, then GitHub; sha-verified; the answers are re-pointed by item). The
Backup card's media line counts scenario runs + exam attempts together.

### 9.6 «Мои ответы» and rehearsal

Hub → **Мои ответы** (`/torfl/answers`): every installed journal prompt
tagged `torfl` (the `a1-torfl-prompts-001` pack; `torfl:<topic>` = the §3.4
topic label) with Mitch's entries for it, newest first. **«Написать ответ»**
opens the ordinary journal editor pre-filled with the prompt (same AI
feedback). Each entry has **«Отрепетировать вслух»** (`/torfl/rehearse`): the
AI-corrected text when present (labelled «исправленный текст»), else his
own, split into sentences — pass 1 **«С текстом»** (read → record → per-word
✓/✗ + score, the T12 loop; «Ещё раз» is free, best counts), pass 2 **«Без
текста»** (the sentence hidden; «Показать» peeks), then a summary (average per
pass, the weakest lines). One `game_sessions` row (mode `torfl-rehearsal`,
no FSRS) + `torfl_rehearsal_finished {topic, score}`. Needs the Russian ASR
model (Settings → Speech recognition); the screen says so otherwise.

### 9.7 Troubleshooting

| Symptom                                     | Cause → fix                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Speaking subtest blocked at its instruction | no ASR model or mic denied → Settings link on the screen, or «Пропустить этот субтест» (excluded from the verdict)                |
| «Скачай аудио по Wi-Fi» before Аудирование  | the pack's audio is Wi-Fi-gated and not yet downloaded → Settings → Content → download, or skip the subtest                       |
| Result row stuck «ждёт оценки ИИ»           | offline (waits for reconnect) or no OpenRouter key (Settings → AI); «Повторить оценку» after `ai-failed`; Самопроверка for Письмо |
| Mock disappeared after a kill               | it did not — the hub shows «Продолжить пробный экзамен»; a passed deadline auto-submitted the subtest                             |
| Debrief ▶ is grey                           | the recording was pruned; «Скачать запись» when a bundle exists, else «Записи удалены»                                            |
| Exam pack missing after sync                | the phone's build predates `0015_exams` (Gate B) → install ≥ v1.6.2 (10) and sync again                                           |
| «Мои ответы» is empty                       | no `torfl`-tagged prompts installed → sync the prompts pack (dev: import `a1-torfl-prompts-fixture`)                              |

### 9.9 A2 (ТБУ) — «ТРКИ-А2» (M19, T75 + T76)

A second, fully separate shelf: Library chip **«ТРКИ-А2»** (category `torfl-a2`),
its own hub (`/torfl?level=A2`, `sumrak://torfl?level=A2`), readiness, exam deck,
history and exam date (`torfl.examDateA2`). Design
`../../docs/design/TORFL_A2_EXAM_PREP.md`, ADR-0021.

- **THE LEVEL RULE:** every TORFL surface takes a level. An exam's level is
  `exams.level`; attempts / responses / deck cards inherit it by join; prompts
  packs use `packs.level`. A missing or unknown `?level=` = A1. The A1 hub, deck
  and history never see an A2 row (and vice versa).
- **Format (level profile `features/torfl/level-profile.ts`):** pass rule = A1's
  (every subtest >= 66 %, at most one in [60 %, 66 %)). Mock order Письмо ->
  Лексика. Грамматика (100 x 1) -> Чтение (30 x 6) -> Аудирование (25 x 6, every
  text twice) -> Говорение. «Молния» pace 30 s.
- **Письмо = two tasks, equal weight:** a letter (>= 10 sentences, 3-5 questions)
  and a messenger note (`write-note`, >= 5 sentences: reason / day / time /
  place), a «Задание 1 · Задание 2» stepper under one 50-min timer. Each response
  row is worth `subtest.maxPoints / n` (50 + 50), in the offline score, the AI
  fold, the results recompute and the review (every task listed; each has its own
  «Повторить оценку» / «Самопроверка»). The results row stays «предварительно»
  while any task is provisional. This applies to any multi-task writing subtest.
- **Говорение:** tasks 1-2 caps 45 s / 60 s; **task 3 is ONE topic** — the runner
  skips the choose step and goes straight to prep, windows from the item
  (`prepSec` / `answerSec`, A2 = 600 / 300) else the level profile. All timing
  copy is generated. The offline monologue scorer reads the profile's fluency
  bands and an A2 verb-stem list (`A2_VERB_STEMS`, corpus-tested).
- **Чтение P3:** 15 items share one long passage; the panel keeps its scroll per
  passage across items and has a «▲ к началу» chip.
- **AI grading** is level-aware (`level` + `taskTopic` on the prompt inputs): the
  A2 prompt carries the 2010 sample's expert criteria on the unchanged JSON
  contract; A1 prompts are byte-identical (golden test).
- **Gate B-A2:** A2 **exam** and **prompts** packs publish only once EVERY syncing
  phone (S24U + S25) runs an installed release containing T75 + T76. An older
  build files them under a raw chip «torfl-a2» **and in the unscoped A1 hub**.
  The A2 lexicon (a plain `stories` pack) and the «Экзамен» A2 scenario rung have
  no gate.
- **Troubleshooting:** A2 rows (or an A2 exam) in the A1 hub = a build older than
  the T76 release -> install it and re-sync. Only the first writing task shows =
  a pre-T76 build. A choose step before task 3 in an A2 mock = pre-T76 build.
- **Dev:** DB debug imports `a2-exam-fixture` / `a2-torfl-prompts-fixture`;
  «Delete exam fixture» removes them. `__DEV__` route `/dev-exam-capture`
  re-captures the A2 grading fixtures through the app's own AI path.

### 9.8 Dev tools

Settings → Developer → **DB debug**: import the `a1-exam-fixture` (a 5-subtest
mock + a drill set), `a1-torfl-lexicon-fixture` and `a1-torfl-prompts-fixture`
packs, start a dev attempt, read the exam readout (exams / attempts /
responses by grading status / deck counts), and **«Delete exam fixture»**
(every attempt + response + deck row + the three packs + `sync_state` +
staged dirs — the device-hygiene cleanup). The T73 device walk used
`?devDurationSec=45` for a full five-subtest mock in a few minutes.

## 10. FSRS optimizer (T39)

The app schedules with ts-fsrs's FSRS-6 default weights. This section fits
the 21 weights to **your own** review history, offline, on the Mac. The
fitter is the official fsrs-rs binding (`@open-spaced-repetition/binding`
0.5.0, pinned in `apps/mobile`), driven by `apps/mobile/scripts/fsrs-optimize.mjs`
(logic in `fsrs-optimize-core.mjs`, tests in
`src/features/review/__tests__/fsrs-optimize-core.test.ts`). Nothing runs on
the phone; the phone only imports numbers. Only numbers leave the Mac: the
output file has no lemmas or text.

### 10.1 Procedure

1. **Get the review history.**
   - **Route A (preferred, no cable tricks).** On the phone: Settings →
     Scheduling → **«Export review history»**. It writes
     `sumrak-review-log-<date>.json` into the app's backup folder (the SAF
     backup directory). Copy that file to the Mac (e.g. `~/Downloads/`).
   - **Route B (dev only, debuggable build).** Pull the DB:
     ```
     adb shell am force-stop io.winapps.sumrak
     adb exec-out run-as io.winapps.sumrak cat files/SQLite/sumrak.db > sumrak.db
     adb exec-out run-as io.winapps.sumrak cat files/SQLite/sumrak.db-wal > sumrak.db-wal
     adb exec-out run-as io.winapps.sumrak cat files/SQLite/sumrak.db-shm > sumrak.db-shm
     cp sumrak.db sumrak-copy.db && cp sumrak.db-wal sumrak-copy.db-wal
     sqlite3 sumrak-copy.db 'PRAGMA wal_checkpoint(TRUNCATE)'
     ```
     Checkpoint a **copy** so the pulled original stays untouched. `run-as`
     is refused on the release build; use Route A there. Route B reads the
     DB directly and needs no export file (the timezone defaults to this
     Mac's).
2. **Run the optimizer** from the app directory:
   ```
   cd apps/mobile && node scripts/fsrs-optimize.mjs ~/Downloads/sumrak-review-log-<date>.json
   ```
   Options: `--out <file>` (default `fsrs-params-<YYYY-MM-DD>.json` in the
   current directory), `--tz America/Denver` (default: the export's timezone,
   else this Mac's), `--next-day-hour 4` (the day boundary, default 4 am).
   For Route B: `node scripts/fsrs-optimize.mjs sumrak-copy.db`.
3. **Read the summary.** The fitted log loss should be **≤ the default log
   loss**; the script prints a note if it is not, and in that case choose
   «Revert to defaults» (step 5) rather than importing. If a
   `WARNING: Only N reviews …` line prints (fewer than 1000 reviews), the
   result is still written but may overfit; consider waiting until more
   reviews exist and re-running. Exit code 2 means not enough data: nothing
   is written.
4. **Import.** Settings → Scheduling → Optimizer → **«Import parameters»** →
   paste the **whole** JSON file (the one line the script prints last, or
   the file's contents) → **Apply**. The row then reads «Optimized · <date>
   · N reviews».
5. **Revert.** Settings → Scheduling → Optimizer → the same row → **«Revert to
   defaults»**.

### 10.2 Notes

- Changing the parameters or the retention target affects **future**
  scheduling only. Each card reschedules at its **next** review; no reset is
  needed.
- Re-run roughly **monthly**, once the history has grown.
- The file contains only numbers (`v`, `kind`, 21 weights, and loss / count
  summaries); no lemmas, no review text.
- Weights are checked against ts-fsrs's own bounds before the file is
  written, so an out-of-range fit fails loudly instead of being written.
