# Homegrown contributor guide

This document describes the checked-in application. User-facing usage is in
`README.md`; build and packaging instructions are in `docs/BUILD.md`.

## Commands

```bash
# Development from the repository root
bash dev.sh

# Frontend verification
cd apps/studio && npm run test && npm run lint && npm run build

# Regenerate checked-in loading skeletons after changing their fixtures or layout
# (start Vite on 127.0.0.1:5173 first)
cd apps/studio && npm run bones:build

# Backend syntax check
python -m py_compile services/voice-api/main.py
```

`dev.sh` starts FastAPI on `127.0.0.1:8000` and Vite on `:5173`. Vite proxies
`/api`, `/audio`, and `/refs`. The finished-product path is `bash build.sh` followed by the
generated `Homegrown-<version>.exe`.

## Architecture

- `services/voice-api/main.py` is the FastAPI API, job queue, local JSON persistence, and
  static `apps/studio/dist` host when that build exists. Vite serves the live Studio during dev.
- `apps/studio/src/components/StudioShell.tsx` composes voices, generation, and
  queue activity. `HistoryList.tsx` renders completed and live voiceovers.
- `boneyard-js` supplies generated, source-controlled loading layouts in
  `apps/studio/src/bones/`. `studio-startup` covers model initialization and
  `voiceover-history` covers only an uncached initial history query; do not use
  Boneyard's Suspense wrapper because history uses ordinary React Query.
- `engine/qwen/` is the vendored CUDA-graph TTS wrapper. CPU fallback exists but is
  slow.
- There is one fixed local user (`local-user`), no accounts, and no workspaces.
  Ordinary API actions are unauthenticated. Only voice and completed-voiceover
  deletion require the admin password (`Homegrown-Admin-8731!` by default,
  overridden by `ADMIN_PASSWORD`). Do not describe this as sign-in or
  multi-user isolation.

## History and cache contract

- `GET /api/history` is newest-first, accepts `limit`/`offset`, and clamps a
  page to `HISTORY_PAGE_MAX` (100). It filters by preset, date, duration, and
  canonical `q` voice-name search before pagination.
- `apps/studio/src/historyQuery.ts` owns history query keys, normalization, cache
  policy, persistence, and cache clearing. Keys are scoped to `local-user`.
- TanStack Query retains history for 20 minutes in memory, treats it as stale
  after one minute, and persists only `voiceover-history` queries in
  localStorage for 24 hours. Do not turn this into an unbounded aggregate list.
- `HistoryList` requests the active server page and prefetches one next page
  after a successful online response. It keeps previous data visible during a
  transition. Automated fetching is skipped offline; cached data remains
  available.
- Browser-local voiceover display names (`historyFileNames`) are not server
  data. Canonical searches cover all history; custom-name matches can narrow
  only loaded/cached pages. Voice preset names are server-side and are stamped
  into a history entry at generation time.
- A completed job invalidates history. Voice and history deletion first verify
  the admin password, then defer the DELETE for the seven-second Undo toast.
  The DELETE endpoint verifies again at commit. History is optimistically
  removed when the request runs, rolls back on failure, and invalidates on
  success. Unmounting cancels pending client-side deletes. Requeue/reuse does
  not mutate history.
- The initial history skeleton is shown only when `isLoading` has no query
  data. Placeholder/cached history remains visible during refetches.

## UI and queue contract

- Completed rows are paginated with persisted page-size choices: 10, 25, 50,
  or 100. The fixed pager shows all pages through four; thereafter it shows a
  sliding window of five numbered buttons, always including the current page.
  Default display numbers must account for the server page offset.
- Live queued/running/failed rows come from `GenerationActivityContext`; do not
  fold them into completed-history cache data.
- Voice/history deletes are password-gated and deferred behind a seven-second
  Undo toast; unmount cancels a pending delete. Queue cancellation is different:
  after the user confirms it, send it immediately and do not show an Undo timer
  toast. Keep this distinction in sync across the UI and API.
- The context toolbar below voiceover search/filters is permanently reserved:
  selection actions live there, never in a floating dock. One selected row
  downloads directly; multiple selected rows use the history ZIP endpoint.
- A voiceover display name is local-only; a voice preset rename uses
  `PATCH /api/presets/{id}`. Do not merge these stores.

## Deployment and safety

- Local development and the Windows self-extracting build are supported.
- The app has no general authentication; only voice/history deletion requires
  the admin password. The shared default is not a LAN security boundary. Bind
  only to trusted networks and override `ADMIN_PASSWORD` before sharing access.
- Never commit `.env`, model files, generated audio, or local storage data.

## Documentation

Keep `README.md`, `docs/workflow.md`, and this file in agreement with source.
`docs/history/` is archived context, not current operational guidance.
After a skeleton fixture or app-shell layout change, regenerate the bones at
375, 768, 1025, and 1280px with `npm run bones:build`; do not hand-edit the
generated JSON or registry.
