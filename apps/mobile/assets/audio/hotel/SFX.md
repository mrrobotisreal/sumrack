# Hotel lift SFX (T91)

Generated with the ElevenLabs Sound Effects API (`POST /v1/sound-generation`,
`prompt_influence: 0.5`) by `apps/mobile/scripts/hotel-sfx.mts`, 3 takes per
clip. Raw takes live outside the repo (`_sfx-takes/hotel/`, not committed).

**Take choice (by numbers, not by ear).** Every take of one clip came back at
the same length, so duration cannot separate them. Takes were ranked on
clipping (true peak > 0 dBFS is rejected) and on loudness distance from target.
For the drop, all three takes clip, so take 2 was chosen as the least-clipped
and then attenuated.

**Encode.** Ogg Opus in a `.opus` file (the repo bundles Opus under that extension; Metro `assetExts` lists `opus`), mono, 48 kHz, 96 kbps, libopus, `-application audio`.
Loudness normalised to −20 LUFS (the drop to −16 LUFS), using
`loudnorm=I=<target>:TP=-1.5:LRA=11`, except the drop (see below).
`lift-ride` has 80 ms fades at both ends so the loop is seamless enough.

| Clip | Prompt | Target s | Takes (LUFS I / peak dBFS) | Chosen | Out dur s | Out LUFS | Out peak dBFS |
|---|---|---|---|---|---|---|---|
| `lift-close` | old brass elevator doors sliding shut, heavy, 1930s hotel, metallic rumble | 1.2 | −12.8/+0.6, −11.5/+0.8, −14.2/−0.0 | take 3 | 1.21 | −20.7 | −2.9 |
| `lift-ride` | old elevator car humming and creaking while moving, cables, steady loop | 4.0 | −21.6/−3.4, −18.6/−1.0, −21.0/−4.7 | take 3 | 4.01 | −21.8 | −2.8 |
| `lift-ding` | single soft old elevator bell ding, brass | 1.2 | −35.4/−13.9, −33.6/−21.7, −31.1/−14.3 | take 3 | 1.21 | −21.6 | −4.7 |
| `lift-open` | old elevator doors sliding open, heavy brass, slight creak | 1.2 | −13.5/+0.2, −15.0/−0.7, −16.2/−1.3 | take 3 | 1.21 | −20.5 | −4.1 |
| `flicker` | fluorescent light buzzing and flickering, electrical tick | 0.8 | −13.3/−6.0, −13.8/−1.9, −12.9/−2.5 | take 2 | 0.81 | −20.0 | −9.6 |
| `drop` | elevator cable snapping, car free-falling with metal rattling, then a violent crash impact | 3.5 | −8.6/+1.7, −10.0/+1.3, −11.2/+2.5 | take 2 (−6 dB) | 3.51 | −17.0 | −2.3 |
| `lift-blocked` | dull mechanical clunk of a stuck elevator button | 0.5 | −37.7/−22.0, −47.2/−32.8, −34.8/−17.5 | take 3 | 0.49 | −20.0 | −0.4 |

Notes:
- `lift-blocked` and `lift-ding` came out quiet at source (−31 to −47 LUFS). `loudnorm` brought them to target, and the sample peaks stay below 0 dBFS.
- `drop` is −17.0 LUFS, not −16. Attenuating the source by 6 dB and encoding without loudnorm avoided the overshoot that loudnorm showed on this clip. It is 1 LU off target, still clean (−2.3 dBFS peak).
- Total size of the seven `.opus` files: about 160 KB (limit 400 KB).

**Ear-check: OPEN for Mitch.** Listen to every clip on the S24U or S25 and
reject any take that sounds wrong. Regenerate under the ElevenLabs lock if
needed.

## Mitch's ear-check (2026-10-17) — CLOSED

Mitch listened to every raw take in `_sfx-takes/hotel/` and chose the takes below. These replace the by-the-numbers picks above. The encode chain is unchanged (mono 48 kHz Opus 96 k).

| Clip | Mitch's take | Out LUFS | Out peak dBFS | Note |
|---|---|---|---|---|
| `drop` | drop-1 | −16.0 | −2.7 | −6.5 dB gain, no loudnorm (as before) |
| `flicker` | flicker-1 | −20.1 | −8.7 | |
| `lift-blocked` | lift-blocked-3 | −20.0 | −0.4 | same take as before |
| `lift-close` | lift-close-2 | −21.3 | −5.8 | |
| `lift-ding` | lift-ding-1 | −24.8 | −2.1 | loudnorm −21 + limiter; this take is a soft bell, so it reads quieter by design |
| `lift-open` | lift-open-3 | −20.5 | −4.0 | same take as before |
| `lift-ride` | lift-ride-2 | −21.9 | −0.8 | 80 ms loop fades + limiter |
