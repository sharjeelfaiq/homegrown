# Brag Plan: Homegrown

## What is this app?
Homegrown is a private voice-cloning and voiceover studio that runs entirely on your own machine and GPU: clone a voice from one audio clip, write a script, pick a language, and generate narration locally, with no accounts and no cloud.

## The angle
Trailer-scale privacy. Every other voice tool wants your voice in someone else's cloud; Homegrown grows it at home. The video treats "it runs on my graphics card" as the blockbuster reveal, then proves it with the real app doing the whole flow: clone, script, generate, play.

## Hook (first 2-3 seconds)
Black screen. Four cyan waveform bars (the Homegrown mark) breathe up out of the dark while big Archivo caps slam in: **YOUR VOICE.** then **SOMEONE ELSE'S CLOUD.** with the second line struck through. A low bell hit lands on the strike.

## Key moments (the middle)
- The Clone voice CTA in the empty card gets clicked; a cloning row spins amber, then lands, and the empty-card checklist ticks its first green check.
- A full monologue drops into the Script editor, English is chosen from the language menu, Generate is clicked.
- The amber progress bar crawls across the new voiceover row while the left gutter reads `NVIDIA GeForce GTX 970 · Active`: it is rendering on the user's own GPU.
- "Voiceover ready" and playback: seekable transport, download button.
- Quick-cut montage: a second voice cloned, the app flipping live through themes (Tide, Tape, Daylight, Booth), the pet mascot cycling animals and being dragged.

## Outro / punchline
HOMEGROWN wordmark slams in full-screen over the mark. Tagline: **Your voice never leaves home.** Bell swell; music resolves.

## User flow worth showing
Empty studio, then Clone a voice from one file (entry), then script + language + Generate with live GPU progress (key action), then playback of the finished voiceover (result).

## Tone
- Preset: cinematic
- Creative direction: dark cinematic launch trailer, ~60s, with narration (user-provided)
- Interpretation: big caps type, short declarative narration lines with breathing room, slow scale-in on footage, dramatic wipes between chapters; restraint over flash.

## Format: landscape, 1920x1080, 30fps
## Duration: 60 seconds (user override of the usual 15-25s window)

## Visual identity (from the project)
- Background: #0d0e13 (bg-deepest) / #14151a (bg-base); cards #1d1f28
- Accent: #1cc5e3 (accent-2, audio cyan); #80e3f4 (accent, wordmark); #ffb43a (progress amber)
- Text: #f5f6f8 primary, #a9adba muted
- Display font: Archivo Variable
- Body font: Inter; mono IBM Plex Mono
- Strongest visual element: the four-bar waveform mark and the real Studio UI (amber progress bar, cyan playback scrubber)

## Source material
- Primary footage: user's screen recording `work/demo.mp4` (1678x892, 254.5s). Cut points:
  - 0.5-2.6s CTA click; 9.0-15.5s cloning row, "voice cloned", checklist check
  - 22.0-29.5s script pasted, English chosen, Generate clicked (skip 21-22s: Windows clipboard history is on screen)
  - 30-44s generation progress and rename
  - 77-84.5s finishing, "Voiceover ready", playback (skip 85-88s: browser downloads panel)
  - ~97-112s second voice cloned and generating
  - 180.0-185.5s live theme cycling; 196-207s mascot cycling and drag
- Privacy substitutions (must apply): the first cloned voice is labeled with a real celebrity's name. Mask that label everywhere it appears (voice row, "Selected:", "Generating:", cloning toast) with a fictional stand-in, **"Narrator"**. Do not show the file picker (its filenames are personal). Do not use the recording's audio track (it contains the cloned real person's voice).

## Share copy (draft)
Homegrown. Private voice cloning that runs on your own GPU: clone a voice from one clip, generate voiceovers, and nothing ever leaves your machine.

## Audio direction
- Role: cinematic support under narration
- Music: happy-beats-business-moves-vol-12 (steady, clean, ~110 BPM), the cinematic pick from the bundled set
- Music treatment: fade in under the hook, sit at ~0.30 and duck to ~0.13 while narration speaks, lift between lines and into the outro, 2s fade-out at the end
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (tempo 109.96 BPM, beat ~0.546s). Strong cues in window: 8.74s (wordmark reveal), 17.47s / 22.93s (chapter wipes). Cues beyond 25s are to be derived from the beat grid / detected at composition time. Restraint: lock at most 3 major moments.
- Audio-reactive treatment: subtle; music RMS breathes the waveform-mark glow and the footage frame's cyan edge light. No waveform/equalizer visuals.
- SFX posture: sparse, cinematic. Bell on the hook strike and the outro slam, soft impacts on chapter wipes, one click on the Generate moment.
- Audio-coupled moments: hook strike-through, chapter title wipes, Generate click, outro slam.
- Restraint rule: no SFX under narration words; nothing harsh; never above music+voice.

## Voiceover script
Narrator: calm, low, unhurried (Kokoro default voice). Each line lands, then breathes.

1. (0.6s) Every voice tool wants your voice in the cloud.
2. (5.5s) Homegrown keeps it home. A voice studio that runs entirely on your own GPU.
3. (12s) Give it one short clip, and it learns the voice. Right there, on your machine.
4. (21.5s) Write your script. Choose a language. Press generate.
5. (29.5s) Then watch it render, on your own graphics card.
6. (37.5s) Play it back. Rename it. Download it. It's yours.
7. (44.5s) Clone as many voices as you need.
8. (49.5s) Nine themes. Password-protected backups. And yes, a pet.
9. (55.5s) Homegrown. Your voice never leaves home.

## Storyboard

### Scene 1 — Hook — 5s (0-5)
Black (#0d0e13). The four-bar mark rises bar by bar in cyan, then big caps: "YOUR VOICE." then "SOMEONE ELSE'S CLOUD." A cyan strike line draws through the second line.
Sequential/interaction: yes, bars rise one by one; lines enter one after another; strike draws left to right. Each line holds >= 1.2s.
Audio intent: tension, low and quiet. VO line 1.
Audio-coupled idea: bell on the strike.
Music: fades in from silence.
Transition mood: dramatic wipe → Scene 2

### Scene 2 — Reveal — 6s (5-11)
HOMEGROWN wordmark (accent #80e3f4, wide tracking) scales from 0.95 to 1.0 beside the mark; subline: "Private voice cloning. On your own GPU." Behind it, the empty Studio footage fades in, dimmed and blurred.
Sequential/interaction: wordmark first, subline 0.6s later; both hold to the end.
Audio intent: arrival. VO line 2.
Audio-coupled idea: soft impact on the wordmark (near strong cue 8.74s).
Transition mood: dramatic wipe → Scene 3

### Scene 3 — Clone a voice — 10s (11-21)
Chapter chip "01 / CLONE A VOICE". Real footage: cursor clicks the centered Clone voice CTA in the empty card; jump cut to the amber cloning row, the "voice cloned" toast, and the empty-voiceovers checklist ticking "Clone a voice" green. Slow push-in toward the voices card, then toward the checklist. Name mask "Narrator" applied.
Sequential/interaction: real click + real checklist tick.
Audio intent: discovery. VO line 3.
Transition mood: wipe → Scene 4

### Scene 4 — Script + language — 8s (21-29)
Chip "02 / WRITE. CHOOSE. GENERATE." Footage: the monologue appears in the Script editor, the language menu opens and English is picked, cursor clicks Generate. Push-in toward the editor footer.
Sequential/interaction: real menu open + Generate click.
Audio intent: momentum. VO line 4.
Audio-coupled idea: one click SFX on Generate.
Transition mood: hard-ish wipe → Scene 5

### Scene 5 — Generate on your GPU — 8s (29-37)
Chip "03 / RENDERED ON YOUR GPU". Footage (sped ~1.8x): the amber progress bar fills on the new voiceover row. A callout pulls the left-gutter readout into frame: "NVIDIA GeForce GTX 970 · Active".
Sequential/interaction: progress bar filling; callout slides in.
Audio intent: power, steady. VO line 5.
Transition mood: wipe → Scene 6

### Scene 6 — Play it — 7s (37-44)
Chip "04 / YOURS TO KEEP". Footage: progress completes, "Voiceover ready", the cyan scrubber plays and is scrubbed; download and menu buttons visible. Push-in on the voiceover row.
Sequential/interaction: real playback scrub.
Audio intent: payoff, music lifts slightly between VO phrases. VO line 6.
Transition mood: dramatic wipe → Scene 7

### Scene 7 — Any voice — 5s (44-49)
Big caps "ANY VOICE." over footage of a second voice being cloned and generating (sped ~3x), two rows in the Voices card.
Sequential/interaction: second row arrives.
Audio intent: expansion. VO line 7.
Transition mood: fast wipe → Scene 8

### Scene 8 — Make it yours — 6s (49-55)
Quick cuts: the whole app flips live through themes (dark navy, cream Tape, white Daylight, back to dark); then the pet mascot cycles animals and is dragged across the Studio. Three caption tags arrive one by one and hold together: "9 THEMES" · "PASSWORD-PROTECTED BACKUPS" · "ONE VERY GOOD PET".
Sequential/interaction: tags one by one (each >= 0.8s before the next), then hold all three.
Audio intent: playful lift. VO line 8.
Transition mood: dip to black → Scene 9

### Scene 9 — Outro — 5s (55-60)
Full-screen HOMEGROWN wordmark slams in over the mark (scale 1.08 to 1.0), tagline below: "Your voice never leaves home." Holds; music swells and fades out.
Sequential/interaction: wordmark, then tagline 0.5s later.
Audio intent: resolve. VO line 9. Bell on the slam.
Transition mood: end card.

**Music mood for this video:** cinematic
**Audio summary:** a quiet tense open that blooms into a steady cinematic bed, ducked under a calm narrator, punctuated by a few bell/impact hits on chapter turns and resolving under the final wordmark.
