# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Homegrown: a local/LAN voice-cloning dashboard around a **vendored** `FasterQwen3TTS`
(Qwen3-TTS-12Hz-0.6B) wrapper. Users create named voice presets from a short reference clip, batch-submit
scripts, and get generated `.mp3` back through a queue + history UI. No accounts, no billing — `auth.py`'s
`get_current_user` is a stub that returns the constant `"local-user"` for every request, and every stored
record carries that as `user_id`.

## Commands

There is **no test suite** in this repo — no pytest, no vitest, no test files. Verification is manual
(browser flow) or by running the backend against the real model. Don't claim tests pass; there are none to
run.

```bash
# Both dev processes at once, from the repo root -- preflights the venv and both
# env files, tails both logs, waits for /api/health, stops both on Ctrl-C.
bash dev.sh

# ...or the same two processes by hand, in two terminals:
# Backend dev (loads the model on startup; needs CUDA + backend/.env with MODEL_PATH)
cd backend && python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Frontend dev -- reachable from other devices at http://<this-PC's-LAN-IP>:5173.
# frontend/.env.local should set NOTHING; vite.config.ts proxies /api, /audio and /refs.
cd frontend && npm run dev          # http://localhost:5173

cd frontend && npm run lint         # oxlint (see .oxlintrc.json)
cd frontend && npm run build        # tsc -b && vite build -> frontend/dist  (this is the typecheck too)
```

**LAN / single-port mode** (what the office deployment actually uses): `cd frontend && npm run build`, then
run `start_server.bat` from the repo root — it activates the repo-root `.venv` and serves API + built
frontend from one uvicorn process on `0.0.0.0:8000`. `start_server_silent.vbs` is the same thing with no
console window (for Task Scheduler auto-start).

**Rebuild the Windows installer** (order matters — `backend.spec` hard-fails if `frontend/dist` is missing):

```bash
cd frontend && npm install && npm run build && cd ..
cd backend && pyinstaller backend.spec --clean --noconfirm && cd ..
cd launcher && pyinstaller launcher.spec --clean --noconfirm && cd ..
cd installer && makensis setup.nsi && cd ..
```

## Architecture

### Request path

```
Browser --> FastAPI (backend/main.py, one process, :8000)
              |-- /api/*        REST
              |-- /audio, /refs StaticFiles mounts (generated clips, reference clips)
              |-- catch-all     serves frontend/dist (registered LAST so /api never gets shadowed)
              |-- _worker_loop  single daemon thread -> FasterQwen3TTS -> GPU
              |-- storage/*.json  presets / history / queue (flat files, FileLock'd, gitignored)
```

`backend/main.py` (~1100 lines) is the whole backend — jobs, queue, timing estimates, RunPod idle-stop,
routes. The other backend modules are small and single-purpose (`text_chunker`, `audio_stitcher`,
`audio_convert`, `auth`).

### Generation pipeline — why it's chunked

`max_seq_len=1024` bounds one CUDA-graphed generation call. Past that, audio doesn't just stop — quality
collapses. **The mechanism is unverified**: this used to say "rope positions extrapolate out of validated
range", but the model config allows `max_position_embeddings: 65536` (32768 for the talker), so rope
extrapolation cannot be it at a 1024 window. The *effect* is measured and reliable; the cause is not
established. Either way, long scripts are split, never streamed as one call:

```
text -> chunk_text(_seq_budget(preset)) -> per-chunk generate (fresh KV cache each) -> stitch_audio(200ms gap) -> write_mp3
```

The chunk size is **not** the static `CHUNK_MAX_CHARS=800` — that value is only the ceiling, and it was
calibrated for a ~3.5s reference clip. The reference and the script share one `max_seq_len` window, so
`_seq_budget()` in `main.py` derives the per-chunk char budget (and `max_new_tokens`) from what the
preset's clip actually leaves: `available = MAX_SEQ_LEN - margin - ref_frames - ref_text_tokens`. A 53.5s
clip costs ~860 of 1024 positions on its own. When the clip leaves less than `MIN_GEN_FRAMES`,
`/api/generate` rejects the job rather than emitting garbage.

Three things that were each learned the hard way, all measured on this machine:

- **Speaking rate is per-preset, not a constant.** `len(ref_text) / clip_duration` — two real presets
  measured 14.4 and 11.2 chars/sec. A hardcoded rate starves the slower voice and truncates its chunks.
- **Chunk size has a sweet spot and fails in BOTH directions.** Same text, produced vs expected:
  380 chars → 89% (clauses silently dropped), 190 → 95%, 110 → 151% (padded, murmuring). Hence
  `ELISION_SAFE_CHUNK_CHARS` as a second ceiling, and a warning below `PADDING_SAFE_MIN_CHARS` where the
  real fix is a shorter reference clip. The original "murmur and long silence" reports were the low end.
- **`max_new_tokens` must be per chunk, not per job** (`_chunk_token_cap()`). Sized from the largest chunk,
  a short final chunk gets the whole allowance and babbles to the cap — observed as 33s of unintelligible
  audio appended to a finished 82s read. Headroom there is additive (`_CHUNK_CAP_HEADROOM_FRAMES`), not a
  percentage: pauses from `...` don't scale with character count, and a proportional cap cut the last line.

- **`chunk_text` balances chunk sizes; it is not greedy.** Greedy packing leaves the last chunk holding the
  remainder (one script gave `[138, 164, 188, 174, 195, 186, 75]`), and that runt is the chunk that sits
  near its frame cap, drops its closing words and murmurs. `_pack()` runs a partition DP over the same
  chunk count greedy would use, so count never rises and `max_chars` is never exceeded — only boundaries
  move. Packing to a smaller limit does NOT achieve this: greedy at any limit below 195 gave nine chunks
  instead of seven. Removing the runt took total silence from 16.2s to 0.0s on the test script.

- **Chunks degenerated stochastically, so bad samples are detected and regenerated — but the degeneration
  has since stopped reproducing.** Read both halves of this; the second does not cancel the first.

  *Originally measured (pre-`_seq_budget`):* the same chunk with identical settings produced 115%, 105%,
  233%, 177%, 96% and 94% of its expected duration across six runs — roughly a third of samples babbled
  (including sentences nowhere in the script) or stopped short. Punctuation was not the trigger: stripping
  markdown and smart quotes changed nothing. No parameter fixed a coin flip, so `_process_job` checks each
  chunk against `_chunk_duration_is_sane()` and resamples outside 0.6–1.6× expected, up to
  `CHUNK_ATTEMPTS`.

  *Re-measured 2026-09-09, current code:* it did not happen. 8 runs of a 618-char, 4-chunk script on a
  16.1s-clip preset (`chunk_chars: 200`) gave **32/32 clean chunks and zero resamples** — the retry loop
  never fired — with transcripts word-identical to the script bar Whisper artefacts (`thirty` → `30`).
  4 of those runs were `stability=balanced` and 4 `stable`; the two were **indistinguishable** (mean
  similarity 0.987, same worst case, same wall time once the cold CUDA-graph run is excluded), so lowering
  temperature is not a lever worth exposing. Numbers in `docs/gpu-notes.md`.

  The likely explanation is that the fixes above did their job: `_seq_budget()` sizing chunks from the
  actual reference clip, `chunk_text`'s balanced partition removing the runt chunk, and the per-chunk
  `max_new_tokens` cap. **Do not delete the resampling** — one voice and one script is not a proof of
  absence, and a longer reference clip may still land outside the sweet spot.

Verify changes here by transcribing the output and diffing against the script, not by comparing durations —
duration ratios cannot tell padding from a legitimately long read. `faster_whisper` is already a dependency.
Still run it more than once: the 2026-09-09 sweep is one voice on one machine, and the original failure was
frequent enough that n=1 was a coin flip.

Each chunk calls `generate_voice_clone_streaming` — **not** for delivery (the client only gets audio when
the whole job finishes) but so a cancel lands within ~1s instead of waiting out an ~85s chunk. One retry
per chunk; a `"CUDA error"` short-circuits the retry because the process's CUDA context is dead anyway.

### Concurrency model

One global `_gen_lock` serializes *all* generation, and one worker thread drains `_pending_job_ids` FIFO.
This is deliberate: `PredictorGraph`/`TalkerGraph`'s CUDA graphs and static buffers are not reentrant.
Multiple users queue behind each other — don't "fix" this with a thread pool.

Lock discipline in `main.py`: `_jobs_lock` (job dict + queue lists), `_store_lock` (presets/history
in-memory lists), `_timing_lock`, `_gen_lock` (GPU). Helpers suffixed `_locked` assume the caller already
holds `_jobs_lock`.

### Persistence

Flat JSON in `backend/storage/` (gitignored), written via temp-file + `.replace()` under a `FileLock`.
`queue.json` holds only queued/in-flight jobs and is replayed on startup (`_restore_queue_on_startup`) —
resumed **from the start of the job**, not mid-chunk. Completed jobs live in `history.json`; the job dicts
themselves (`_jobs`) are in-memory only, so a restart loses status of finished/failed jobs.

Time estimates are a rolling `chars/second` average over the last 20 completed jobs, seeded from
`history.json` on boot so estimates are sane immediately after a restart.

### Frontend

React 19 + Vite + TS. Two routes (`App.tsx`), both rendering `StudioShell`: `/` and `/studio`. There is no
in-app landing page — the app opens straight into the tool, and `/studio` survives only as an alias for
old bookmarks. (Marketing lives in `landing-page/index.html`, a standalone file deployed separately.)
No state library — `StudioShell.tsx` holds most state, plus two contexts:
- `GenerationActivityContext` — the **single** queue poller for the whole app (1s while active, 4s idle,
  paused in background tabs). Add queue reads there, not as new polls.
- `AudioActivityContext` — one-element-at-a-time playback plus the analyser that drives `WaveRibbon`.
  **Every `<audio>` it adopts is routed through `audio/AudioEngine.ts`'s `createMediaElementSource`,
  so each one needs `crossOrigin="anonymous"`** — a cross-origin source without CORS is tainted and
  plays silent while the transport still advances. This bit twice; there are three such elements
  (`VoiceoverPlayer`, `VoicePicker`, `NewVoiceModal`).

- **Every transient error is a toast; every persistent one is still a banner.** The distinction is
  not stylistic. `useErrorToast` mirrors the `error` and `voiceError` STATES into sonner (state
  stays the source of truth, so `setError(null)` dismisses the toast and the existing Escape and
  clear-before-submit behaviours keep working untouched; the previous toast is dismissed before a
  new one is raised, or a changing message stacks two). What stays inline is the three things that
  describe a *condition* rather than an event, and would be wrong to auto-dismiss while still true:
  `modelStatus === 'down'` (which also carries Retry, the app's only recovery control),
  the CPU-fallback notice, and the long-reference-clip estimate warning.
  The voices dialog no longer takes an `error` prop at all. That banner used to be justified by
  "the composer is behind this dialog, so an error reported there is invisible" — a toast is above
  everything (sonner is `z-index: 999999999`, over the modal's 200 and BootOverlay's 300), which
  satisfies the same requirement *and* stops a failed upload growing the panel, which had been the
  one remaining thing that could shift the fixed-height voices dialog.

- **`modal-body` is a JS hook with no CSS rule, and deleting it silently breaks focus.**
  `Modal.tsx`'s open effect queries `.modal-body` to land focus on the dialog body's first
  control. The class was absent for a long time, so the query always missed and focus fell
  through to `panel.querySelector(FOCUSABLE)` -- the header's ✕, i.e. exactly what the comment
  above it says it is avoiding. `check_orphan_css.py` lists it under *missing rule*; that
  direction is informational and does not fail. Do not add a CSS rule to quieten it, and do not
  remove the class. Verified target after the fix: the dropzone in Voices, the Close button in the
  GPU-fault dialog, and ✕ only when a body has nothing focusable at all.

- **Notifications are sonner, and firing exactly once is the hard part.** `useJobToasts` watches
  the polled queue and toasts on a job's first appearance in a terminal state. The queue polls at
  1s/4s, so a `done` job sits in several consecutive responses -- keying off "is there a done job"
  would toast on every poll. The reported-ids set is **seeded on the first poll rather than
  starting empty** (and the sentinel is `null`, not `size === 0`, because an empty queue on mount
  is a normal first poll): otherwise a reload while jobs happen to be terminal fires a burst of
  toasts for work already finished. Ids are never removed -- a job id is a uuid the backend never
  reuses and a retry mints a new one, so a retried failure is correctly a separate event.
  Failures use `duration: Infinity`; the row they leave behind carries the Retry.
  `theme` comes from `themeMode()` over our own five-theme id, not sonner's default light -- three
  of the five are dark. Surfaces are passed as CSS variables, not a className, because sonner sets
  them on its own elements and a class would have to win a specificity fight on every future
  version. **`richColors` is off**: it ships its own green and red, which would be the only two
  colours in the app `check_design_tokens.py` cannot see. Cost: 34.4 kB raw / 9.6 kB gzip.
  Relatedly, the elapsed-time span in `HistoryList` is **no longer `aria-live`** -- it announced a
  new time every second and said nothing at the finish. Sonner's own polite region replaced it.

- **Voiceover search matches NAME and VOICE only, client-side, and a server `q` was built and then
  removed.** Script text is deliberately excluded: a script runs to `MAX_TOTAL_CHARS` (60,000), so a
  common word matches nearly everything and the list is not narrowed. Of what remains, both fields the
  user most often types are invisible to the backend — a voiceover's display name is a localStorage
  override per browser (the two-name-stores rule below), and the default `Voiceover 27` is derived from
  the row's position rather than stored anywhere. A server filter could therefore only have matched the
  voice name. So `/api/history` has no `q` (its docstring says why, so it is not re-added),
  `HistoryList` filters `history` directly, and there is no debounce — with no request to coalesce, the
  250ms wait was pure latency.
  Two consequences that are easy to break:
  **numbering happens BEFORE filtering.** The number is `total - i` over the *whole* list, so
  numbering the filtered array would renumber every row as you typed — "Voiceover 26" becoming
  "Voiceover 3" mid-search, so the name being searched for stops matching itself.
  And **the parent must finish loading the history while a search runs** (`onSearchActiveChange` →
  `listHistory(totalRef.current, 0)`), because filtering only sees what was fetched; without it a
  query over a 200-row history would silently consider the first 20. The load-more sentinel and its
  `IntersectionObserver` are both switched off while searching for the same reason.

- **Shortcut caps: `MOD_KEY` is the glyph, `MOD_ARIA` is the attribute, and they are not
  interchangeable.** `aria-keyshortcuts` takes a fixed vocabulary (`Control+Enter`), so it can
  never be the display string. The `<kbd>` is `aria-hidden` -- the attribute is what gets
  announced. The Apple check resolves once at module scope; the composer re-renders on every
  keystroke. Placement is deliberately not uniform: Generate is **tooltip-only** (its label
  substitutes `blockedReason` and reads as a sentence), and `/` sits on the Script heading at
  `order-3` past the `section-rule` hairline (inside the box it overlapped line one -- measured,
  cap 11-29px against a 15-40.5px first line, and the bottom corners belong to the word count, the
  resize grip and the scrollbar).

- **`Ctrl/Cmd+F` focuses the voiceovers search, and its `preventDefault` is CONDITIONAL.** Taking
  Ctrl+F from the browser is the one hijack every user would notice, so `onFindInApp` returns a
  **boolean** rather than being a plain void handler: the search box only renders when there is
  something to search, so with an empty column the handler reports false and the browser's own find
  opens untouched. It sits above the bare-key guard in `useHotkeys`, next to `Ctrl/Cmd+Enter`, for
  the same reason — a modifier combo has to work while typing or it is unreachable from the one
  place people are usually typing. It also `select()`s, so a second Ctrl+F retypes rather than
  appends.

- **The shortcuts are `Ctrl/Cmd+Enter`, `Ctrl/Cmd+F`, `Escape` and `/`.**
  **Space was removed and should not come back without a reason.** It clicked the newest
  voiceover's play button, which meant binding a bare Space on `window` and calling
  `preventDefault()` on it — taking over page scrolling everywhere outside a text field, which is a
  large behaviour to commandeer for one convenience when every row already has a play button.
  Removing it also retired `.voiceover-play-btn`: that class had **no CSS rule at all** and existed
  purely as the `querySelector` hook the handler used, along with the `resultsRef` on the `<aside>`
  that scoped it. If a play shortcut is ever wanted again, all three come back together.

`HistoryList`'s `active` filter carries `running | queued | canceling | error` — **`error` is in there
deliberately**, so a job that dies after acceptance stays visible instead of vanishing, and its `Cancel`
becomes `Dismiss` (`deleteQueueJob`, whose endpoint accepts only `canceled`/`error`) plus `Retry`
(`POST /api/queue/{job_id}/retry`). Retry is server-side on purpose: `text_preview` is truncated to 80
chars, and putting the full script on queue entries would repost up to `MAX_TOTAL_CHARS` every second of
the poll loop for as long as a failed row sits there. It calls `generate()` rather than duplicating it, so
a retry is validated like any submission, and it deletes the old job only *after* the new one is accepted
— a retry that fails validation leaves the original row and its error intact. Two things exist only
because a retry *replaces its own row*:
- **`attempt`** (`GenerateRequest` → job dict → `QueueEntry`, rendered `Failed · try 3`). A retry mints a
  new `job_id`, so a job failing instantly on every attempt produces a visually identical row each time.
  Observed before this existed: seven retries, seven `202`s, and it read as a dead button.
- **`HistoryList`'s `onError` prop.** `handleRetry` was `try`/`finally` with no `catch`, so an `ApiError`
  from the retry endpoint — most often a 404 because the voice was deleted since — became an unhandled
  rejection. A swallowed failure, in the feature that exists to stop failures being swallowed.

- **`gpu_fault` on `/api/health` is the only way to know the GPU is gone.** `_process_job` already
  detects `"CUDA error"` to short-circuit its chunk retries (the context is dead, so retrying in-process
  cannot work); it now also sets a module-level `_gpu_fault`. **`model_loaded` stays `True` in that
  state** — the weights are still resident, it is the CUDA *context* that died — so no existing field
  distinguishes "working" from "will fail every job forever". The frontend polls it on any transition
  into a failed job, hides Retry on every row while it is set, and opens a dismissible dialog -- the raw
  CUDA text sits behind a `<details>` there, not above the script box. Never cleared: only a restart cures
  it, and a restart clears it by definition.
  **The app cannot restart itself and must not pretend to.** Nothing supervises the backend --
  `launcher.py` exits once the app is up -- so a "restart" button could only ever quit, leaving the user
  to relaunch anyway. An `/api/shutdown` endpoint was built and then removed: with LAN mode binding
  `0.0.0.0` and no auth anywhere, it is a kill switch for anyone who can reach the port, which is a poor
  trade for saving one click. Two things that do
not fall out for free: `/api/queue` sorts by `queue_position if not None else -1` and a terminal job has no
position, so failures are re-sorted client-side or they surface *above* the running job; and the
`total + 1 + i` row numbering must skip them, since a failed job never becomes a voiceover and numbering it
shifts every row beneath. `canceled` stays excluded — the user stopped it and knows.

The **Voiceovers column is a fixed window, not a paginated list.** `HISTORY_INITIAL_COUNT` (20) fills it
on first paint and `HISTORY_LOAD_MORE_COUNT` (10) is the scroll increment — two constants because the two
jobs differ: the first batch has to fill the window and absorb the first scrolls, the increment only has to
arrive before the reader reaches the bottom. `.result-list` is capped at `calc(8 * var(--result-row-h))`
with `overflow-y: auto`; an `IntersectionObserver` on a sentinel `<li>` fetches the next slice as it scrolls
into view. `history` accumulates rather than swapping pages. Two consequences worth knowing before touching
it:
- **Reloads refetch the whole prefix** (`listHistory(max(PAGE_SIZE, loaded), 0)`), they do not patch the
  array. Deleting an entry shifts every later one up by one, so an offset-based append would silently skip
  a voiceover. Appends de-duplicate by `id` for the same reason — a job finishing between two requests
  shifts the offsets under you.
- **Above 1025px the page itself does not scroll** (`.studio` is `height: 100svh; overflow: hidden`, with a
  `min-height: 0` chain down through `.workspace` → `.aside` → `.results` → `.result-list`). The row cap is
  a ceiling, not a height: `flex: 1 1 auto` clamps the list to whatever the aside actually has, so on a
  768px-tall laptop it renders fewer than eight rows and the `max-height` never applies. Raising the
  multiplier alone does nothing there.
- **1025px is now written in two places, and one of them is a token.** `--breakpoint-wide: 1025px` in
  `frontend/src/index.css` gives the `wide:` utility prefix used throughout the layout, and
  `TWO_COLUMN_QUERY` in `HistoryList.tsx` still hardcodes the same number. **Use `wide:`, never Tailwind's
  `lg:` — `lg` is 1024px and the off-by-one decides which element is the scroll root.** The component needs
  the query because both of its scroll effects have to pick a root: above the breakpoint the list is the
  scroller, below it the page is. Rooting the `IntersectionObserver` at the list below the breakpoint
  reports intersecting immediately and chain-loads the whole history in one go; reading `list.scrollTop`
  there returns 0 forever, i.e. permanently "at the top". Below the breakpoint all of that is switched off
  and the page scrolls normally — a short inner scroller inside a locked page is two nested scroll regions
  on a phone. A missing `min-h-0` anywhere in the shell → `main` → `.aside` → `.results` →
  `.result-list` chain stops the list shrinking, and `scripts/check_orphan_css.py` guards the class
  hooks that chain depends on. **`.results` was the missing link for a long time.** It is a flex
  column but was `height: auto`, and a flex child can only shrink against a parent with a
  constrained height — so `.result-list`'s `flex: 1 1 auto; min-height: 0` never engaged, the list
  took its full `max-height` at every viewport, and the overflow was **clipped** by the shell's
  `wide:overflow-hidden` rather than scrolling. Measured before the fix, at widths ≥1025px: a 716px
  list and 8.00 visible rows at viewport heights 1100/900/768/700, with the root overflowing by
  101/233/301px at the last three. After adding `wide:h-full wide:min-h-0` to `.results`: 8.00 rows
  at 1100, 6.64 at 900, 5.14 at 768, 4.36 at 700, and no overflow anywhere. Note the shell root
  itself carries no `min-h-0` and no `.studio` class — it is the flex *container*, not an item.

### Styling: Tailwind v4, five themes, no App.css

`App.css` is gone. The SPA is Tailwind utilities plus two stylesheets:

- **`frontend/src/styles/tokens.css`** — the palettes, in three layers. Layer 0 is invariants (geometry,
  type, layout, motion). Layer 1 is the 22 raw values a theme states, with Studio on `:root` as the
  default *and* the fallback. Layer 2 is everything derivable from layer 1, stated once. Layer 2 works
  because a `var()` inside a custom-property declaration resolves against the element it lands on, and a
  `:root[data-theme='x']` block lands on the same `<html>` with higher specificity — so `--accent-soft`
  picks up the themed `--accent` for free. Adding a theme is one layer-1 block; **omit a raw token and it
  silently inherits Studio's dark value**, which only shows up on one theme.
- **`frontend/src/index.css`** — the Tailwind entry, the `@theme inline` bridge, keyframes, the `@utility`
  primitives, and the base element reset that came out of App.css.

**`@theme inline` is load-bearing.** A plain `@theme` copies the token's *value* into each utility at build
time, freezing the palette on Studio. `inline` emits `var(--bg-card)` instead, which is the only reason
flipping `data-theme` re-themes the page at runtime. If themes ever stop switching, check that word first.

**Preflight is imported, and is not optional.** Tailwind's `border` utility compiles to
`border-style: var(--tw-border-style); border-width: 1px`, and the thing that establishes that variable
for every element is Preflight's `*, ::before, ::after { border: 0 solid }`. Without it the width applies
and the style falls back to the UA default `none`, so every bordered surface draws nothing while the build
and all four guards stay green. It was correctly *omitted* during the migration, while unlayered App.css
still beat `@layer base`; that trade ended when App.css did.

**The app's own base rules must stay inside `@layer base`.** This one cost a long debugging detour, and
nothing catches it. Unlayered CSS outranks *every* cascade layer, `utilities` included. When the base
element rules came out of App.css they were written unlayered — which looked harmless, since they had been
unlayered in App.css too — and `button { background: none; border: none }` then silently outranked
`@utility ghost-btn`, `select`, `generate-btn` and `icon-btn`. Generate lost its fill, the voice dropdown
lost its border *and* its fill, every icon button lost its hover, and no amount of raising `--control-edge`
brought them back because the border was never being drawn. In App.css the same reset was also unlayered
but came *earlier in source order*, so the component rules won; moving the file inverted that without
changing one declaration. Diagnostic tell: `<div>`-based surfaces (the script box) render fine while
`<button>`-based ones do not.

**The theme attribute lives on `<html>`, set before first paint by a blocking script in `index.html`.** It
cannot be React: `Modal.tsx` portals to `document.body` (outside `#root`), and in `vite dev` the
stylesheets arrive through the JS module graph, so the first frame has no CSS at all — hence the five
inlined per-theme backgrounds in that same `<head>`. The script and `src/theme.ts` are a deliberate
hand-mirror (a blocking script cannot import a module and stay blocking); `check_design_tokens.py` scans
`index.html` for exactly that reason. localStorage carries the *choice* (`'system'` or a theme id); the
attribute carries the *resolved* theme. Do not read the attribute as the source of truth — it cannot tell
System-resolving-to-Studio from an explicit Studio.

**The canvas waveform no longer mirrors the palette by hand.** `WaveRibbon.tsx` used to carry three
hardcoded colours. `resolveWavePalette()` in `theme.ts` now reads them through a one-off probe element:
`getComputedStyle(html).getPropertyValue('--wave-base')` returns the *unevaluated* `color-mix(...)` token
sequence, which `fillStyle` silently ignores, whereas real colour properties resolve to `rgb()`. The
palette resolves once per theme change in `ThemeProvider` (not per ribbon — the history window mounts ~20),
and the three strings are **dependencies of `draw`'s `useCallback`**, which is the entire mechanism that
repaints a *paused* ribbon. Nothing else in that component asks for a repaint at rest.

**Controls have a surface, separators do not.** `--line` (10%) is the hairline between things that
merely sit next to each other — row dividers, card edges, the rule under a heading — and is
deliberately almost subliminal. `--control-edge` (40%) plus `--control-fill` (`--bg-raised`) is what
makes a button or a dropdown read as a control. They were the same token once, which is why buttons
looked like outlined text; raising the shared value would have thickened every divider in the
voiceovers list, which is the one place the near-invisibility is correct. `.icon-btn` stays borderless
on purpose — boxing four glyphs across eight rows turns the Voiceovers column into a grid of buttons.

**Three surfaces, three ways of getting Tailwind, and the difference is not arbitrary.**

| Surface | How | Why not the others |
|---|---|---|
| Studio SPA | `@tailwindcss/vite`, build time | it already has a bundler |
| Launcher splash | `@tailwindcss/cli`, build time, inlined | see below |
| Landing page | Play CDN, runtime | a single static file on Vercel with `buildCommand: null` |

**The launcher cannot use the Play CDN, and that is the whole reason it has a build step.** It is
served from a Python string over a loopback socket by a frozen exe, and it has to paint when
nothing else in the product is up -- most often a first run that is still downloading the model,
i.e. exactly when a CDN is unreachable. `launcher/splash.html` + `splash.css` are the source;
`scripts/build_splash.py` compiles them and writes `launcher/_splash.py`, which `launcher.py`
imports. A **module**, not a data file: `launcher.spec` declares `datas=[]` and
`check_desktop_port.py` relies on that, and PyInstaller follows imports, so nothing in the spec
changes. `_splash.py` is committed so a build without npm still works, and `build_splash.py
--check` fails on a stale one.

**The landing page's CDN script is pinned with SRI, and the path matters.** It loads
`/npm/@tailwindcss/browser@4.3.3/dist/index.global.js`, not the bare `@4` the docs show: jsDelivr
minifies the bare path on the fly and says so in the file's own banner -- *"Do NOT use SRI with
dynamically generated files"* -- so a hash over it is not stable. The dist file is served verbatim.

**The landing page's sheet is a `<dialog>`.** It was a checkbox toggled by a `<label for>`, which
keyboards can focus but not activate -- reachable, and impossible to open. `<details>` fixes the
trigger but is in-flow, so opening it makes the page scroll, and this page is specified not to.
`showModal()` gives the focus trap, Escape, background inertness and `::backdrop` for three lines
of script. `scripts/measure_landing.sh` drives `#more`, `.sheet` and `.sheet-body` directly, so
those names are hooks -- and its probe waits 1200ms, because the page compiles its own Tailwind in
the browser and measuring earlier measures an unstyled page. The tell is `sheetH` coming back
identical at every viewport width.

**SEO: the landing page ranks, the tool page is `noindex`, and that is on purpose.**
`https://homegrown-x.vercel.app` is the canonical origin; it is repeated in the landing page's
head, `robots.txt` and `sitemap.xml`, with a comment naming all three. Every social URL is
absolute -- a relative `og:image` is the usual reason a card renders as a bare link, and it fails
silently.

`frontend/index.html` carries `robots: noindex, nofollow`. **Do not remove it.** The app has no
sign-in (`get_current_user` returns a constant), so anyone who reached it in search would have
full access to create and delete voices. Three deployment modes are private; the fourth is a
public Vercel URL, and the tag costs nothing while that remains possible. It is not a security
control -- it asks well-behaved crawlers not to index and stops nobody who has the URL.

`landing-page/og.png` is a 1200x630 screenshot of the real page, generated by
`scripts/build_og_image.sh` and **committed** -- Vercel serves that directory with no build step,
so an uncommitted generated file would 404. Regenerate it when the page design changes. The
script waits on `--virtual-time-budget` because the page compiles its own Tailwind in the browser:
screenshot too early and you get a valid 1200x630 PNG of an unstyled white page, with no error.
It guards against that by failing under 8 KB.

**Structured data is `SoftwareApplication`, not `FAQPage`.** The Q&A lives inside the `<dialog>`,
and Google forbids marking up hidden content -- that earns a manual action, not a rich result. The
copy is still crawled and indexed as ordinary body text; hidden-behind-a-disclosure content is not
demoted for ordinary ranking. It is only rich-result eligibility that is forfeited.

**Five build gates, all in `build.sh`.** `check_design_tokens.py` (hex outside the palette; two palettes —
the full five-theme set for the SPA, Studio-only for `launcher.py` and the landing page, which can never be
another theme), `check_contrast.py` (WCAG AA for every theme, computed not eyeballed), `check_orphan_css.py`
(CSS classes no component uses — written after a ported component left `.compose-bar .generate` matching
nothing and silently un-anchored the Generate button), `check_desktop_port.py`, and
`build_splash.py --check` (the launcher splash is regenerated from source, not trusted).
`check_design_tokens.py` reads three colour forms -- 6-digit hex, 3-digit hex and `rgb()`/
`rgba()` -- because for a long time it read only the first, and the landing page drifted for
months in the gaps: `#fff` on a hover, hairlines at 9%/16% against tokens saying 10%/17%, and
two colours that were in no token file at all. Comments and mask stencils are blanked before
scanning; a `#000` inside `mask-image` is alpha, not a pigment.

**Startup progress in dev comes from a Vite plugin, not from the API.** `frontend/vite-boot-status.ts`
(`apply: 'serve'`) reads `backend/storage/boot_status.json` off disk and serves it at `/__boot-status`;
`src/hooks/useBootStatus.ts` polls it while `modelStatus === 'checking'`. It cannot be an API route: uvicorn
binds the socket only after `lifespan()` reaches its `yield`, and `lifespan()` is where the CUDA probe and
model load happen, so the backend port is connection-refused for the entire window (measured: 75s+ on this
machine). Any non-JSON response yields `null` and the UI falls back to its elapsed counter — deliberately
**not** gated on `import.meta.env.DEV`, which is also false for the LAN build. The phase copy is duplicated
from `launcher/launcher.py`'s `WORDS`/`TAGLINE` on purpose so dev and the desktop loader read as one
product; change both together.

All API calls go through `src/api.ts`, which prefixes every path with `VITE_BACKEND_URL` when it's set —
an absolute URL. Unset, the prefix is `''` and every call is a relative path, which is what single-port/LAN
and installer mode rely on, **and now dev too**: `vite.config.ts` proxies `/api`, `/audio` and `/refs` to
`127.0.0.1:8000`, so leaving `VITE_BACKEND_URL` unset is the correct dev setting rather than a broken one.

That proxy exists for one reason — **reaching dev from another device**. An absolute `VITE_BACKEND_URL`
bakes a single address into the page, so pointing it at `127.0.0.1` means every visitor calls *their own*
loopback: the page renders, nothing works. Proxying instead makes every call same-origin against whatever
address the browser typed. Two consequences: `/audio` and `/refs` must be proxied alongside `/api` because
`mediaUrl()` resolves against the same base (miss them and the API works while playback 404s), and
`dev.sh`'s preflight now **warns when `VITE_BACKEND_URL` is set** — the reverse of what it used to check.
The setting is still correct for deployment mode 4, which is why it warns rather than fails.

The dev backend stays bound to `127.0.0.1` even so. Vite reaches it from this host, so a wildcard bind
would add nothing but a second Windows Firewall prompt, on `python.exe` — see the desktop-bind note
below for why one wrong click there is unrecoverable.

### Deployment modes (there are four, sharing one codebase)

1. **Local dev** — Vite :5173 + uvicorn :8000. Same-origin from the browser's point of view: Vite
   proxies `/api`, `/audio` and `/refs`, so `ALLOWED_ORIGINS` only matters for anything that bypasses
   it. Reachable from other devices at `http://<LAN-IP>:5173` with no per-device configuration.
2. **LAN single-port** — built `frontend/dist` served by FastAPI on :8000. The current primary target.
   `start_server.bat` preflights three things before it binds: `frontend/dist/index.html` exists (see
   `FRONTEND_DIST` below), no localhost address is compiled into the bundle, and nothing already holds
   :8000. Each has cost a misdiagnosis; the port one has cost three.
3. **Frozen desktop installer** — on **:8731**, not 8000: it is the one mode whose port nobody types
   (single loopback origin, relative API paths), and sharing 8000 let the launcher mistake a dev uvicorn
   for a running app and never start `backend.exe`. `backend/run.py` is the PyInstaller entrypoint (path
   resolution + first-run HF model download); `launcher/launcher.py` starts `backend.exe` hidden, polls
   `/api/health`, opens the browser; `installer/setup.nsi` is the per-user NSIS installer.
4. **Vercel + RunPod split (dormant)** — `frontend/api/wake.ts` resumes a stopped pod, backend's
   `_idle_stop_loop` stops it again when idle *and* the queue is empty. Gated client-side by
   `VITE_USE_RUNPOD_WAKE`; unset everywhere except the Vercel project. See `docs/DEPLOYMENT.md`. Whether to keep
   this path is an open decision (`docs/history/HANDOFF.md` §6) — don't delete it unprompted.

## Gotchas

- **`VITE_BACKEND_URL` is baked in at build time, including `npm run build`.** If `frontend/.env.local`
  sets `http://127.0.0.1:8000` when you build for LAN mode, every LAN client calls *their own* localhost and
  the app is broken for everyone but the GPU machine. Unset it (or set it empty) before a LAN/installer build.
  `build.sh` stashes the file to prevent it; a hand-run `npm run build` does not, so `start_server.bat`
  greps the emitted bundle for a localhost address and refuses to serve one. The same value now breaks
  *dev* on the LAN too, which is why `frontend/.env.local` ships with it commented out.
- **No pipes in the PowerShell one-liners inside `start_server.bat`.** In a `for /f ... ('powershell …')`
  cmd reads a bare `|` as its own pipe and passes `^|` through as a literal caret. Neither runs, and both
  fail *silently* — that is how the port guard first shipped not firing at all. Use `@(…)` with indexing
  and `.Where({…})` instead. Related: `findstr /s` re-anchors the pattern per subdirectory and returns 1
  both for "no match" and "cannot open that path", so it cannot be used for a guard; the bundle check is
  PowerShell with distinct exit codes for *matched* and *nothing to check*.
- **`.venv/Scripts/activate.bat` is stale and must not be used.** It hardcodes
  `VIRTUAL_ENV=D:\dev-projects\websites\voice-clone-agent\.venv` — the path this repo had before it was
  renamed to `homegrown`, and a directory that no longer exists. Activating therefore prepends a dead
  directory to `PATH`, `python` resolves to whatever is on the system PATH, and you get
  `No module named uvicorn` that reads as a broken install. `start_server.bat` used to `call` it, which
  meant LAN mode had been silently broken since the rename. Call `.venv\Scripts\python.exe` by absolute
  path instead — it locates its own venv through `pyvenv.cfg` and needs no activation, which is what
  `dev.sh` has always done. Recreating the venv would also fix it; nothing depends on activation.
- **`FRONTEND_DIST` is checked once at import time.** If `frontend/dist` doesn't exist when the backend
  process starts, the SPA route never registers for that process's life. Build the frontend *before*
  starting the backend, or restart it.
- **Torch is pinned to the cu126 build, deliberately** (see `backend/requirements.txt` header). cu128 ships
  kernels only for `sm_75+`; on older cards (Maxwell GTX 9xx = `sm_52`) every GPU op dies with
  `no kernel image is available for execution on the device`. cu126 still ships `sm_50` cubins, which run on
  `sm_52`, covering `sm_50`–`sm_90`. Blackwell (`sm_100`/`sm_120`) needs cu128 — switch the index and both
  pins together. The file carries `--extra-index-url` in its header, so a single
  `pip install -r backend/requirements.txt` resolves everything.
- **Never trust `torch.cuda.is_available()` here.** It returns `True` for a GPU this torch build cannot run
  a single kernel on. Use `resolve_device()` / `cuda_is_usable()` in `qwen/utils.py` — they check the arch
  list *and* execute a test matmul. `lifespan()` and `FasterQwen3TTS.from_pretrained` both go through it;
  `from_pretrained` now defaults to `device="auto"`.
- **CPU fallback exists, as a last resort.** With no usable GPU, `from_pretrained` builds no CUDA graphs and
  generation routes through `parity_generate_streaming` (`qwen/streaming.py:182`) in float32. Correct
  output, but many minutes per chunk. `/api/health` reports `device`/`device_reason` and the Studio UI shows
  a warning banner. `generate_custom_voice_streaming` / `generate_voice_design_streaming` have no parity
  path and raise via `_require_graphs` on CPU.
- **Some pins are marked `sys_platform == "linux"` and must stay that way.** `nvidia-*-cu12` (torch's
  Windows wheel already bundles those DLLs in `torch/lib` — see `backend/backend.spec` — so installing them
  duplicates 3-4GB) and `triton`/`uvloop` (no Windows wheels at all; unmarked they abort the entire install
  with "No matching distribution found").
- **`setup.sh` is the one-shot installer.** Idempotent, and it keeps pip's cache/temp plus the model on the
  repo's own drive — the defaults live on `C:` and this project pulls ~5GB.
- **`CHUNK_MAX_CHARS=800` / `max_seq_len=1024` / `MAX_REF_AUDIO_SECS=60` are empirical, GPU-specific
  numbers**, tuned on a 4GB Maxwell card — `docs/gpu-notes.md` records a GTX 960, while the machine this
  runs on now reports a **GTX 970 (sm_52)** via `/api/health`; both are 4GB `sm_52`, so the constants hold
  either way (see `docs/gpu-notes.md`, `qwen/HOW_TO_RUN.md`). Raising them is plausible on
  bigger cards but untested; reference clips over ~23s previously produced garbled/looping output.
  `CHUNK_MAX_CHARS` is now only a ceiling — `_seq_budget()` lowers it per preset (see above). The failure
  it fixes: a 53.5s clip + an 876-char script asked for ~1729 positions against 1024, and the output came
  back as murmur and long silence (54.4s of audio holding ~20s of speech) rather than as an error.
- **The vocoder decodes in bounded launches (`DECODE_CHUNK_FRAMES=100` in `qwen/faster_qwen3_tts.py`).**
  The vendored `chunked_decode` defaults to 300 frames = 25s of audio per GPU launch, which takes ~4s on a
  GTX 970 — over Windows WDDM's 2s TDR watchdog, which kills the kernel and the CUDA context with
  `cudaErrorLaunchTimeout`. Anything that raises per-launch decode work risks reintroducing this on
  display-attached GPUs.
- **`MAX_SCRIPT_CHARS` in `frontend/src/constants.ts` must stay in sync with `MAX_TOTAL_CHARS` in
  `backend/main.py`** (60,000). Nothing enforces this.
- **`qwen/` is vendored, not a pip package.** In dev, `main.py` inserts the repo root into `sys.path`; when
  frozen, `backend.spec` ships `qwen/` as raw data at the bundle root. Treat it as third-party — edit only
  with a reason.
- **`/api/queue` sorts by real position in `_pending_job_ids`**, not `_jobs` insertion order; reorder only
  splices the requesting user's own jobs so a shared FIFO can't be jumped.
- **Doc hierarchy.** `README.md` (setup, features, troubleshooting) and this file are the maintained docs
  and stay at the repo root; all other prose lives under `docs/`. `docs/workflow.md` covers day-to-day
  usage and was rewritten against the current UI; `docs/BUILD.md` is the build procedure;
  `docs/gpu-notes.md` holds the measurements
  behind the empirical constants, plus the dated experiment log (GPU sizing, the 2026-09-09 stability
  sweep) — put numbers there and the one-line conclusion here. `docs/history/HANDOFF.md` and `docs/history/DEPLOY_SPEC.md` carry
  explicit "historical" banners and `docs/DEPLOYMENT.md` documents the dormant Vercel+RunPod path -- treat
  those three as context, not current behaviour, and verify against source. Doc references in prose are
  written relative to the repo root.
- **Two things the UI does not do, despite appearances.** `startGenerate()` sends only
  `preset_id`/`text`/`language`, so Style/Stability never leave the browser (the backend defaults to
  `natural`/`balanced`). Measured 2026-09-09: `stable` and `balanced` produce indistinguishable output on
  this machine, so wiring Stability up would buy nothing — see `docs/gpu-notes.md`. Style is untested. And `is_builtin` is dead weight: the backend hardcodes it `False`
  (`main.py`), no "Studio Voices" gallery section exists in the frontend any more, and
  `NewVoiceModal` no longer filters on it -- the field survives only in `Preset` on both sides.
- **`language` is a property of the voice, not of a script.** `handleGenerate` reads it from the
  selected preset; it is set once, at creation, from what faster-whisper detected in the reference
  clip. There is no language control anywhere, and `handleRequeue` deliberately does not restore a
  per-job language.
- **A voice saves on drop. There is no name field and no Save button.** `handleAddVoice` in
  `StudioShell` derives the name with `presetNameFromFile` and calls `createPreset` immediately;
  `ReferenceUpload` is now only a dropzone. Two consequences that are easy to undo by accident:
  the voices dialog **must not close** after a successful create (it used to) — the row it just
  made, with its editable name, is the thing the user came to see; and the over-length limit is
  stated up front, as one static line under the dropzone, interpolating `REF_TRIM_SECS` rather
  than writing the number out.
- **The trim limit has been reported three ways, and the current one is the least clever
  deliberately.** First a client-side probe of the file's duration, guessing at a trim before the
  upload. Then a per-voice note under the row a clip created (`Trimmed from 2:03 — the first 40s
  are used.`), from the create response's real `trimmed_from_seconds`: accurate, but it arrived
  *after* the upload it described, and it gave some rows an extra line — which the fixed six-row
  window below cannot accommodate, since that window is six times **one** row height. It is now a
  flat rule in `ReferenceUpload`. The backend still returns `trimmed_from_seconds` and the field
  is still on `Preset`; nothing on the client reads it. The copy says *seconds of speech* because
  `pack_speech` collapses internal pauses before the cap applies, so a mostly-silent voice note
  still yields a full window.
- **The voices dialog reserves six rows whether or not it has six voices.** `@utility voice-list`
  sets `height: calc(6 * var(--voice-row-h))` — `height`, **not** `max-height`, and that is the
  entire feature. The modal panel sizes to its content and the backdrop centres it
  (`Modal.tsx`), so a list that grows by a row grows the dialog by a row in *both* directions,
  and the dialog stays open after a create — putting the jump exactly where the user is looking.
  A cap only stops that after the sixth voice. For the same reason the `<ul>` renders
  unconditionally with an empty state, rather than behind `presets.length > 0`: that gate made
  the first voice jump by a whole list. Measured against the built CSS: panel 487.5px at 0, 1, 5,
  6, 9 and 20 voices, and during an upload.
  `voice-list` also carries `flex: none`, the deliberate **opposite** of `result-list`'s
  `flex: 1 1 auto; min-height: 0` — that one must shrink below eight rows on a short laptop,
  this one must not shrink at all. Different containers, opposite requirements; don't unify them.
  `--voice-row-h` is 45px (py-1 8 + a 36px `min-h-9` row + 1px hairline) with a
  `@media (pointer: coarse)` override to 49px, because `icon-btn` takes a 40px floor on touch and
  lifts the row with it. Without the override a tablet reserves 24px too little. Verified: 49px
  rows, a 294px window, no scrollbar at six and one at nine.
- **Two names, two completely different stores, one component.** `InlineName` is the shared
  rename field, but what a commit *does* is a prop, because the two callers could not be more
  different. A **voiceover's** name is a localStorage display override (`usePersistedRecord`,
  `historyFileNames`) — nothing server-side knows it exists. A **voice's** name goes to
  `PATCH /api/presets/{id}`, and has to: the backend reads `preset["name"]` on every generate and
  stamps it into history as `preset_name`, so a client-only rename would show one name in the
  dialog and a different one on every voiceover that voice had produced. Do not "unify" the
  storage. Relatedly, `rename_preset` deliberately does **not** back-fill `preset_name` on
  existing history entries — that field is a snapshot of the name at generation time.
  `PATCH /api/presets/{id}` is also the only PATCH route in the backend.
- **`GET /api/presets/{id}/download` exists rather than linking at `/refs`.** The on-disk name is a
  uuid hex, the download has to be named after the voice's *current* name (which only the server
  knows after a rename), and `/refs` is an unauthenticated StaticFiles mount while this checks
  ownership. It does not convert, unlike `/api/download` -- a reference clip is returned as whatever
  was uploaded, because re-encoding would hand back something other than what went in.
- **The desktop build ships as a 7-Zip SFX, not an NSIS installer.** NSIS caps output at 2 GB; the frozen
  payload is 4.47 GB (torch is 3.84 GB of it). `makensis` does not error on this -- it spins for ~25 minutes
  at exactly 2 GB and emits nothing. `installer/setup.nsi` carries a banner saying so. Also redirect `TEMP`
  off `C:` before running PyInstaller: it pushes several GB through it and will exhaust a small system
  drive. Build steps are in README.md.
## Terminology

The product vocabulary is fixed. Use these words in UI copy, docs and new
identifiers; they were made consistent deliberately and drift is a bug.

| Term | Means | Do not call it |
|---|---|---|
| **voiceover** | the generated audio this tool produces | clip, generation, submission, render output |
| **script** | the text the user writes to be spoken | prompt, input, text block |
| **voice** | a cloned voice the user selects | preset *(in user-facing copy — `preset` stays the API/storage field name)* |
| **reference clip** | the audio recording a voice is cloned from | sample, voice file — "clip" **is** correct here, and only here |
| **chunk** | one `_seq_budget`-sized slice of a script | segment, part |
| **generate** | producing a voiceover from a script | render *(fine in prose, not in UI labels)*, synthesise |

"Clip" is the sharpest trap: it is right for the input recording and wrong for
the output. `ClipPlayer` was renamed `VoiceoverPlayer` for exactly this reason.

- **The desktop build binds `127.0.0.1`, not `0.0.0.0`, and that is load-bearing.** `backend/run.py`'s
  `uvicorn.run` is loopback-only because a wildcard bind makes Windows Defender Firewall pop its "Allow
  access / **Cancel**" alert the first time backend.exe runs -- and Cancel writes a *permanent Block rule*
  for that exe path, after which the app can never start again and nothing in the UI can undo it. The
  desktop build serves the API and the SPA from one origin, so it never needed the wildcard. LAN mode is a
  different entrypoint (`start_server.bat` passes `--host 0.0.0.0`, on :8000) and is unaffected -- don't
  "fix" either inconsistency, the bind or the port, by unifying them.
- **The desktop build's port is written twice and guarded once.** `PORT` in `backend/run.py` binds it;
  `PORT` in `launcher/launcher.py` polls it. The two are separately frozen exes with no import path
  between them, so `scripts/check_desktop_port.py` (run from `build.sh`'s pre-build checks) is the only
  thing stopping them drifting. On drift the launcher polls a dead port, waits out `STALL_TIMEOUT_S` and
  reports a backend startup timeout that never happened.
- **Startup progress is a file, not an endpoint.** uvicorn runs the lifespan startup (CUDA probe + model
  load) *before* it binds the socket, and on a first run `run.py` downloads ~2.5GB before uvicorn is even
  imported -- so for that whole window :8731 is connection-refused and `/api/health` cannot answer.
  `model_loaded: false` is therefore unreachable on the happy path; the browser goes straight from
  ECONNREFUSED to ready. Phases go through `backend/boot_status.py` ->
  `storage/boot_status.json`, which `launcher/launcher.py` serves at `/status` on its own ephemeral
  loopback port. Anything that wants to report startup progress belongs there, not in `/api/health`.
- **Never probe the local backend through `localhost` from Python.** It resolves to `::1` first and
  `127.0.0.1` second, and a connect to a dead loopback port here is *dropped, not refused*, so
  `urllib.request.urlopen` burns its full timeout once per family. Measured with nothing listening: 4.05s
  via `localhost` vs 2.01s via `127.0.0.1`. `launcher.py` probes `127.0.0.1` and gates the HTTP call behind
  a short TCP connect, which is what lets its loader poll at a 0.5s cadence.

## Other agent configs

Codex (`~/.codex/config.toml`) and Gemini CLI (`~/.gemini/settings.json`) configs exist on this machine.
Reply `/import` to scan and list what's importable (MCP servers, slash commands, subagents, skills,
instructions), then `/import --yes=<digest>` with the digest from the scan output to apply the user-level
items. If `/import` isn't available on this surface, run `claude import` from a terminal instead.
