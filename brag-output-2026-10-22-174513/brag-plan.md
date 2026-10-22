# Brag Plan: Homegrown (v3: cyan theme, language selector, queue, filters, narration)

## What is this app?
Homegrown is a local Windows Studio that clones a voice from a reference clip and generates voiceovers from a script, with no account, subscription, or hosted service.

## The angle
A quiet, product-led walkthrough of the real Studio using the real screenshots. Each step is a state the app actually shows: pick a voice, write a script and explicitly choose a language, generate, watch the queue, then search and filter the history. The close is the product's own promise, "No account. No subscription. No hosted service."

## Hook (first 2-3 seconds)
The real dotted HOMEGROWN wordmark, a slow push-in, and the marketing headline held about 3 seconds: "Make recurring voiceovers with a voice that stays yours."

## Key moments (the middle)
- Voices card: rings on **Clone voice**, then the selected voice row.
- Script editor footer: **Select language** -> the language menu -> English -> **Generate**.
- Voiceovers: the amber running row, then the **Queued** row with reorder arrows and Cancel.
- Voiceovers filter popover: Voice, Date range, Duration, Generation status.

## Outro / punchline
"No account. No subscription. No hosted service." then the wordmark, "Local voice generation for Windows", and the price line "$69 · one-time · lifetime usage".

## User flow worth showing
Entry (choose a voice) -> key action (write a script, choose a language, Generate) -> result (queue, then history with search and filters).

## Tone
- Preset: polished
- Creative direction: calm, product-led, App-Store-clean motion; no jokes
- Interpretation: four long holds, soft crossfades and camera pushes, one narration line per scene, very sparse SFX.

## Format: landscape - 1920x1080
## Duration: 25s (target 24; extended 1s so the closing lockup holds about 2s)

## Visual identity (from the project and the screenshots)
- Background: #0d0e12 (near-black with a faint grid); marketing page uses #14151a
- Accent: #6ee0f2 / #1cc5e3 (the cyan theme in the screenshots); amber for running work
- Text: #f5f6f8
- Display font: Archivo (marketing page); body Inter; mono IBM Plex Mono
- Strongest visual element: the particle-dot HOMEGROWN wordmark

## Share copy (draft)
Introducing Homegrown: clone a voice and generate voiceovers locally on your Windows PC. No account, subscription, or hosted service.

## Imagery provenance
All product imagery is the user's real cyan-theme Studio screenshots (1680x899), used as a camera-moved image layer. Redrawn pixels (the only edits):
- Voice names (3 rows, all scenes): replaced with fictional "Narrator", "Podcast Intro", "Studio Voice". Originals were personal-looking sample names.
- Script text (editor and the voiceover row previews): replaced with a neutral 47-word podcast welcome; the word counter reads "47 words". Originals quoted a third party's YouTube earnings claim.
- Timestamps: replaced with plain times (e.g. "09:14 AM"); the original dates and times are gone.
- Rings, captions, and the outro are overlays/typography, not UI redraws.
No scene uses a UI redrawn in HTML. No live capture was made. The screenshots were already captured; fresh capture would have required seeding the user's running app. The earlier blue/amber screenshots are not used, so one theme appears throughout.
Sanitized copies only are in `composition/assets/shots/`. Originals stay in `D:\downloads`.

## Verified claims
| On-screen or spoken | Source |
|---|---|
| "Make recurring voiceovers with a voice that stays yours." | `apps/marketing/index.html` hero h1 |
| "Choose or add a voice." / "Clone voice, or drop audio files here." | Onboarding tour "Choose or add a voice" (`useOnboardingTour.ts`: "use Clone voice or drop multiple audio files here") |
| "Write the script." / "Choose its language in the footer." | Tour "Write the script" ("Choose its language in the footer") |
| Select language -> language menu -> English -> Generate | Screenshots; README/CLAUDE.md: generation requires an explicitly selected script language |
| "Generate a voiceover." / "Extra requests join the generation queue." | Tour "Generate a voiceover" |
| Running row, Queued row, reorder arrows, Cancel | Screenshot; `routes/queue.py` (`POST /api/queue/reorder`); tour: "cancel queued jobs there" |
| "Search and filter." / voice, date, duration, status | Tour "Search and filter voiceovers" ("voice, date range, duration, or generation status") |
| "No account. No subscription. No hosted service." | Marketing page hero |
| "Local voice generation for Windows" | Previous video / marketing page positioning ("local voiceovers for Windows") |
| "$69 · one-time · lifetime usage" | Marketing page hero chip and JSON-LD offer. No refund, update, or support terms are claimed. |
| Narration: "Pick a cloned voice, or add a new one." | Tour (voices; cloned voices only appear in the Voices card per CLAUDE.md) |
| Narration: "choose the language yourself" | CLAUDE.md: language selection is explicit; Generate requires it |
| Narration: "line up in the queue ... reorder or cancel" | Tour + `routes/queue.py` |
| Narration: "searchable and ready to reuse" | Tour ("Search by voiceover or voice name", "Reuse restores the script, voice, and language") |
| Narration: "on your own computer" | README/marketing: runs locally, no hosted service |
Language count: the repo does not hardcode one. `/api/languages` is read from the loaded checkpoint's `codec_language_id` (`routes/health.py`), and the API was not running here. The screenshot menu shows ten entries (Chinese ... Spanish), but no number is stated in the video.

## Voiceover script (Kokoro af_heart, generic voice, not Homegrown output)
1. (hook) "Meet Homegrown."
2. (voices) "Pick a cloned voice, or add a new one."
3. (script and language) "Write the script, then choose the language yourself."
4. (generate) "Generate. Extra requests line up in the queue, and you can reorder or cancel."
5. (voiceovers) "Every result lands in your history, searchable and ready to reuse."
6. (outro) "All of it, on your own computer."

## Storyboard
| Time | Scene | Image | Text on screen |
|---|---|---|---|
| 0-3.82 | Hook: push toward the wordmark | s1 | Headline (held ~3s) |
| 3.82-8.74 | Voices: Clone voice, selected row | s1 | "Choose or add a voice." |
| 8.74-13.11 | Select language -> menu -> English -> Generate | s1 -> s3 -> s2 | "Write the script." |
| 13.11-17.47 | Running row, then Queued row (arrows, Cancel) | s6 | "Generate a voiceover." |
| 17.47-20.75 | Voiceovers search and filter popover | s4 | "Search and filter." |
| 20.75-25 | Outro | none | three "No ..." lines, wordmark, tagline, price |

Sequential/interaction: ring highlights follow the actions in order; the Outro lines arrive on consecutive beats (0.5s apart, held ~2s together before the wordmark).

## Audio direction
- Role: sparse professional accents under a quiet bed, with narration on top.
- Music: happy-beats-business-moves-vol-12 (polished preset), volume 0.16 under narration, fade in 0.6s, fade out 1.6s.
- Music cue guidance: preset read (109.96 BPM). Scene cuts land on the beat grid: 3.82, 8.74 (strong), 13.11 (strong), 17.47 (strong). The outro lines use beats 20.75, 21.28, 21.84; the wordmark is locked to the strong cue 22.93.
- Audio-reactive treatment: none. Documented skip: static screenshots, and this tone calls for restraint.
- SFX posture: sparse, motion-matched: select at the English choice, soft click at Generate, drops when the running and queued rows are highlighted, a soft bong on the wordmark.
- Restraint rule: nothing aggressive; narration stays clearly above the music.

## Check result
`hyperframes check`: 0 errors. Accepted warnings: two `nested_structure_needs_subcomposition` (single-file composition; the camera layer must stay one element); the closing price line is on screen 2.0s or just under the 2s floor.
