---
description: Audit the landing page and the Studio app for UX/UI gaps, measure rather than eyeball, implement the unambiguous wins and leave the rest as recommendations
---

# UX audit

Audit this repository's two web surfaces for UX/UI gaps and deliver prioritised,
practical improvements — conversion-focused for the marketing page,
task-efficiency-focused for the Studio app — respecting the existing design
language and the constraints each surface already documents.

Optional scope for this run (may be empty; `landing` or `app` narrows it, and
anything else is a focus note): $ARGUMENTS

## Context

There are **two** distinct web surfaces. They have different jobs, different
constraints, and only one of them has a conversion funnel at all.

### 1. `landing-page/index.html` — the marketing page. The only conversion surface.

- A single static file deployed to Vercel with `buildCommand: null`
  (`vercel.json`). No build step, no bundler, no imports.
- Compiles Tailwind **in the browser** via the Play CDN, pinned to
  `@tailwindcss/browser@4.3.3/dist/index.global.js` with an SRI hash.
- Current funnel: one CTA — `Download for Windows`, an `<a>` to a Google Drive
  URL (`target="_blank" rel="noopener"`) — with the commitment figures beside it
  (1.66 GB download, 2.5 GB model on first run, 8 GB free, no admin rights).
  Supporting line: "No account. No subscription. No cloud."
- Secondary surface: a `<dialog id="more" class="sheet">` opened with
  `showModal()`, containing five `<section>`s — Requirements, Setting it up,
  For the best voice, Questions, Specifications.
- **There is no analytics of any kind** — no gtag, Plausible, PostHog, Vercel
  Analytics or Speed Insights. Conversion is currently unmeasurable.
- SEO already handled: canonical `https://homegrown-x.vercel.app`, absolute
  `og:`/`twitter:` URLs, committed `og.png` (1200×630, from
  `scripts/build_og_image.sh`), `robots.txt`, `sitemap.xml`, and
  `SoftwareApplication` JSON-LD.

### 2. `frontend/` — the Studio SPA (React 19 + Vite + TS). No funnel exists here.

- `frontend/index.html` is deliberately `noindex, nofollow`; the app has no
  accounts, no billing, no sign-up. `auth.py`'s `get_current_user` returns the
  constant `"local-user"`.
- Two routes (`App.tsx`), both rendering `StudioShell.tsx`. Key components:
  `StudioShell.tsx` (composer, voice picker, Generate), `HistoryList.tsx`
  (Voiceovers column, search, rows), `NewVoiceModal.tsx` (Voices dialog),
  `ThemeSwitch.tsx`, `ScriptBlock.tsx`, `VoicePicker.tsx`, `GenerateButton.tsx`.
- Styling is Tailwind v4 utilities plus `frontend/src/styles/tokens.css` (nine
  themes, three layers) and `frontend/src/index.css` (`@theme inline` bridge,
  `@utility` primitives).

### Conventions both surfaces must respect — read before proposing anything

- `CLAUDE.md` — the Styling section, the Voiceovers-column rules, and the
  landing-page rules (SRI pin, `<dialog>` rationale, SEO/`noindex` split,
  strict palette).
- `CLAUDE.md`'s **Terminology** table is fixed product vocabulary: *voiceover*,
  *script*, *voice*, *reference clip*, *chunk*, *generate*. "Clip" is correct
  only for the input recording, never the output.
- `docs/workflow.md` — how the app is actually used end to end.

## Constraints

- **Assumption, stated because it changes the work:** "conversion" applies to
  `landing-page/index.html` only — the single measurable action is starting the
  download. The Studio app has no funnel, so for it this means **task
  efficiency**: fewer steps and less hesitation from opening the app to a
  finished voiceover. Do not invent sign-up, pricing, upsell, onboarding-wizard
  or email-capture flows for either surface; the product's whole premise is no
  account, no subscription, no cloud.
- **The landing page must still fit one viewport with no page scroll**, and the
  sheet must not scroll either. `scripts/measure_landing.sh` asserts exactly this
  and drives `#more`, `.sheet` and `.sheet-body` by name — those are hooks, not
  incidental classes. Its probe waits 1200ms because the page compiles Tailwind
  in the browser; measuring earlier measures an unstyled page.
- **Do not replace the `<dialog>`.** It has already been a checkbox + `<label
  for>` (focusable but not activatable by keyboard) and a `<details>` (in-flow,
  so opening it scrolled the page). `showModal()` is what provides the focus
  trap, Escape, background inertness and `::backdrop`.
- **Do not un-pin or re-path the CDN script.** The exact `/dist/index.global.js`
  path is required for a stable SRI hash; jsDelivr minifies the bare `@4` path
  on the fly and says so in the file's own banner.
- **Do not mark up the sheet's Q&A as `FAQPage`.** It is inside a `<dialog>`;
  Google forbids structured data on hidden content, and that earns a manual
  action rather than a rich result.
- **Do not remove `noindex` from `frontend/index.html`.** The app has no
  sign-in; anyone reaching it has full access to create and delete voices.
- **Palette discipline:** the landing page is a STRICT target for
  `scripts/check_design_tokens.py` — it renders as the default Studio theme only
  and hand-mirrors those values, so any colour must already exist in an unnamed
  `:root` block of `tokens.css`. The SPA must also satisfy `check_contrast.py`
  (WCAG AA per theme) and `check_palette.py` (hue and surface separation).
- **No new runtime dependencies** on either surface. No CSS or component
  framework beyond what is already present.
- Preserve the existing visual language — type scale, mono labels with wide
  tracking, hairline rules, restrained saturation. Refinement pass, not redesign.
- If proposing analytics, treat it as an explicit **recommendation with its
  privacy trade-off stated**, never a silent addition — the page's entire pitch
  is that nothing leaves the user's machine.
- Out of scope: `docs/history/*`, `qwen/*` (vendored), backend behaviour, and the
  generation pipeline.

## Execution

1. **Audit before proposing.** Read `landing-page/index.html` in full, then
   `StudioShell.tsx` and `HistoryList.tsx`, then the `CLAUDE.md` sections above.
   Render both surfaces and look at them — do not audit from source alone.
2. **Measure, do not eyeball.** Headless Chrome: `scripts/measure_landing.sh` for
   the landing page, `--dump-dom` with a computed-style probe for the app.
   Capture real numbers — viewport overflow, tap-target sizes, contrast ratios,
   row heights, first-paint state — at 360px, 768px, 1024px and 1680px. Report
   actual values.
3. **Separate findings from opinions.** For each gap state: what a user cannot do
   or misreads, the evidence (a measurement, a documented rule it violates, or a
   specific interaction), and the severity. A defect is not a preference.
4. **Rank by impact ÷ effort**, tagging each item *landing-page conversion*,
   *app task efficiency*, *accessibility*, or *visual consistency*.
5. **Implement only the unambiguous wins** — small, self-contained, consistent
   with the documented rules. Anything that changes the product's character, its
   information architecture, or the one-viewport specification stays a written
   recommendation for the user to approve.
6. **Verify every change.** Re-run `scripts/measure_landing.sh` if the landing
   page changed; run the six `build.sh` gates (`check_design_tokens.py`,
   `check_contrast.py`, `check_palette.py`, `check_orphan_css.py`,
   `check_desktop_port.py`, `build_splash.py --check`) plus `npm run lint` and
   `npm run build` if the SPA changed. `npm run build` is also the typecheck, and
   there is **no test suite** in this repo — never claim tests pass.
   Two traps: piping a command into `grep` reports *grep's* exit code, not the
   command's; and rebuilding `frontend/dist` while something is loading the app
   from `:8000` serves 500s mid-request.
7. If the landing page's visual design changed, regenerate `landing-page/og.png`
   with `scripts/build_og_image.sh` and commit it — Vercel serves that directory
   with no build step, so an uncommitted generated file 404s. The script guards
   against screenshotting an unstyled page by failing under 8 KB.

## Output

- **A ranked findings table**: gap · evidence (the measured number or the rule it
  breaks) · category · severity · impact/effort.
- **What changed**, file by file, with reasoning — and explicitly what you
  deliberately did *not* change, and why.
- **Verification actually run**, with real output: gate-by-gate pass/fail, lint
  warning count, build result, and before/after measurements for anything
  touched.
- **Recommendations left for approval**, each with its trade-off spelled out —
  especially anything touching the one-viewport rule, the download funnel, or
  analytics.
- Screenshots of both surfaces at the widths tested, saved to disk with paths
  listed.
