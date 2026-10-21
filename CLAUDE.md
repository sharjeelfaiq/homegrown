# Homegrown contributor guide

This document describes the checked-in application. User-facing usage is in
`README.md`; build and packaging instructions are in `docs/BUILD.md`.

## Commands

```bash
# Development from the repository root
npm run dev

# All automated tests (Studio tests followed by backend unit tests; no builds)
npm run test

# Frontend lint and production build (production build is separate from tests)
cd apps/studio && npm run lint && npm run build
cd ../..

# Regenerate checked-in loading skeletons after changing their fixtures or layout
# (start Vite on 127.0.0.1:5173 first)
cd apps/studio && npm run bones:build

# Backend syntax check
python -m py_compile services/voice-api/main.py
```

`npm run build` is a ten-stage packaging pipeline with a numbered overview
(without a `PLAN` heading); each row shows a measured baseline ETA (for example
`(17:42m)` for backend freezing) until the current run replaces it with its
actual duration. A stage shows `(measuring)` only when no baseline exists.
Interactive terminals get a live
ANSI progress bar; CI and redirected output get line-oriented progress
without escape sequences. Detailed child output is written to
`.tmp/build-logs/build-<timestamp>.log`, including stage start/completion,
cumulative elapsed times, and a final machine-readable timing summary. Failures
show only the failed stage and a bounded tail. The build still restores `apps/studio/.env.local`
on success, failure, or interruption and produces the same self-extracting
`dist/Homegrown-<version>.exe` artifact.

`npm run dev` starts Vite on `:5173` first, then FastAPI on `127.0.0.1:8000`,
via `concurrently` from the root `package.json`. Vite proxies `/api`, `/audio`,
and `/refs`. The finished-product path is `npm run build` followed by the generated
`Homegrown-<version>.exe`. Both root commands are thin wrappers over
`scripts/dev.mjs` and `scripts/build.mjs`.

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
  All API actions are unauthenticated, including voice and completed-voiceover
  deletion. Do not describe this as sign-in or multi-user isolation; bind only
  to trusted networks.

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
- A completed job invalidates history. Voice and history deletion are scheduled
  directly from their row actions and deferred for the seven-second Undo toast;
  the server DELETE runs only after that window expires. History is optimistically
  removed when the request runs, rolls back on failure, and invalidates on
  success. Unmounting cancels pending client-side deletes. Requeue/reuse does
  not mutate history.
- The initial history skeleton is shown only when `isLoading` has no query
  data. Placeholder/cached history remains visible during refetches.

## UI and queue contract

- The Script editor keeps an overflow-visible, rounded card frame. Its visible
  border is a final non-interactive overlay child, painted above the opaque
  footer; keep that element after the textarea and footer so every corner
  remains continuous when focused. The editor height uses
  `clamp(300px, 39svh, 400px)`; keep the input grid row flexible so the footer
  stays visible.
- The Script editor footer's script-language selector uses the shared
  Base UI menu-backed dropdown, populated from `GET /api/languages` (the loaded
  checkpoint's own `codec_language_id`, read once when the model reports
  ready). Its unselected option is **Select language**; empty list hides the
  control. Selection dropdowns must provide a field-specific `Select {label}`
  placeholder/default option. Keep meaningful, persisted settings (such as
  page size or System theme) selected instead of replacing them with prompts.
  Generation requires a non-empty script,
  an available voice, an explicitly selected script language, and a ready
  model. The language choice is in-memory only — do not persist it or reset it
  when the voice changes. `POST /api/generate` validates `language` against the
  same table and returns 400 otherwise, so an unsupported value is a refused
  request rather than a failed job.
- `ClonedVoicesSection.tsx` is the persistent voice-management card. It owns
  voice search, selection, rename, preview, download, delete, and Clone voice.
  File drops clone only when dropped on this card; the rest of Studio only
  suppresses the browser's default file-open behavior.
  Clone voice and Generate share StudioShell's model-ready gate: they stay
  semantically disabled until `wakeBackend` observes `model_loaded: true`.
  During startup their tooltip says `Voice model is loading — this can take up
  to 3 minutes.` The API may select CPU when no usable GPU exists;
  that fallback is ready only after its model initialization completes.
  While Studio is checking startup, it keeps a **Voice model is loading** toast
  with an indeterminate `StatusMark` spinner until readiness or failure.
- Inline voice upload uses the ReactBits-style `StatusMark`: amber while
  running, green after success, and red after failure. The final success or
  failure mark is intentionally retained for two seconds before restoring the
  Upload icon. Keep the status attributes (`data-status`) and that timing in
  sync with `ClonedVoicesSection.test.tsx`.
- Backend startup failures are reported through a fixed, pulsing warning button
  at the lower-left of Studio; its modal shows the relevant message and Retry
  action when available. Do not put a failure banner above the Script editor.
  Failed background history refreshes keep cached rows and do not add an
  inline warning above the voiceovers list.
- `MascotPicker` is fixed to the viewport rather than participating in the
  composer or Voiceovers layout. Before a completed drag it follows the
  Voiceovers lower-left corner on wide screens and the viewport lower-left on
  narrow screens; after drag it retains only a clamped in-memory position.
  The mascot artwork is the drag surface. Mark only the side navigation
  controls with `data-mascot-navigation` and only the corner resize grip with
  `data-mascot-resize`, so their clicks cycle or resize without beginning a
  drag. The wrapper takes pointer capture lazily — only once movement passes
  the drag threshold — because capturing on pointerdown retargets the pointerup
  and the mascot's own button never receives the click that plays its reaction.
  A finished drag swallows exactly one trailing click on the artwork, never a
  navigation or resize click. The resize grip is keyboard-operable and bounded
  to 56–176px, defaulting to 80px below 640px and 112px at or above it; like
  the dragged position, the chosen size is in-memory only and is never
  persisted.
- `useOnboardingTour` keeps a static target sequence: header controls, voice
  controls, Script editor, Generate, Voiceovers, then search/filters. Do not
  add mascot, queue-row, error, or other conditional targets; the automatic
  model-ready tour must work on an empty Studio.
- The mascot catalog is generated from top-level numbered pairs in
  `apps/studio/public/mascots/`: `<id>a.webp` is directions and `<id>b.webp`
  is reactions. Do not hand-edit `src/generated/mascotCatalog.ts`; add a pair,
  run a normal Studio command, and commit the assets with its regenerated
  catalog. Mascot 2 (the Cat sheets) is the default when it exists.
- Generate is a compact right-aligned action in the Script editor footer; the
  language selector is left-aligned. Its tooltip exposes the Ctrl/Cmd+Enter
  shortcut when ready and the model-loading explanation while startup blocks
  it. Keep `.generate-action-auxiliary` visually stable and do not reintroduce
  shortcut or prerequisite copy beside the action.
- Completed rows are paginated with persisted page-size choices: 10, 25, 50,
  or 100. The fixed pager shows all pages through four; thereafter it shows a
  sliding window of five numbered buttons, always including the current page.
  Default display numbers must account for the server page offset.
- Live queued/running/failed rows come from `GenerationActivityContext`; do not
  fold them into completed-history cache data.
- Voice/history deletes are deferred behind a seven-second Undo toast; unmount
  cancels a pending delete. Queue cancellation is different:
  after the user confirms it, send it immediately and do not show an Undo timer
  toast. Keep this distinction in sync across the UI and API.
  A running job checks for cancellation between streamed audio pieces (about
  one second), so it may stop partway through a script chunk.
- The Voiceovers header contains search and a compact filter popover. Its footer
  contains pagination and the total history count, vertically centered. Do not
  restore batch selection or selection-action layout shifts.
- Dropdown selectors, the theme menu, and voiceover action menus use
  `@base-ui/react/menu` through the shared `Dropdown.tsx` wrapper. Selection
  dropdowns share their raised surface, border, type, focus, and hover style
  through `.dropdown-select-trigger`; quick-filter triggers are shorter and
  use smaller text. The language and quick-filter option windows share the
  `standard-options-popup` style and 144px width (bounded by the viewport).
  Tooltips use the shared Base UI tooltip wrapper. Interface glyphs come from
  `lucide-react`. The animated status ring and undo countdown ring are bespoke
  visuals, not icon glyphs.
- A voiceover display name is local-only; a voice preset rename uses
  `PATCH /api/presets/{id}`. Do not merge these stores.
  Voiceover names, like voice preset names, stay read-only until their pencil
  button is clicked; clicking the name itself must not enter edit mode.

## Deployment and safety

- Local development and the Windows self-extracting build are supported.
- The app has no authentication. Any client that reaches the API can use all
  actions, including deletion. Bind only to trusted networks.
- Never commit `.env`, model files, generated audio, or local storage data.

## Documentation

Keep `README.md`, `docs/workflow.md`, and this file in agreement with source.
`docs/history/` is archived context, not current operational guidance.
After a skeleton fixture or app-shell layout change, regenerate the bones at
375, 768, 1025, and 1280px with `npm run bones:build`; do not hand-edit the
generated JSON or registry.
