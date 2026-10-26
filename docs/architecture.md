# Architecture

Homegrown consists of a React Studio, a local FastAPI service, a Windows
launcher, and a vendored Qwen inference wrapper. The marketing page is a
separate, fully static site (no backend); buyers reach the team through WhatsApp and
email links in its Contact section. It shares nothing with the local app, the Studio,
or the voice API.

## Studio

`apps/studio/src/main.tsx` loads fonts, styles and generated skeletons, then
mounts `app/App.tsx` inside `app/providers.tsx`. Provider order is Tooltip,
Theme, QueryClient, BrowserRouter, AudioActivity, then GenerationActivity.

`app/StudioShell.tsx` coordinates the feature modules under `features/` and
owns Studio-level keyboard behavior. The shell and static card controls render
without waiting for backend startup; API-backed voice rows and uncached history
or initial queue data use generated skeletons while their queries load. During
model startup, the language selector stays visible but disabled, and Clone
voice and voice selection stay disabled; their hover hints say they become
available when the model is ready. Language options use a generated skeleton
if they are still loading after startup. Generate also requires health to
report a CUDA device. Studio shows voice-model and compute status through `RuntimeStatus`, mounted
beside the Voices card. On screens below 760px it appears above the card; at
760–1024px it occupies a left column, and at 1025px and wider it is positioned
in the left gutter. The device name comes from `/api/health`; the last detected
name is cached in localStorage for startup display and replaced by live health
data. The backend tests the default CUDA GPU and falls back to CPU if unusable;
it does not rank multiple GPUs. Health does not expose model identifiers.
`hooks/useTypeToScript.ts` focuses the
Script textarea on load and forwards eligible printable keys to it without
intercepting searches, editable controls, menus, dialogs, modifiers, or IME
composition. The Script editor owns clipboard paste and applies the remaining
`MAX_SCRIPT_CHARS` capacity before reporting the new controlled value. Clipboard
reads invoke the browser clipboard API directly; unavailable or denied reads
produce a toast, while permission prompts are controlled by the browser. The
editor's clear control is disabled for an empty script and clears its controlled
value otherwise. `ScriptBlock` owns bounded Undo/Redo snapshots for typing,
paste, clear, and parent-driven script replacements such as voiceover reuse.
Rapid character edits are grouped, cursor selections are restored, and
Ctrl/Cmd+Z plus Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y work while the textarea is
focused. The Undo/Redo controls sit above the word/character count in the
right-side control column.
`features/voices/useVoiceCloneQueue.tsx` owns the browser-local FIFO of selected
reference files and their toast lifecycles. It serializes requests through the
shell's upload callback, pauses while the model is unavailable, and releases
waiting files on unmount. Multi-file selection and card drop feed this queue;
the API remains a single-file upload endpoint. The queue is not persisted across
page reloads.
Feature tests live beside their implementation. Shared controls live under
`components/ui`, playback views under `components/audio`, and canvas/WebGL
effects under `components/effects`; their CSS is colocated. Shared hooks live
under `hooks/`, while feature-specific hooks live with their feature.

`lib/api.ts` uses same-origin API and media paths. `features/voices` owns the
server-paged voice search and controls while `StudioShell` keeps the complete
voice list for generation and Voiceovers filters. `GET /api/presets` searches
case-insensitively and returns a matching total before slicing; only cloned
voices are included. Each preset includes `completed_voiceovers`, aggregated
from that user's persisted completed-history records, independent of history
filters and pagination. Queued, running, and failed jobs do not contribute.
Generation completion and individual or bulk history deletion invalidate voice
queries so the displayed counts refresh. Legacy built-in rows remain stored
for compatibility but
are omitted from current voice choices. History responses mark entries tied to
legacy built-in rows so filters omit them while history retains its original
voice name, transcript, and audio. `features/history` owns history query keys,
persistence, pagination, and the presentation of live generation rows beside
paginated completed history. Completed rows use the
shared audio player and compact script preview; clicking that preview reuses
the transcript, while the completed-row overflow menu offers Details and
individual deletion. Both voice and voiceover menus open the shared
`components/ui/RecordDetailsModal.tsx`; it preserves common dimensions and
formatting, shows measured timings with legacy missing-value fallbacks, and
limits the script preview to 100 characters plus an ellipsis when truncated.
New presets persist server clone processing time as `cloning_s`; history retains
job processing time as `generation_s`. Voice cache projections retain cloning
time while blanking reference transcripts and storage paths.
Generating and queued rows reuse their transcript from their preview and have
no overflow menu. `lib/audio` owns shared playback
state; `lib/theme` owns theme state. `styles/tokens.css` is the palette source
of truth. The shared React Query client scopes API keys to `local-user`, uses a
one-minute stale time and 20-minute in-memory garbage-collection time, and
persists history pages, voice-list pages, and language options for 24 hours.
Persisted voice records contain row/action fields but omit reference transcripts
and storage paths. Queue snapshots, readiness, composer drafts, uploads, and generated
audio are not written to this browser API cache; live queue data is memory-only.

Mascot sheets remain at `/mascots/`. The catalog generator writes
`features/mascots/generated/mascotCatalog.ts`. Boneyard fixtures live under
`skeletons/`, with generated layouts and their registry in `skeletons/generated/`.
Use the existing generators rather than editing generated output.

## API

The Python package is `services/voice-api/homegrown_api`. Development starts
`homegrown_api.app:app` from `services/voice-api`; no editable install is required.
Install dependencies using the existing `requirements.txt`. `pyproject.toml`
declares package metadata; it does not replace or duplicate dependency pins.

- `app.py` composes middleware, API routers, media mounts and the SPA fallback.
- `config.py` resolves the existing `.env`, paths, generation limits, and the
  optional local bulk-delete password.
- `dependencies.py` supplies the fixed local-user dependency and password gate
  for permanent collection-wide deletion. There is no account authentication.
- `lifespan.py` starts model initialization in a background thread during ASGI
  lifespan startup, then yields without waiting for it. Initialization
  downloads the model snapshot when it is missing, probes the device, loads the
  model, restores persisted queue state, and starts the worker before publishing
  ready; failures publish an error status.
- `generation/model.py` owns model and device state; `generation/worker.py`
  owns job dictionaries, FIFO ordering and worker synchronization.
- `generation/budget.py` owns reference and sequence budgeting.
- `generation/schemas.py` holds request/response models shared by submission,
  retry and job-status APIs without introducing circular imports.
- `audio/` owns conversion, stitching, reference trimming and transcription.
- `persistence/stores.py` owns JSON stores, locking and reference-path migration;
  `persistence/media_paths.py` validates existing stored media paths.
- Bulk DELETE on `/api/history` and `/api/presets` holds the worker lock across
  idle checks and store cleanup. Stores track active reference uploads and
  preserve files shared by surviving records. A history revision rejects
  submissions whose preflight overlaps a bulk clear. Removed records are saved
  before media cleanup; responses identify deleted IDs and any files that could
  not be removed, allowing the UI to report partial cleanup accurately.
- Ordinary API actions, including individual deletes, use the fixed local user
  without a password. Only permanent collection-wide DELETE requests require
  the configured `HOMEGROWN_ADMIN_PASSWORD` through a constant-time comparison;
  an unset password rejects those requests. The Settings UI asks for it only in
  the second confirmation step.
- `routes/` exposes health, presets, generation, history, queue and download APIs.

Mutable state is accessed through its owning module, so replacing a model or
restoring the queue is visible to all callers. API routes are registered before
the SPA catch-all. Unknown `/api/` paths remain HTTP 404 responses.
The app keeps `/api/health` responsive during model initialization; it reports
model/device readiness and startup errors without exposing model identifiers,
model-type clues, or local model paths. The
boot-status file reports the startup phase. Other `/api/*` requests wait up to
ten minutes for startup and receive HTTP 503 if initialization fails or times
out. This lets the Studio report startup progress without sending
model-dependent work to an uninitialized model.

## Development and packaging

Root `scripts/dev.mjs`, `scripts/build.mjs` and `scripts/test-backend.mjs`
remain the command entry points. Helpers are grouped under `scripts/dev`,
`scripts/build`, `scripts/checks`, `scripts/marketing` and `scripts/migrations`.

`services/voice-api/run.py` remains the frozen entry point. PyInstaller bundles
`homegrown_api.app`, the vendored engine, and built Studio files. The launcher
keeps its independent executable, port and release layout. It opens the built
Studio as soon as the backend serves the frontend; model download and inference
initialization run in the ASGI lifespan background worker, so the packaged app
uses its normal shell and API-backed loading skeletons during startup.
`scripts/build/build_brand.py` generates the favicon, touch icons, landing-page
logo and `desktop/assets/icon.ico` from one geometry; `BrandMark.tsx` renders the
same mark in the Studio header with theme tokens.

Source organization does not migrate runtime data. Development `.env` and
`storage/` remain under `services/voice-api`. Packaged storage and model paths
retain their existing environment overrides and layout. Models, caches,
virtual environments and generated audio are local data, not source files.
`HOMEGROWN_STORAGE_DIR` also overrides source-run storage so the offline voice
benchmark can redirect every persistence owner before import. Benchmark scripts
live under `scripts/benchmarks/`; artifacts stay in ignored `.tmp/voice-speed/`.
`engine/qwen/waveform_stream.py` owns voice-clone waveform assembly. It skips
vocoder blocks whose output the old calibration discarded, preserving internal
alignment, acoustic context and sample slicing. Autoregressive conditioning is
unchanged; comparison decoders and GPU timing remain in benchmark scripts.
The `.env.example` documents variable names only; the administrator password
must remain in the ignored local `.env` and must never be copied into docs or
committed.

See [build.md](build.md) for release steps, [workflow.md](workflow.md) for usage,
and [archive/](archive/) for historical context.
