# Hyperframes Composition Brief: Homegrown

## Objective
Create a short launch-style brag video for Homegrown, built from the real cyan-theme Studio screenshots.

## Output
- Composition directory: `brag-output-2026-10-22-174513/composition/`
- Rendered video: `brag-output-2026-10-22-174513/brag.mp4`
- Format: landscape, 1920x1080
- Duration: 24 seconds

## Source Material
- Project root: `D:\code\websites\homegrown`
- Primary files read: `README.md`, `CLAUDE.md`, `apps/marketing/index.html`, `apps/studio/src/features/onboarding/useOnboardingTour.ts`, `services/voice-api/homegrown_api/routes/{health,queue}.py`, the previous `brag-output/` plan and composition
- Product name: Homegrown
- Tagline / strongest claim: "Make recurring voiceovers with a voice that stays yours."
- Key UI moment: the Script editor footer (Select language -> English -> Generate), the amber running and Queued rows, the Voiceovers filter popover
- Copy that must appear verbatim:
  - Make recurring voiceovers with a voice that stays yours.
  - No account. No subscription. No hosted service.

## Creative Direction
- Tone preset: polished
- Creative direction: calm, product-led, App-Store-clean motion; no jokes
- Interpretation: long holds, soft crossfades, camera push-ins over real screenshots, narration that complements instead of reads.
- Hook: wordmark push-in with the headline held about 3s
- Outro / punchline: three "No ..." lines, then the wordmark, tagline, and "$69 · one-time · lifetime usage"
- Avoid: generic SaaS language, abstract filler, redrawn UI, and any real names or dates from the screenshots.

## Visual Identity
- Background: #0d0e12; text #f5f6f8; accent #6ee0f2 / #1cc5e3; amber for running work
- Display font: Archivo; body Inter; mono IBM Plex Mono
- Visual references: the dotted wordmark, the two-column Studio, the cyan theme

## Storyboard
See `brag-plan.md`. Scene summary:
1. Hook, 3.82s: wordmark and headline
2. Voices, 4.92s: Clone voice and the selected row
3. Script and language, 4.37s: Select language, the menu, English, Generate
4. Generate and queue, 4.36s: running row, Queued row with reorder arrows and Cancel
5. Voiceovers, 3.28s: search and filter popover
6. Outro, 3.25s

## Audio
- Audio role: sparse professional accents under a quiet bed, with Kokoro narration (generic voice af_heart; not Homegrown output)
- Audio arc: low bed with narration lines at each scene; soft accents on actions; a bong on the wordmark; bed fades out over 1.6s
- Music: `assets/music/bed.mp3` (happy-beats-business-moves-vol-12 by ende.app, bundled with the brag skill)
- Music treatment: volume 0.16 under narration
- Music cue guidance: bundled preset `happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (109.96 BPM); strong cues 8.74, 13.11, 17.47, 22.93
- Audio-reactive treatment: none (documented skip)
- Audio-coupled moments: English selection, Generate click, running and queued rows appearing, the wordmark
- SFX selection guidance: low high-frequency-risk files only (select_008, click_003, drop_001, drop_002, bong_001)
- Audio files: copied into `composition/assets/`

## Hyperframes Instructions
Use the hyperframes domain skills; /brag is its own workflow. Run `hyperframes check` (zero errors) before render. Keep creation and rendering local.
