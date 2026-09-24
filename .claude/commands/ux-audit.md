---
description: Audit the local marketing page and Studio for measurable UX/UI gaps
---

# UX audit

Audit the two local web surfaces:

- `apps/marketing/index.html` is a standalone static marketing page. It may be
  opened directly in a browser and manually shared as a directory; it has no
  required build or platform configuration.
- `apps/studio/` is the React + Vite Studio. It uses relative API paths and
  Vite proxies `/api`, `/audio`, and `/refs` to `services/voice-api` in local
  development.

Read `CLAUDE.md` and `docs/workflow.md` before proposing changes. Preserve the
local-only, no-account product model and the existing visual language. Do not
add hosted deployment, analytics, sign-up, pricing, or cloud-service flows.

Measure before changing UI. For changes to Studio, run its tests, lint, and
production build plus the repository design gates. For changes to the marketing
page, open `apps/marketing/index.html` directly and run
`scripts/measure_landing.sh`.

Report measurable findings, changes made, verification performed, and anything
requiring human visual or GPU-backed QA.
