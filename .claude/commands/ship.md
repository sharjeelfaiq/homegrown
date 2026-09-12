---
description: Reconcile every maintained .md with the code, run all six gates plus lint/typecheck, then push if nothing is left that only a human can judge
---

# Ship

Bring every maintained `.md` file in this repository back into agreement with the
code as it actually is, verify the result with the repo's own automated gates,
and push — but only if nothing is left that only a human can judge.

Extra scope or focus for this run (may be empty): $ARGUMENTS

## Context

**Maintained docs — these are the ones to correct:**

| File | Covers |
|---|---|
| `README.md` | setup, running, "Making a voice that actually works", Using the app, API table, troubleshooting, repo layout |
| `CLAUDE.md` | architecture and the hard-won gotchas |
| `docs/workflow.md` | day-to-day usage, end to end |
| `docs/BUILD.md` | build procedure, incl. the pre-build gate list |
| `docs/DEPLOYMENT.md` | the dormant Vercel + RunPod path |
| `docs/gpu-notes.md` | measurements behind the empirical constants, plus the dated experiment log |

**Do NOT rewrite these to "current state":**

- `docs/history/HANDOFF.md`, `docs/history/DEPLOY_SPEC.md` — they carry explicit
  *historical* banners, and those banners are the truthfulness mechanism. Verify
  the banner is present and honest; leave the body alone.
- `qwen/*.md` — vendored third-party docs describing the vendored library's own
  defaults. `max_seq_len=2048` is correct *for it*; this app passes 1024 at its
  call site. Not drift.

**Sources of truth to check documented claims against:**

- `backend/main.py` — constants, routes, `_estimate_seconds`, `_seq_budget` /
  `_ref_facts`, the history entry shape
- `frontend/src/constants.ts`, `frontend/src/api.ts`, `frontend/src/format.ts`
- `frontend/src/styles/tokens.css`, `frontend/src/index.css`, and
  `frontend/index.html`'s per-theme `background` hand-mirrors
- `frontend/src/components/` — `HistoryList.tsx`, `StudioShell.tsx`,
  `ThemeSwitch.tsx`, `InlineName.tsx`, `NewVoiceModal.tsx`
- `build.sh` — the authoritative gate list *and order*
- `scripts/` — `check_design_tokens.py`, `check_contrast.py`, `check_palette.py`,
  `check_orphan_css.py`, `check_desktop_port.py`, `build_splash.py --check`

**There is no test suite** — no pytest, no vitest, no test files. "All applicable
automated tests" means the six gates in `build.sh` plus `npm run lint` and
`npm run build` (which is also the typecheck). Never claim tests pass.

## Constraints

- Docs only, plus source **comments** the code has outgrown. Do not change
  runtime behaviour, palettes, constants or component logic to make a doc true —
  correct the doc.
- Do not touch `docs/history/*` content or `qwen/*.md`.
- Preserve each document's existing voice, structure and level of detail. No
  wholesale restructuring, no new top-level docs, no reordering sections that are
  already correct.
- `backend/storage/*` (`presets.json`, `history.json`, `queue.json`,
  `boot_status.json`) are gitignored runtime files — referencing them is correct,
  not a broken path. Same for the deliberately-absent references: `App.css`,
  `.venv/Scripts/activate.bat`, `frontend/src/components/LandingPage.tsx`,
  `planm.md`.
- "Mark the task complete in the repository documentation" means the docs
  describe the shipped behaviour accurately. There is no task tracker or status
  field to flip.
- If anything is left that only a human can judge — visual or aesthetic sign-off,
  behaviour needing a real GPU render — **do not push**. Report it.

## Execution

### 1. Mechanical sweeps, scripted rather than eyeballed

- every backtick'd repo path resolves (minus the known-absent list above);
- every documented constant matches code. At minimum: `MAX_TOTAL_CHARS` /
  `MAX_SCRIPT_CHARS`, `CHUNK_MAX_CHARS`, `MAX_SEQ_LEN`, `MAX_REF_AUDIO_SECS`,
  `REF_TRIM_SECS`, `ELISION_SAFE_CHUNK_CHARS`, `PADDING_SAFE_MIN_CHARS`,
  `MIN_CHUNK_CHARS`, `MIN_GEN_FRAMES`, `MAX_NEW_TOKENS`, `TIMING_WINDOW`,
  `_JOB_OVERHEAD_S`, `CHUNK_ATTEMPTS`, `DECODE_CHUNK_FRAMES`,
  `HISTORY_INITIAL_COUNT`, `HISTORY_LOAD_MORE_COUNT`, and `check_palette.py`'s
  `MIN_HUE_SEPARATION` / `TONAL_LIGHTNESS_DELTA` / `MIN_BASE_CARD` /
  `MIN_CARD_RAISED`;
- documented `/api/*` routes match the real `@app.*` decorators. `/api/wake` is a
  Vercel function and `/api/shutdown` is documented as removed — both correct in
  context, not misses;
- no markdown link is broken;
- per-theme layer-1 token counts in `CLAUDE.md` match `tokens.css`;
- the gate count and order in `README.md`, `docs/BUILD.md` and `CLAUDE.md` match
  `build.sh`.

> **Strip markdown emphasis and backticks before pattern-matching.** A previous
> sweep reported "0 contradictions" while a false claim sat in the file, because
> a backtick fell between the token and the words after it. A clean sweep is not
> evidence until the matcher tolerates inline formatting.

### 2. Cross-document contradiction pass

Where two maintained docs — or a doc and a source comment — state the same fact
differently, resolve against the code and fix whichever is wrong. Include source
comments whose text the code has outgrown.

### 3. Fix in place

Keep the reasoning where this repo already keeps reasoning: the *why*, not just
the corrected value.

### 4. Run everything runnable

The six `build.sh` gates individually, `npm run lint`, `npm run build`,
`npx tsc -b --force`, and a backend import check. Where a claim is measurable —
estimator accuracy against `backend/storage/history.json`, rendered theme colours,
row heights against the compiled CSS — **re-measure rather than restate**.

Beware two traps this repo has hit: piping a command into `grep` reports *grep's*
exit code, not the command's; and rebuilding `frontend/dist` while something is
loading the app from `:8000` serves 500s mid-request.

### 5. Push only if clean

Commit in coherent, separately-staged parts — code and comment fixes apart from
doc fixes — with bodies that say *why*. Then push to `main`.

## Output

Report concisely:

- A table of each doc defect and its fix: what was claimed vs what the code says.
- The verification actually run, with real output — gate-by-gate pass/fail, lint
  warning count, typecheck exit code, and any measurement re-run with its numbers.
- Anything a sweep initially missed, and how it was caught.
- Either the exact step-by-step manual QA still outstanding — each step with its
  expected result and why you could not perform it, **and no push** — or the
  pushed commit SHAs and a clean `git status`.
- Any side effect introduced during verification: processes left in a bad state,
  data written, files regenerated. State it plainly.
