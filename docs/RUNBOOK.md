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
design (Claude Haiku 4.5 · Sonnet 5 · Opus 5.5 · Fable 5.1 and GPT-6 Luna ·
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
