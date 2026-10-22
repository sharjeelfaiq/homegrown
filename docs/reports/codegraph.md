# Graph Report - homegrown  (2026-10-21)

> **Historical snapshot, not a current code map.** This generated report was
> built from commit `e0b07f41` before later reorganizations and feature changes.
> Its symbol counts, file paths, communities, and dependency links describe that
> revision only. Use the current source and `docs/architecture.md` for present
> ownership; regenerate this report from a fresh CodeGraph index before relying
> on graph findings. The index is not checked into this checkout.

## Corpus Check
- 127 files · ~197,041 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 16 file(s) not represented in the graph (top: .css 6, (none) 3, .example 2)

## Summary
- 1136 nodes · 2211 edges · 81 communities (67 shown, 14 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e0b07f41`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- usePrefersReducedMotion
- FasterQwen3TTS
- build.mjs
- studio/package.json
- StudioShell.tsx
- vitest
- react
- api.ts
- launcher.py
- ThemeContext.tsx
- HistoryList.tsx
- historyQuery.ts
- main.py
- GenerateButton.tsx
- package.json
- MascotPicker
- scripts
- run.py
- fast_generate
- VoiceoverPlayer.tsx
- MascotPicker
- dependencies
- compilerOptions
- faster_qwen3_tts.py
- TalkerGraph
- check_design_tokens.py
- ClonedVoicesSection.tsx
- _process_job
- resolve_stored_media_path
- dev.mjs
- compilerOptions
- HistoryList
- VoiceoverFilters.tsx
- PredictorGraph
- generate
- devDependencies
- check_palette.py
- _save_json
- scripts
- main.tsx
- useBootStatus.ts
- pathlib
- text_chunker.py
- _reference_path
- generate-mascot-catalog.node-test.mjs
- build_splash.py
- _Budget
- CursorGrid.tsx
- StatusMark.tsx
- useOnboardingTour.ts
- vite-boot-status.ts
- BoneyardFixtures.tsx
- _persist_queue_locked
- ClonedVoicesSection
- migrate_storage_paths.py
- fast_generate_streaming
- check_contrast.py
- zip_history
- GenerationActivityContext.tsx
- ParticleText.tsx
- Homegrown contributor guide
- media_paths.py
- start-backend-after-studio.mjs
- check_orphan_css.py
- .oxlintrc.json
- create_preset
- test-backend.mjs
- registry.ts
- tsconfig.json
- build_og_image.sh
- boneyard.d.ts
- ship.md
- ux-audit.md
- measure_landing.sh
- src_bones_studio_startup_bones
- src_bones_voiceover_history_bones
- src_generated_mascotcatalog
- src_generated_mascotcatalog_default_mascot_id
- src_generated_mascotcatalog_mascots
- src_index
- src_styles_tokens

## God Nodes (most connected - your core abstractions)
1. `react` - 42 edges
2. `StudioShell()` - 34 edges
3. `FasterQwen3TTS` - 30 edges
4. `HistoryList()` - 27 edges
5. `apiUrl()` - 21 edges
6. `compilerOptions` - 19 edges
7. `authFetch()` - 17 edges
8. `MascotPicker()` - 17 edges
9. `TalkerGraph` - 17 edges
10. `usePrefersReducedMotion()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `History and cache contract` --references--> `HistoryList()`  [INFERRED]
  CLAUDE.md → apps/studio/src/features/history/HistoryList.tsx
- `UI and queue contract` --references--> `MascotPicker()`  [INFERRED]
  CLAUDE.md → apps/studio/src/features/mascots/MascotPicker.tsx
- `UI and queue contract` --references--> `useOnboardingTour()`  [INFERRED]
  CLAUDE.md → apps/studio/src/features/onboarding/useOnboardingTour.ts
- `UI and queue contract` --references--> `wakeBackend()`  [INFERRED]
  CLAUDE.md → apps/studio/src/features/startup/wake.ts
- `UI and queue contract` --references--> `StatusMark()`  [INFERRED]
  CLAUDE.md → apps/studio/src/components/ui/StatusMark.tsx

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Numbered Mascot Navigation Cycle** — mascot_picker_component, mascot_1, mascot_2, mascot_3 [EXTRACTED 1.00]

## Communities (81 total, 14 thin omitted)

### Community 0 - "usePrefersReducedMotion"
Cohesion: 0.18
Nodes (10): LatticeLoader(), Modal(), Props, Props, SettingsModal(), AppTooltip(), UndoCountdown(), usePrefersReducedMotion() (+2 more)

### Community 1 - "FasterQwen3TTS"
Cohesion: 0.06
Nodes (41): Any, dtype, FasterQwen3TTS, inference_mode, ndarray, Path, Stream voice-cloned speech generation, yielding audio chunks. Same as…, False on the CPU fallback path, where from_pretrained built no graphs. (+33 more)

### Community 2 - "build.mjs"
Cohesion: 0.08
Nodes (42): ref_node_crypto, ref_node_perf_hooks, ref_node_stream, atRoot(), BuildError, BuildLogger, commandText(), die() (+34 more)

### Community 3 - "studio/package.json"
Cohesion: 0.15
Nodes (12): name, private, type, version, jsdom, oxlint, tailwindcss, @tailwindcss/cli (+4 more)

### Community 4 - "StudioShell.tsx"
Cohesion: 0.17
Nodes (14): Estimate, getEstimate(), Props, ScriptBlock(), MAX_SCRIPT_CHARS, PADDING_SAFE_MIN_CHARS, UNDO_MS, useErrorToast() (+6 more)

### Community 5 - "vitest"
Cohesion: 0.20
Nodes (6): presets, GenerateButton(), boop, @testing-library/jest-dom, @testing-library/react, vitest

### Community 6 - "react"
Cohesion: 0.36
Nodes (4): InlineName(), Props, useFlushOnHide(), react

### Community 7 - "api.ts"
Cohesion: 0.10
Nodes (40): ApiError, ApiErrorBody, apiUrl(), authFetch(), createPreset(), deleteHistoryEntry(), deletePreset(), downloadUrl() (+32 more)

### Community 8 - "launcher.py"
Cohesion: 0.08
Nodes (35): ctypes, acquire_single_instance_mutex(), BootState, find_backend_exe(), is_backend_healthy(), main(), make_handler(), do_GET() (+27 more)

### Community 9 - "ThemeContext.tsx"
Cohesion: 0.11
Nodes (29): ThemeSwitch(), Props, WaveRibbon(), fractionFromEvent(), onPointerDown(), onPointerMove(), seekToFraction(), usePrefersDark() (+21 more)

### Community 10 - "HistoryList.tsx"
Cohesion: 0.13
Nodes (21): NameControl, PendingRow(), RowHead(), TransportTime(), truncate(), VoiceoverRow(), formatClock(), formatTimeOfDay() (+13 more)

### Community 11 - "historyQuery.ts"
Cohesion: 0.16
Nodes (15): HistoryFilters, HistoryPage, listHistory(), fetchHistoryPage(), HISTORY_CACHE_VERSION, HISTORY_GC_MS, HISTORY_SCOPE, HISTORY_STALE_MS (+7 more)

### Community 12 - "main.py"
Cohesion: 0.10
Nodes (29): dotenv, fastapi_middleware_cors, fastapi_responses, fastapi_staticfiles, filelock, get, io, math (+21 more)

### Community 13 - "GenerateButton.tsx"
Cohesion: 0.24
Nodes (9): Props, colour(), Rgb, SpecularButton, SpecularButtonProps, tokenColour(), MOD_ARIA, MOD_KEY (+1 more)

### Community 14 - "package.json"
Cohesion: 0.25
Nodes (7): description, devDependencies, concurrently, name, private, version, concurrently

### Community 15 - "MascotPicker"
Cohesion: 0.09
Nodes (21): Historical deployment proposal (archived), Historical handoff (archived), Create and manage voices, First-run orientation, Generate and cancel voiceovers, Homegrown workflow, Persistence and startup, Review, search, and delete history (+13 more)

### Community 16 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, bones:build, build, dev, lint, test, test:backend

### Community 17 - "run.py"
Cohesion: 0.11
Nodes (26): Event, fnmatch, os, get_current_user(), FastAPI dependency: no real authentication -- always the single local user., clear(), Path, Startup progress, published where the desktop launcher can read it. The… (+18 more)

### Community 18 - "fast_generate"
Cohesion: 0.14
Nodes (19): fast_generate(), inference_mode, Tensor, Non-streaming generation loop using CUDA graphs for both predictor and talker., Fast autoregressive generation with CUDA-graphed predictor and talker., CUDA graph capture for the code predictor's 15-step decode loop, using…, apply_repetition_penalty(), Tensor (+11 more)

### Community 19 - "VoiceoverPlayer.tsx"
Cohesion: 0.14
Nodes (13): audioEngine, cache, compute(), getPeaks(), PeaksResult, proceduralPeaks(), wavSampleRate(), AudioActivityContext (+5 more)

### Community 20 - "MascotPicker"
Cohesion: 0.13
Nodes (16): clampSize(), defaultSize(), MascotPicker(), clamp(), onPointerDown(), onPointerMove(), onResizeKeyDown(), onResizePointerMove() (+8 more)

### Community 21 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, @base-ui/react, boneyard-js, driver.js, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource-variable/archivo, framer-motion (+13 more)

### Community 22 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 23 - "faster_qwen3_tts.py"
Cohesion: 0.11
Nodes (16): contextlib, _cap_decode_chunk_size(), FasterQwen3TTS: Real-time TTS using CUDA graph capture. Wrapper class that…, # NOTE: single ref_text is shared across all ICL items in the batch., Bound the vocoder's per-launch decode work. Returns True if applied. The…, Local Qwen3-TTS CUDA graph acceleration package. Expected sibling files…, cuda_is_usable(), Small local utilities for the /qwen CUDA-graph wrapper. (+8 more)

### Community 24 - "TalkerGraph"
Cohesion: 0.14
Nodes (11): inference_mode, Tensor, Capture CUDA graph for single-token decode. prefill_len: simulated prefill…, Reset cache for new sequence., Copy HF DynamicCache from prefill into our StaticCache. past_key_values:…, Set padding-aware attention mask and rope deltas for decode parity., Run one decode step. input_embeds: [1, 1, hidden_size] position: current…, Captures the talker's single-token decode step as a CUDA graph, using the… (+3 more)

### Community 25 - "check_design_tokens.py"
Cohesion: 0.16
Nodes (18): Match, approved_palette(), blank(), colours_in(), expand3(), main(), normalise(), Same length, same newlines, no content. (+10 more)

### Community 26 - "ClonedVoicesSection.tsx"
Cohesion: 0.13
Nodes (13): Preset, Props, ConfirmDeleteModal(), Props, ContentProps, Dropdown, PopupProps, RootProps (+5 more)

### Community 27 - "_process_job"
Cohesion: 0.15
Nodes (17): av, numpy, ndarray, MP3 audio output via PyAV (bundles its own FFmpeg libraries -- no system ffmpeg…, Encode a mono float32 PCM array (range [-1, 1]) directly to MP3., write_mp3(), pack_speech(), ndarray (+9 more)

### Community 28 - "resolve_stored_media_path"
Cohesion: 0.18
Nodes (12): _migrate_preset_media_paths(), Canonicalize valid legacy preset paths once, preserving a backup., _inside(), Path, A persisted media path is missing, unsafe, or cannot be migrated., Return the stable persisted form for a path owned by ``storage_dir``., Resolve a persisted path without allowing it to escape local storage. New…, resolve_stored_media_path() (+4 more)

### Community 29 - "dev.mjs"
Cohesion: 0.12
Nodes (12): ref_node_os, backend, backendEnv, backendEnvPath, bold(), isFile(), PORTS, python (+4 more)

### Community 30 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 31 - "HistoryList"
Cohesion: 0.17
Nodes (14): cancelQueuedJob(), deleteQueueJob(), reorderQueue(), retryQueueJob(), HistoryList(), commitRename(), handleCancel(), handleDismiss() (+6 more)

### Community 32 - "VoiceoverFilters.tsx"
Cohesion: 0.16
Nodes (12): HistoryEntry, DropdownSelect(), DropdownSelectOption, Props, Props, EMPTY_VOICEOVER_FILTERS, localBounds(), restoreVoiceoverFilters() (+4 more)

### Community 33 - "PredictorGraph"
Cohesion: 0.19
Nodes (8): PredictorGraph, inference_mode, Tensor, The full 15-step predictor loop on static buffers., Warmup and capture the CUDA graph., Run the captured graph. pred_input: [1, 2, talker_hidden_size] (past_hidden cat…, Captures the full predictor 15-step loop as a CUDA graph, using the model's…, Force lazy initialization of StaticCache layers before graph capture.

### Community 34 - "generate"
Cohesion: 0.21
Nodes (14): BaseModel, post, _canonical_language(), estimate(), EstimateRequest, generate(), GenerateJobStart, GenerateRequest (+6 more)

### Community 35 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, jsdom, oxlint, @tailwindcss/cli, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+5 more)

### Community 36 - "check_palette.py"
Cohesion: 0.27
Nodes (11): colorsys, contrast(), hue_and_lightness(), hue_gap(), luminance(), main(), parse_blocks(), Fail if a theme's colours collide in hue, or its surfaces fail to separate.… (+3 more)

### Community 37 - "_save_json"
Cohesion: 0.18
Nodes (13): delete, patch, delete_history_entry(), delete_job(), delete_preset(), download_reference(), _find_preset(), Rename a voice. Deliberately does NOT touch `preset_name` on existing history… (+5 more)

### Community 38 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, bones:build, build, dev, generate:mascot-catalog, lint, prebuild, predev (+4 more)

### Community 39 - "main.tsx"
Cohesion: 0.21
Nodes (10): App(), isBoneyardBuild(), BoneyardCaptureFixtures(), historyQueryClient, apps_studio_src_index, apps_studio_src_styles_tokens, @fontsource/ibm-plex-mono, @fontsource/inter (+2 more)

### Community 40 - "useBootStatus.ts"
Cohesion: 0.29
Nodes (9): BootOverlay(), Props, BootStatus, bootTagline(), bootWord(), TAGLINES, useBootStatus(), WORDS (+1 more)

### Community 41 - "pathlib"
Cohesion: 0.20
Nodes (6): asyncio, pathlib, ModelStartupTests, tempfile, unittest, unittest_mock

### Community 42 - "text_chunker.py"
Cohesion: 0.27
Nodes (10): Pattern, chunk_text(), _ensure_within_limit(), _pack(), _pack_greedy(), Splits long scripts into TTS-safe chunks without ever cutting mid-word.…, Greedily fill chunks up to `limit`. None when some unit cannot fit. Returning…, Pack units into chunks within max_chars, sized as evenly as possible. Greedy… (+2 more)

### Community 43 - "_reference_path"
Cohesion: 0.21
Nodes (12): _compute_seq_budget(), list_presets(), _preset_response(), Add fields derivable/servable at read time without persisting them redundantly…, Resolve a preset clip and persist a valid legacy-path migration., (sequence positions the reference consumes, that speaker's chars/sec). The cost…, (chunk_chars, max_new_tokens, frames_per_char) for this preset's reference.…, Cache identity for a preset's reference clip, or None if unreadable. mtime is… (+4 more)

### Community 44 - "generate-mascot-catalog.node-test.mjs"
Cohesion: 0.31
Nodes (8): buildMascotCatalog(), generateMascotCatalog(), main(), renderMascotCatalog(), ref_node_assert, ref_node_fs, ref_node_path, ref_node_test

### Community 45 - "build_splash.py"
Cohesion: 0.27
Nodes (10): hashlib, compile_css(), main(), Compile the launcher splash's Tailwind CSS and inline it into a Python module.…, The CLI from the frontend's node_modules. Not a global install., Hash of the inputs, so --check can tell stale from merely reordered., render(), sources_fingerprint() (+2 more)

### Community 46 - "_Budget"
Cohesion: 0.18
Nodes (11): NamedTuple, _Budget, _chunk_duration_is_sane(), _chunk_token_cap(), What fits alongside a preset's reference clip. Indexable, so existing…, False when a chunk's audio is too far from what its text should take., Frame cap for ONE chunk, sized to that chunk's own text. The job-level…, Everything a preset's reference clip decides, computed once together.… (+3 more)

### Community 47 - "CursorGrid.tsx"
Cohesion: 0.24
Nodes (9): CursorGrid(), CursorGridFalloff, CursorGridProps, FALLBACK, Point, Pulse, resolveCanvasColor(), Rgb (+1 more)

### Community 48 - "StatusMark.tsx"
Cohesion: 0.22
Nodes (9): clamp01(), MORPH, StatusMark(), StatusMarkProps, StatusMarkStatus, TEXT, UI, UI and queue contract (+1 more)

### Community 49 - "useOnboardingTour.ts"
Cohesion: 0.29
Nodes (8): hasCompletedTour(), rememberTour(), StartOptions, driverMock, reducedMotionMock, TourHarness(), useOnboardingTour(), driver.js

### Community 50 - "vite-boot-status.ts"
Cohesion: 0.24
Nodes (7): BOOT_STATUS_ROUTE, bootStatusPlugin(), ROOT, ref_node_url, @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 51 - "BoneyardFixtures.tsx"
Cohesion: 0.28
Nodes (3): snapshotConfig, StudioStartupFixture(), VoiceoverHistoryFixture()

### Community 52 - "_persist_queue_locked"
Cohesion: 0.25
Nodes (9): FastAPI, cancel_queued_job(), _enqueue_job_locked(), lifespan(), _load_json(), _persist_queue_locked(), Persist enough to rebuild the queue (queued + in-flight jobs) after a restart.…, _restore_queue_on_startup() (+1 more)

### Community 53 - "ClonedVoicesSection"
Cohesion: 0.39
Nodes (7): mediaUrl(), ClonedVoicesSection(), handleDrop(), handleVoiceFile(), hasFiles(), showUploadResult(), togglePreview()

### Community 54 - "migrate_storage_paths.py"
Cohesion: 0.29
Nodes (7): argparse, json, main(), Path, Repair valid legacy media paths in local voice-api JSON stores. The script is…, visit(), shutil

### Community 55 - "fast_generate_streaming"
Cohesion: 0.36
Nodes (8): Files, _chunk_timing(), fast_generate_streaming(), parity_generate_streaming(), inference_mode, Tensor, Parity-mode streaming: disables CUDA graphs and decodes the full sequence via…, Stream autoregressive generation with CUDA-graphed predictor and talker. Yields…

### Community 56 - "check_contrast.py"
Cohesion: 0.39
Nodes (7): contrast(), luminance(), main(), Fail if any theme's text colours drop below WCAG AA on the surfaces they sit…, Every theme's raw hex tokens, with Studio's :root values as the base., srgb_to_linear(), themes()

### Community 57 - "zip_history"
Cohesion: 0.29
Nodes (8): Legacy path: convert an existing .wav file to .mp3 (used only for history…, wav_to_mp3(), download_audio(), HistoryZipRequest, Serve a generated clip as a renamed .mp3 download. New generations are written…, Several voiceovers as one .zip. POST, not GET: the id list plus the display-…, _safe_filename(), zip_history()

### Community 58 - "GenerationActivityContext.tsx"
Cohesion: 0.38
Nodes (6): listQueue(), QueueEntry, GenerationActivityContext, GenerationActivityProvider(), GenerationActivityValue, useGenerationActivity()

### Community 59 - "ParticleText.tsx"
Cohesion: 0.38
Nodes (6): Particle, ParticleText(), ParticleTextProps, ParticleTextTrigger, randomBetween(), resolveColor()

### Community 60 - "Homegrown contributor guide"
Cohesion: 0.29
Nodes (6): Architecture, Commands, Deployment and safety, Documentation, History and cache contract, Homegrown contributor guide

### Community 61 - "media_paths.py"
Cohesion: 0.29
Nodes (4): re, Fail if the desktop build's two copies of its port number disagree.…, Safe, backwards-compatible resolution of persisted media paths., sys

### Community 62 - "start-backend-after-studio.mjs"
Cohesion: 0.33
Nodes (6): ref_node_child_process, ref_node_net, backend, [python, ...args], studioIsListening(), waitForStudio()

### Community 63 - "check_orphan_css.py"
Cohesion: 0.43
Nodes (6): css_classes(), glued_classes(), main(), Path, Find CSS class rules that no component uses, and classes no CSS defines.…, tsx_classes()

### Community 64 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 65 - "create_preset"
Cohesion: 0.33
Nodes (6): create_preset(), _model_language_name(), Whisper's language code as a name this model recognises, or None., Auto-transcribe a reference clip with faster-whisper (CPU, so it doesn't…, _transcribe_audio(), UploadFile

### Community 66 - "test-backend.mjs"
Cohesion: 0.40
Nodes (4): candidates, python, result, root

## Knowledge Gaps
- **232 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `name` (+227 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 472 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vite` connect `vite-boot-status.ts` to `studio/package.json`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `react` connect `react` to `usePrefersReducedMotion`, `studio/package.json`, `StudioShell.tsx`, `vitest`, `ThemeContext.tsx`, `HistoryList.tsx`, `GenerateButton.tsx`, `VoiceoverPlayer.tsx`, `MascotPicker`, `ClonedVoicesSection.tsx`, `VoiceoverFilters.tsx`, `main.tsx`, `useBootStatus.ts`, `CursorGrid.tsx`, `StatusMark.tsx`, `useOnboardingTour.ts`, `BoneyardFixtures.tsx`, `GenerationActivityContext.tsx`, `ParticleText.tsx`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `FasterQwen3TTS` connect `FasterQwen3TTS` to `TalkerGraph`, `PredictorGraph`, `fast_generate_streaming`, `faster_qwen3_tts.py`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `FasterQwen3TTS` (e.g. with `PredictorGraph` and `TalkerGraph`) actually correct?**
  _`FasterQwen3TTS` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `HistoryList()` (e.g. with `readHistoryPageSize()` and `History and cache contract`) actually correct?**
  _`HistoryList()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _232 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `FasterQwen3TTS` be split into smaller, more focused modules?**
  _Cohesion score 0.05687645687645688 - nodes in this community are weakly interconnected._
