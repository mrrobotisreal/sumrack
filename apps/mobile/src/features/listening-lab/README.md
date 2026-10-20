# Listening lab pilot (T110)

`/listening-lab` lists 20 clips; `/listening-lab/[segmentId]` offers independent Listen, Meaning, Dictate, Compare, Shadow and Retell stages. Extend the existing Sumrak Android theme. Voice comparison and retelling are self-review, never an acoustic/AI score. No FSRS writes.

## Source and review ledger

`catalog.json` v1 contains the exact published text, English gloss, meaning key, pack version, story/sentence/track/file references, full selected sentence token stamps, spoiler boundary, explicit ё policy and reviewed ending substitutions per clip.

| Clips         | Source                 | Version | Selected stories and sentences           | Source/text/key review                                                                        | Human ear check |
| ------------- | ---------------------- | ------- | ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| lab-01–lab-10 | a1-torfl-listening-001 | 3       | ls-01…ls-10, first sentence tfa1lsNN-s01 | 2026-10-20, Codex: source text and authored meaning keys inspected; exact source audit passed | Pending T111    |
| lab-11–lab-20 | a2-torfl-listening-001 | 3       | ls-01…ls-10, first sentence tfa2lsNN-s01 | 2026-10-20, Codex: source text and authored meaning keys inspected; exact source audit passed | Pending T111    |

These are published everyday study dialogues, not mock/reserved exam passages. The schema allows only these two pack ids. Each clip starts at track start and ends after the first complete sentence block, before the next sentence's first stamp. The read-only validator checks complete spoken-token coverage, exact text/stamps/track/version, file existence and absence of neighbouring-word overlap. This is a mechanical boundary check, not a listening review. No source pack was edited or media downloaded.

Run with an existing content checkout:

```sh
node apps/mobile/src/features/listening-lab/scripts/validate-published.mjs /absolute/path/to/sumrak-content/packs
```

Runtime resolution rejects changed versions/text/timing, missing packs and unavailable local audio, with no synthetic replacement. Isolated-word Piper behavior is untouched.

## Grading, help and exposure

The comparator aligns words by edit distance; it reports missing/extra/wrong words, possible single-letter spelling errors, and only explicitly authored ending substitutions as ending errors. It ignores capitalization, stress marks and punctuation. Clips 05, 06 and 19 require ё; the others explicitly accept е/ё. Meaning feedback counts as help for later stages. Each first graded response stores its own assistance snapshot; later replay/reveal cannot rewrite it.

`firstLabListen` means exactly one normal play in the first saved lab attempt, without help/transcript. `firstListen` additionally requires known prior exposure; runtime `exposureKnown` is false because other TORFL/reading exposure cannot be established. UI says earlier exposure is unknown. This is practice evidence, not an unfamiliar-listening proficiency claim.

## Persistence and audio

A Zod-validated AsyncStorage draft per segment preserves typed work, selected stage and grading snapshots on this device. Draft writes are serialized; failures are shown. A single completed `game_sessions` row (`mode: listening-lab`) persists text, provenance, assistance and self-review. The complete row is built once before insertion and retained for exact idempotent retries. If a crash leaves a draft after successful insertion, reopening detects the final id. Existing backup serialization is exercised by a DB export/restore test. No schema, settings registry or account-sync code changed.

Recording reuses the existing native recorder and microphone permission API. The lab copies only its latest take to its own cache file, deletes replaced takes and cleans the take on exit. No recording path enters persistent attempts. Copy states explicitly that takes are temporary and do not sync or restore; type the retelling to retain the words. App backgrounding, navigation blur, cancellation, permission denial and late focus/seek/start results release audio resources without clearing typed work. Native audio-focus behavior, actual timing/ear quality and accessibility/device interaction remain T111.

## Verification

Focused tests cover catalog restrictions/staleness, ё/word alignment/endings, first-listen/help snapshots, local draft recovery/order, audio cancellation/error/focus seams and completed backup round-trip without FSRS writes. Native rendering and microphone/audio measurements are deferred; no device was used.
