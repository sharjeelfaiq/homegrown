# Hyperframes Composition Brief: Homegrown

## Objective
A 60-second, dark, cinematic launch film for Homegrown, a private voice-cloning studio that runs on the user's own GPU, built from the user's real screen recording, with narration and the real cloned-voice output audible.

## Output
- Composition directory: `composition/`
- Rendered video: `brag.mp4`
- Format: landscape, 1920x1080, 30fps
- Duration: 60s (user override of the 15-25s default)

## Source Material
- Project root: `D:/code/websites/homegrown` (apps/studio = the Studio UI)
- Primary files read: `apps/studio/src/styles/tokens.css`, `public/favicon.svg` (brand mark), `CLAUDE.md`, Studio components (ClonedVoicesSection, HistoryList, SettingsModal)
- Footage: `assets/footage/studio.mp4`, the user's 254.5s screen recording, re-encoded silent (1678x892, GOP 15) with the real celebrity name masked as "Narrator" and the toast filename as "narrator.mp3"
- Cloned-voice output (real generated files from local storage): `assets/audio/cloned-voice-1.mp3` (first voice, "My VO"), `assets/audio/cloned-voice-2.mp3` (second voice, "Voiceover 2"); same script
- Narration: `assets/vo/line-1..8.wav`, Kokoro af_heart
- Product name: Homegrown
- Strongest claim: runs entirely on your own GPU (UI shows `NVIDIA GeForce GTX 970 · Active`)
- Key UI to show: empty-card Clone voice CTA + prerequisite checklist, cloning toast, Script editor + language menu + Generate, amber progress bar, cyan playback scrubber, live theme switching, mascot
- Copy that must appear verbatim: "Clone voice", "NVIDIA GeForce GTX 970", "Active"; the spoken cloned line "They think they've seen pain. They haven't. Not like mine. Not in the places where men go to disappear and never come back."

## Creative Direction
- Tone preset: cinematic
- Creative direction: dark cinematic trailer with narration, ~60s
- Interpretation: big Archivo caps, chapter titles, slow push-ins on real footage, dips through black between chapters, a calm narrator, and one scene where the narrator steps back and the cloned voice speaks for itself.
- Angle: privacy as the blockbuster: "Every voice tool wants your voice in the cloud. Homegrown keeps it home."
- Hook: four cyan waveform bars rise out of black; "YOUR VOICE." / "SOMEONE ELSE'S CLOUD." gets struck through.
- Outro / punchline: HOMEGROWN wordmark (dot-matrix, like the app header) + "Your voice never leaves home."
- Avoid: generic SaaS language, abstract filler, inventing numbers or features, showing the file picker or clipboard history, the real celebrity name.

## Visual Identity
- Background: #0d0e13 (deepest), #14151a (base)
- Text: #f5f6f8 primary, #a9adba muted
- Accent: #1cc5e3 (audio cyan), #80e3f4 (wordmark), #ffb43a (progress amber)
- Display font: Archivo Variable (`assets/fonts/archivo-variable.woff2`, @font-face)
- Body font: Inter (bundled); mono IBM Plex Mono (bundled)
- Visual references: the Studio's faint grid backdrop, the four-bar mark, the dot-matrix wordmark

## Storyboard (global seconds)
1. Hook 0-5: bars rise, two caps lines, strike-through. VO1.
2. Reveal 5-11: dimmed slow-mo empty Studio behind the mark + HOMEGROWN wordmark + "Private voice cloning. On your own GPU." VO2.
3. Clone 11-20: "01 / CLONE A VOICE"; CTA click, then cloning row → cloned + checklist tick. VO3.
4. Script 20-27: "02 / WRITE. CHOOSE. GENERATE."; script lands, English picked, Generate clicked (click SFX). VO4.
5. Generate 27-34: "03 / RENDERED ON YOUR GPU"; amber progress, GPU readout callout. VO5.
6. Play 34-43: "04 / HEAR IT"; playback footage left, the cloned voice plays (no narration) with its words set big on the right, phrase-synced.
7. Any voice 43-50: "ANY VOICE."; second clone + generation; VO6, then the second voice says the same opening line.
8. Make it yours 50-55.5: themes flipping live, backup panel, mascot; tags "9 THEMES" / "PASSWORD-PROTECTED BACKUPS" / "ONE VERY GOOD PET". VO7.
9. Outro 55.5-60: mark + wordmark + tagline. VO8, bell.

## Audio
- Audio role: cinematic support under narration; the cloned voice is the featured sound in scene 6
- Audio arc: quiet open → steady bed → near-silent bed under the cloned voice → lift into the outro → fade
- Music: `assets/music/bed.mp3` (happy-beats-business-moves-vol-12), darkened with a lowpass + light reverb
- Music treatment: volume lane ~0.3 between lines, ~0.13 under narration, ~0.07 under the cloned voice; fade in 1.2s, fade out 2s
- Music cue guidance: preset `happy-beats-business-moves-vol-12…music-cues.json`, 109.96 BPM; strong cue 8.74s near the wordmark; others ignored in favour of narration timing
- Audio-reactive treatment: none (narration-led; restraint)
- Audio-coupled moments: hook strike (bell), wordmark (soft impact), chapter dips (soft impact, low), Generate click (mouse click), outro slam (bell)
- SFX selection: impactBell_heavy_000/003, impactSoft_medium_000/002, ui/mouseclick1, all 0.35-0.6, never on top of spoken words
- Audio files: in `composition/assets/`

## Hyperframes Instructions
Contract followed from the `hyperframes` skill: one scene per sub-composition in `compositions/`, `fromTo` tweens, timelines registered per scene, silent footage `muted`, audio as separate `<audio>` with ids, root-relative asset paths. Run `hyperframes check` before render. Local render only.
