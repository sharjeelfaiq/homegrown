---
description: Reconcile active documentation with the local desktop codebase and run release checks
---

# Ship

Audit every current Markdown document against the local/desktop application,
including `README.md`, `CLAUDE.md`, contributor commands under
`.claude/commands/`, `docs/*.md`, and `engine/qwen/*.md`. `docs/history/` is
archival: preserve its historical body and keep a prominent non-current banner.

Current source roots are `apps/studio`, `apps/marketing`,
`services/voice-api`, `engine/qwen`, and `desktop/{launcher,installer,assets}`.
The supported workflows are `bash dev.sh` and `bash build.sh`; do not reintroduce
the retired setup script, source-server launcher, or hosted/cloud deployment
instructions.

Verify paths, Markdown links, and fenced commands. Run `bash -n dev.sh` and
`bash -n build.sh` separately, the Studio tests/lint/build, Python compilation,
and these gates:

```bash
python scripts/check_design_tokens.py
python scripts/check_contrast.py
python scripts/check_palette.py
python scripts/check_orphan_css.py
python scripts/check_desktop_port.py
python scripts/build_splash.py --check
```

Current UI details worth keeping accurate in the docs: the lower-left warning
button opens backend failure details and Retry; background history refresh
failures keep cached rows without an inline notice; running generation checks
cancellation between streamed audio pieces, not only at script-chunk boundaries.

Manual runtime QA of Vite proxy routes, the packaged executable, and the
standalone marketing page is required before releasing application behavior or
build changes. For documentation-only changes whose claims were checked
against source and automated checks, no browser/GPU QA is required; report that
fact and push when the user has requested it. Always report checks actually run
and any remaining manual QA.
