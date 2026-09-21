# Graph Report - homegrown  (2026-09-21)

## Corpus Check
- 106 files · ~127,063 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .css 7, (none) 3, .example 2)

## Summary
- 1042 nodes · 1949 edges · 75 communities (66 shown, 9 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `80c01412`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- build_splash.py
- Homegrown
- launcher.py
- ThemeContext.tsx
- run.py
- NewVoiceModal.tsx
- HistoryList.tsx
- main.py
- api.ts
- usePrefersReducedMotion
- Icons.tsx
- TalkerGraph
- StudioShell
- compilerOptions
- check_design_tokens.py
- _process_job
- _ref_facts
- HistoryList
- .from_pretrained
- StudioShell.tsx
- GenerationActivityContext.tsx
- compilerOptions
- FasterQwen3TTS
- Building a fresh `Homegrown-1.0.0.exe`
- package.json
- dependencies
- get
- GenerateButton.tsx
- PredictorGraph
- historyQuery.ts
- fast_generate_streaming
- generate
- create_preset
- devDependencies
- waveformPeaks.ts
- generate.py
- vite-boot-status.ts
- faster_qwen3_tts.py
- ._prepare_generation
- setup.sh
- Execution
- main.tsx
- react
- _seq_budget
- .generate_voice_clone_streaming
- CursorGrid.tsx
- ReferenceUpload.tsx
- .generate_voice_clone
- utils.py
- Historical deployment proposal (archived)
- VoiceoverFilters.tsx
- OptionWheel
- vercel.json
- zip_history
- Homegrown contributor guide
- Workflow — Homegrown
- api/wake.ts
- ParticleText.tsx
- useFileDrop
- dev.sh
- .oxlintrc.json
- scripts
- src/wake.ts
- ThemeSwitch
- Public API
- get_queue_script
- pageControls
- fast_generate
- tsconfig.json
- build_og_image.sh
- frontend/vercel.json
- .generate
- ._graphs_enabled
- measure_landing.sh

## God Nodes (most connected - your core abstractions)
1. `react` - 38 edges
2. `StudioShell()` - 38 edges
3. `HistoryList()` - 35 edges
4. `FasterQwen3TTS` - 34 edges
5. `usePrefersReducedMotion()` - 25 edges
6. `apiUrl()` - 20 edges
7. `compilerOptions` - 18 edges
8. `authFetch()` - 17 edges
9. `TalkerGraph` - 17 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `History and cache contract` --references--> `HistoryList()`  [INFERRED]
  CLAUDE.md → frontend/src/components/HistoryList.tsx
- `1. Project Summary` --references--> `FasterQwen3TTS`  [INFERRED]
  docs/history/HANDOFF.md → qwen/faster_qwen3_tts.py
- `2. Architecture Overview` --references--> `FasterQwen3TTS`  [INFERRED]
  docs/history/HANDOFF.md → qwen/faster_qwen3_tts.py
- `2. `frontend/` — the Studio SPA (React 19 + Vite + TS). No funnel exists here.` --references--> `get_current_user()`  [INFERRED]
  .claude/commands/ux-audit.md → backend/auth.py
- `7. Gotchas & Non-Obvious Context` --references--> `get_current_user()`  [INFERRED]
  docs/history/HANDOFF.md → backend/auth.py

## Import Cycles
- None detected.

## Communities (75 total, 9 thin omitted)

### Community 0 - "build_splash.py"
Cohesion: 0.05
Nodes (50): argparse, chunk_text(), _ensure_within_limit(), _pack(), _pack_greedy(), Splits long scripts into TTS-safe chunks without ever cutting mid-word.…, Greedily fill chunks up to `limit`. None when some unit cannot fit. Returning…, Pack units into chunks within max_chars, sized as evenly as possible. Greedy… (+42 more)

### Community 1 - "Homegrown"
Cohesion: 0.05
Nodes (41): get_current_user(), FastAPI dependency: no real authentication -- always the single local user., _idle_stop_loop(), Stops this pod once it's been idle (no authenticated request) for…, _stop_runpod_pod(), 1. `landing-page/index.html` — the marketing page. The only conversion surface., 2. `frontend/` — the Studio SPA (React 19 + Vite + TS). No funnel exists here., Constraints (+33 more)

### Community 2 - "launcher.py"
Cohesion: 0.08
Nodes (34): ctypes, http_server, acquire_single_instance_mutex(), BootState, find_backend_exe(), is_backend_healthy(), main(), make_handler() (+26 more)

### Community 3 - "ThemeContext.tsx"
Cohesion: 0.12
Nodes (26): Props, WaveRibbon(), fractionFromEvent(), onPointerDown(), onPointerMove(), seekToFraction(), usePrefersDark(), applyTheme() (+18 more)

### Community 4 - "run.py"
Cohesion: 0.10
Nodes (28): get_last_activity(), clear(), Path, Startup progress, published where the desktop launcher can read it. The…, Atomically publish the current startup phase. `throttle` skips the write if one…, Drop a status file left behind by a previous run., Read the current status. Returns {} if absent or mid-write., read() (+20 more)

### Community 5 - "NewVoiceModal.tsx"
Cohesion: 0.13
Nodes (20): mediaUrl(), Preset, presetDownloadUrl(), proceduralPeaks(), AudioActivityContext, AudioActivityProvider(), AudioActivityValue, useAudioActivity() (+12 more)

### Community 6 - "HistoryList.tsx"
Cohesion: 0.13
Nodes (20): NameControl, PendingRow(), previewOf(), TransportTime(), truncate(), VoiceoverRow(), downloadName(), formatClock() (+12 more)

### Community 7 - "main.py"
Cohesion: 0.13
Nodes (21): get_job(), _job_elapsed_seconds_locked(), _job_status_response_locked(), JobStatusResponse, list_queue(), _queue_entry_locked(), _queue_position_locked(), QueueEntry (+13 more)

### Community 8 - "api.ts"
Cohesion: 0.16
Nodes (21): ApiError, ApiErrorBody, apiUrl(), authFetch(), cancelQueuedJob(), createPreset(), downloadUrl(), GenerateJobStart (+13 more)

### Community 9 - "usePrefersReducedMotion"
Cohesion: 0.14
Nodes (16): DEFAULT_SPRING, Dock(), DockItem(), DockItemData, DockProps, DockSpringOptions, Modal(), Props (+8 more)

### Community 10 - "Icons.tsx"
Cohesion: 0.11
Nodes (16): AlertIcon(), ArrowDownIcon(), ArrowUpIcon(), CheckIcon(), CrossIcon(), DownloadIcon(), HelpIcon(), IconProps (+8 more)

### Community 11 - "TalkerGraph"
Cohesion: 0.14
Nodes (11): inference_mode, Tensor, Capture CUDA graph for single-token decode. prefill_len: simulated prefill…, Reset cache for new sequence., Copy HF DynamicCache from prefill into our StaticCache. past_key_values:…, Set padding-aware attention mask and rope deltas for decode parity., Run one decode step. input_embeds: [1, 1, hidden_size] position: current…, Captures the talker's single-token decode step as a CUDA graph, using the… (+3 more)

### Community 12 - "StudioShell"
Cohesion: 0.16
Nodes (19): Wake flow: timeout and error handling (what the user actually sees), deleteHistoryEntry(), deletePreset(), getQueueScript(), renamePreset(), GenerateButton(), StudioShell(), handleAddVoice() (+11 more)

### Community 13 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 14 - "check_design_tokens.py"
Cohesion: 0.16
Nodes (18): Match, approved_palette(), blank(), colours_in(), expand3(), main(), normalise(), Same length, same newlines, no content. (+10 more)

### Community 15 - "_process_job"
Cohesion: 0.15
Nodes (17): av, ndarray, MP3 audio output via PyAV (bundles its own FFmpeg libraries -- no system ffmpeg…, Encode a mono float32 PCM array (range [-1, 1]) directly to MP3., write_mp3(), pack_speech(), ndarray, Concatenates per-chunk audio arrays into one output, with a silence gap between… (+9 more)

### Community 16 - "_ref_facts"
Cohesion: 0.11
Nodes (19): _Budget, _chunk_duration_is_sane(), _chunk_token_cap(), _compute_seq_budget(), estimate(), EstimateRequest, Pre-flight cost of rendering `text` with `preset_id`. Chunk count has to be…, (sequence positions the reference consumes, that speaker's chars/sec). The cost… (+11 more)

### Community 17 - "HistoryList"
Cohesion: 0.16
Nodes (17): deleteQueueJob(), reorderQueue(), retryQueueJob(), zipHistory(), HistoryList(), commitRename(), handleDelete(), handleDeleteSelected() (+9 more)

### Community 18 - ".from_pretrained"
Cohesion: 0.12
Nodes (12): dtype, Return the nested qwen-tts speech tokenizer when available., Expose the codec decoder on the wrapper's public surface., Infer output audio sample rate from qwen-tts internals., Load Qwen3-TTS model and prepare CUDA graphs. Args: model_name: Model path or…, 3. Download a model, External services / API requirements, FasterQwen3TTS (+4 more)

### Community 19 - "StudioShell.tsx"
Cohesion: 0.18
Nodes (13): Estimate, getEstimate(), Props, ScriptBlock(), MAX_SCRIPT_CHARS, invalidateHistory(), useErrorToast(), Handlers (+5 more)

### Community 20 - "GenerationActivityContext.tsx"
Cohesion: 0.20
Nodes (13): QueueEntry, BootOverlay(), Props, GenerationActivityContext, GenerationActivityProvider(), GenerationActivityValue, BootStatus, bootTagline() (+5 more)

### Community 21 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 22 - "FasterQwen3TTS"
Cohesion: 0.24
Nodes (7): FasterQwen3TTS, inference_mode, Force parity (dynamic-cache) decoding when CUDA graphs are absent. The graph-…, Treat None as the method-specific upstream default., Warm up and capture CUDA graphs with given prefill length. No-op on the CPU…, Local copy of upstream talker input building for qwen-tts main repo., Qwen3-TTS model with CUDA graphs for real-time inference. Compatible API with…

### Community 23 - "Building a fresh `Homegrown-1.0.0.exe`"
Cohesion: 0.12
Nodes (15): 0. Prerequisites (once per machine), 10. Verify the artifact, 1. Python environment and model, 2. Pre-build checks, 3. Remove the dev-only backend override, 4. Build the frontend, 5. Freeze both executables (~15–20 min), 6. Stage the install layout (+7 more)

### Community 24 - "package.json"
Cohesion: 0.12
Nodes (15): name, private, type, version, driver.js, jsdom, oxlint, tailwindcss (+7 more)

### Community 25 - "dependencies"
Cohesion: 0.12
Nodes (16): dependencies, driver.js, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource-variable/archivo, framer-motion, ogl, react (+8 more)

### Community 26 - "get"
Cohesion: 0.14
Nodes (15): download_reference(), _find_preset(), health(), languages(), list_history(), list_presets(), _preset_response(), Add fields derivable/servable at read time without persisting them redundantly… (+7 more)

### Community 27 - "GenerateButton.tsx"
Cohesion: 0.19
Nodes (11): Props, Kbd(), Props, colour(), Rgb, SpecularButton(), SpecularButtonProps, tokenColour() (+3 more)

### Community 28 - "PredictorGraph"
Cohesion: 0.19
Nodes (8): PredictorGraph, inference_mode, Tensor, The full 15-step predictor loop on static buffers., Warmup and capture the CUDA graph., Run the captured graph. pred_input: [1, 2, talker_hidden_size] (past_hidden cat…, Captures the full predictor 15-step loop as a CUDA graph, using the model's…, Force lazy initialization of StaticCache layers before graph capture.

### Community 29 - "historyQuery.ts"
Cohesion: 0.21
Nodes (11): HistoryFilters, fetchHistoryPage(), HISTORY_CACHE_VERSION, HISTORY_GC_MS, HISTORY_SCOPE, HISTORY_STALE_MS, historyQueryKey(), HistoryRequest (+3 more)

### Community 30 - "fast_generate_streaming"
Cohesion: 0.22
Nodes (13): apply_repetition_penalty(), Tensor, Apply repetition penalty to logits in-place and return them. Args: logits:…, Sample a token from logits. Mirrors HF order: suppress -> temperature -> top-k…, sample_logits(), _chunk_timing(), fast_generate_streaming(), parity_generate_streaming() (+5 more)

### Community 31 - "generate"
Cohesion: 0.24
Nodes (13): cancel_queued_job(), _enqueue_job_locked(), generate(), GenerateJobStart, GenerateRequest, _persist_queue_locked(), Resubmit a dead job's own script. Server-side rather than "send the script back…, Persist enough to rebuild the queue (queued + in-flight jobs) after a restart.… (+5 more)

### Community 32 - "create_preset"
Cohesion: 0.17
Nodes (13): create_preset(), delete_history_entry(), delete_job(), delete_preset(), _model_language_name(), Whisper's language code as a name this model recognises, or None., Removes a dead job (canceled/error) from the in-memory queue list -- "done"…, Auto-transcribe a reference clip with faster-whisper (CPU, so it doesn't… (+5 more)

### Community 33 - "devDependencies"
Cohesion: 0.15
Nodes (13): devDependencies, jsdom, oxlint, @tailwindcss/cli, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+5 more)

### Community 34 - "waveformPeaks.ts"
Cohesion: 0.23
Nodes (6): audioEngine, cache, compute(), getPeaks(), PeaksResult, wavSampleRate()

### Community 35 - "generate.py"
Cohesion: 0.24
Nodes (9): Non-streaming generation loop using CUDA graphs for both predictor and talker., CUDA graph capture for the code predictor's 15-step decode loop, using…, Shared sampling helpers for talker and predictor generation., CUDA graph capture for the talker's single-token decode step, using…, torch, torch_nn_functional, transformers, transformers_masking_utils (+1 more)

### Community 36 - "vite-boot-status.ts"
Cohesion: 0.20
Nodes (9): BOOT_STATUS_ROUTE, bootStatusPlugin(), ROOT, ref_node_fs, ref_node_path, ref_node_url, @tailwindcss/vite, vite (+1 more)

### Community 37 - "faster_qwen3_tts.py"
Cohesion: 0.17
Nodes (9): logging, _cap_decode_chunk_size(), FasterQwen3TTS: Real-time TTS using CUDA graph capture. Wrapper class that…, # NOTE: single ref_text is shared across all ICL items in the batch., Bound the vocoder's per-launch decode work. Returns True if applied. The…, Local Qwen3-TTS CUDA graph acceleration package. Expected sibling files…, Suppress noisy Flash Attention dtype warnings during model loading. The wrapper…, suppress_flash_attn_warning() (+1 more)

### Community 38 - "._prepare_generation"
Cohesion: 0.29
Nodes (6): Any, ndarray, Path, Load reference audio and optionally append trailing silence. The ICL voice-…, Resolve voice clone prompt data and return (prompt, ref_ids, using_icl_mode)., Prepare inputs for generation (shared by streaming and non-streaming). Args:…

### Community 39 - "setup.sh"
Cohesion: 0.24
Nodes (8): die(), build.sh script, step(), PIP_CACHE_DIR, say(), setup.sh script, TEMP, TMP

### Community 40 - "Execution"
Cohesion: 0.18
Nodes (10): 1. Mechanical sweeps, scripted rather than eyeballed, 2. Cross-document contradiction pass, 3. Fix in place, 4. Run everything runnable, 5. Push only if clean, Constraints, Context, Execution (+2 more)

### Community 41 - "main.tsx"
Cohesion: 0.22
Nodes (9): App(), historyQueryClient, frontend_src_index, frontend_src_styles_tokens, @fontsource/ibm-plex-mono, @fontsource/inter, @fontsource-variable/archivo, react-router-dom (+1 more)

### Community 42 - "react"
Cohesion: 0.29
Nodes (6): PencilIcon(), InlineName(), Props, useFlushOnHide(), usePersistedDraft(), react

### Community 43 - "_seq_budget"
Cohesion: 0.20
Nodes (10): lifespan(), _load_json(), Memoised _compute_seq_budget. Call this, not the uncached one., _restore_queue_on_startup(), _seq_budget(), serve_frontend(), _worker_loop(), 7. Gotchas & Non-Obvious Context (+2 more)

### Community 44 - ".generate_voice_clone_streaming"
Cohesion: 0.22
Nodes (8): 1. Project Summary, 2. Architecture Overview, 3. Current State, 4. Recent Changes, 5. Environment & Credentials, 6. Next Steps, Historical handoff (archived), Stream voice-cloned speech generation, yielding audio chunks. Same as…

### Community 45 - "CursorGrid.tsx"
Cohesion: 0.24
Nodes (9): CursorGrid(), CursorGridFalloff, CursorGridProps, FALLBACK, Point, Pulse, resolveCanvasColor(), Rgb (+1 more)

### Community 46 - "ReferenceUpload.tsx"
Cohesion: 0.22
Nodes (6): UploadIcon(), Props, ReferenceUpload(), PADDING_SAFE_MIN_CHARS, REF_TRIM_SECS, UNDO_MS

### Community 47 - ".generate_voice_clone"
Cohesion: 0.22
Nodes (8): Generate speech with voice cloning using reference audio. Args: text: Text to…, 1. Install a CUDA-enabled PyTorch build, 2. Install the rest of the dependencies, 4. Get a reference audio clip + transcript (for voice cloning), 5. Run it, How to Run FasterQwen3TTS, Troubleshooting, VRAM notes (4GB cards)

### Community 48 - "utils.py"
Cohesion: 0.25
Nodes (7): contextlib, cuda_is_usable(), Small local utilities for the /qwen CUDA-graph wrapper., Return (usable, reason) for the default CUDA device.…, Resolve a requested device to one that actually works. Returns (device,…, resolve_device(), warnings

### Community 49 - "Historical deployment proposal (archived)"
Cohesion: 0.22
Nodes (8): Constraints, Historical deployment proposal (archived), Part 1: Wake/proxy layer (Vercel serverless function), Part 2: Frontend changes, Part 3: Backend changes (idle auto-stop), Part 4: CORS, Part 5: Vercel deployment, Part 6: Preset audio upload limit change

### Community 50 - "VoiceoverFilters.tsx"
Cohesion: 0.28
Nodes (8): HistoryEntry, Props, EMPTY_VOICEOVER_FILTERS, localBounds(), restoreVoiceoverFilters(), VoiceoverFilters(), VoiceoverFilterState, VoiceoverStatus

### Community 51 - "OptionWheel"
Cohesion: 0.25
Nodes (4): clamp(), OptionWheel(), OptionWheelItem, OptionWheelProps

### Community 52 - "vercel.json"
Cohesion: 0.22
Nodes (8): buildCommand, main, framework, git, deploymentEnabled, installCommand, outputDirectory, $schema

### Community 53 - "zip_history"
Cohesion: 0.29
Nodes (8): Legacy path: convert an existing .wav file to .mp3 (used only for history…, wav_to_mp3(), download_audio(), HistoryZipRequest, Serve a generated clip as a renamed .mp3 download. New generations are written…, Several voiceovers as one .zip. POST, not GET: the id list plus the display-…, _safe_filename(), zip_history()

### Community 54 - "Homegrown contributor guide"
Cohesion: 0.25
Nodes (7): Architecture, Commands, Deployment and safety, Documentation, History and cache contract, Homegrown contributor guide, UI and queue contract

### Community 55 - "Workflow — Homegrown"
Cohesion: 0.25
Nodes (7): 1. Start the app, 2. Add a voice, 3. Write a script and generate, 4. Watch it run, 5. Review past voiceovers, What's happening underneath (brief), Workflow — Homegrown

### Community 56 - "api/wake.ts"
Cohesion: 0.38
Nodes (6): config, fetchWithTimeout(), handler(), json(), WakeResponse, WakeStatus

### Community 57 - "ParticleText.tsx"
Cohesion: 0.38
Nodes (6): Particle, ParticleText(), ParticleTextProps, ParticleTextTrigger, randomBetween(), resolveColor()

### Community 58 - "useFileDrop"
Cohesion: 0.48
Nodes (6): useFileDrop(), hasFiles(), onDragEnter(), onDragLeave(), onDragOver(), onDrop()

### Community 59 - "dev.sh"
Cohesion: 0.60
Nodes (5): bold(), die(), dev.sh script, stop(), warn()

### Community 60 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 61 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, preview, test

### Community 62 - "src/wake.ts"
Cohesion: 0.40
Nodes (5): getHealth(), callWake(), USING_RUNPOD_WAKE, WakeResponse, WakeStatus

### Community 64 - "Public API"
Cohesion: 0.33
Nodes (6): `FasterQwen3TTS.from_pretrained(model_name, device="cuda", dtype=torch.bfloat16, attn_implementation="sdpa", max_seq_len=2048)`, `generate_custom_voice(text, speaker, language, instruct=None)`, `generate_voice_clone(text, language, ref_audio=None, ref_text="", ..., xvec_only=False, voice_clone_prompt=None, instruct=None)`, `generate_voice_design(text, instruct, language)`, Public API, Streaming variants

### Community 65 - "get_queue_script"
Cohesion: 0.50
Nodes (4): get_queue_script(), QueueScriptResponse, The full script for an explicitly requested pending-job reuse., Return a pending job's complete script only on an explicit reuse click. The…

### Community 67 - "fast_generate"
Cohesion: 0.50
Nodes (4): fast_generate(), inference_mode, Tensor, Fast autoregressive generation with CUDA-graphed predictor and talker.

## Knowledge Gaps
- **231 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `config` (+226 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 444 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `StudioShell()` connect `StudioShell` to `create_preset`, `ThemeContext.tsx`, `NewVoiceModal.tsx`, `api.ts`, `main.tsx`, `react`, `usePrefersReducedMotion`, `VoiceoverFilters.tsx`, `StudioShell.tsx`, `GenerationActivityContext.tsx`, `useFileDrop`, `src/wake.ts`, `ThemeSwitch`?**
  _High betweenness centrality (0.364) - this node is a cross-community bridge._
- **Why does `Part 6: reference-audio duration limit, 15s -> 60s (completed; historical)` connect `create_preset` to `Homegrown`, `_seq_budget`, `StudioShell`?**
  _High betweenness centrality (0.325) - this node is a cross-community bridge._
- **Why does `_seq_budget()` connect `_seq_budget` to `create_preset`, `main.py`, `Execution`, `_process_job`, `_ref_facts`, `generate`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `StudioShell()` (e.g. with `Part 6: reference-audio duration limit, 15s -> 60s (completed; historical)` and `Wake flow: timeout and error handling (what the user actually sees)`) actually correct?**
  _`StudioShell()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `HistoryList()` (e.g. with `History and cache contract` and `handleDeleteSelected()`) actually correct?**
  _`HistoryList()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `FasterQwen3TTS` (e.g. with `1. Project Summary` and `2. Architecture Overview`) actually correct?**
  _`FasterQwen3TTS` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _231 weakly-connected nodes found - possible documentation gaps or missing edges._