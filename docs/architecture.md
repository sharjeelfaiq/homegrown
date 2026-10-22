# Architecture

Homegrown consists of a React Studio, a local FastAPI service, a Windows
launcher, and a vendored Qwen inference wrapper. The marketing page is a
separate static site.

## Studio

`apps/studio/src/main.tsx` loads fonts, styles and generated skeletons, then
mounts `app/App.tsx` inside `app/providers.tsx`. Provider order is Tooltip,
Theme, QueryClient, BrowserRouter, AudioActivity, then GenerationActivity.

`app/StudioShell.tsx` coordinates the feature modules under `features/`.
Feature tests live beside their implementation. Shared controls live under
`components/ui`, playback views under `components/audio`, and canvas/WebGL
effects under `components/effects`; their CSS is colocated. Shared hooks live
under `hooks/`, while feature-specific hooks live with their feature.

`lib/api.ts` uses same-origin API and media paths. `features/history` owns
history query keys, persistence and pagination. `lib/audio` owns shared
playback state; `lib/theme` owns theme state. `styles/tokens.css` is the palette
source of truth.

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
- `config.py` resolves the existing `.env`, paths and generation limits.
- `dependencies.py` supplies the fixed local-user dependency. There is no authentication.
- `lifespan.py` coordinates model probing/loading, queue restoration, worker
  startup and shutdown, and boot-status publication.
- `generation/model.py` owns model and device state; `generation/worker.py`
  owns job dictionaries, FIFO ordering and worker synchronization.
- `generation/budget.py` owns reference and sequence budgeting.
- `generation/schemas.py` holds request/response models shared by submission,
  retry and job-status APIs without introducing circular imports.
- `audio/` owns conversion, stitching, reference trimming and transcription.
- `persistence/stores.py` owns JSON stores, locking and reference-path migration;
  `persistence/media_paths.py` validates existing stored media paths.
- `routes/` exposes health, presets, generation, history, queue and download APIs.

Mutable state is accessed through its owning module, so replacing a model or
restoring the queue is visible to all callers. API routes are registered before
the SPA catch-all. Unknown `/api/` paths remain HTTP 404 responses.

## Development and packaging

Root `scripts/dev.mjs`, `scripts/build.mjs` and `scripts/test-backend.mjs`
remain the command entry points. Helpers are grouped under `scripts/dev`,
`scripts/build`, `scripts/checks`, `scripts/marketing` and `scripts/migrations`.

`services/voice-api/run.py` remains the frozen entry point. PyInstaller bundles
`homegrown_api.app`, the vendored engine, and built Studio files. The launcher
keeps its independent executable, port and release layout. Splash sources live
under `desktop/launcher/splash`; `scripts/build/build_splash.py` generates
`desktop/launcher/_splash.py` using the Studio's Tailwind CLI.

Source organization does not migrate runtime data. Development `.env` and
`storage/` remain under `services/voice-api`. Packaged storage and model paths
retain their existing environment overrides and layout. Models, caches,
virtual environments and generated audio are local data, not source files.

See [build.md](build.md) for release steps, [workflow.md](workflow.md) for usage,
and [archive/](archive/) for historical context.
