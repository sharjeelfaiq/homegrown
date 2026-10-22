# Repository guidance

Read `CLAUDE.md` for application behavior and `docs/architecture.md` for module
ownership. Preserve local user data and existing changes. Tests and component
CSS belong beside their source. Use generators for mascot catalogs, loading
skeletons and the launcher splash.

## CodeGraph

If `.codegraph/` exists at the repository root, use `codegraph_explore` or
`codegraph explore` before text searches or file reads to locate or understand
code. If it does not exist, skip CodeGraph; do not create an index automatically.

## Validation

Run `npm test`, `npm run lint`, and `npm --prefix apps/studio run build`.
Backend tests use the project virtual environment through
`scripts/test-backend.mjs`. Build progress tests are
`node --test scripts/build/progress.test.mjs`. Consistency checks live under
`scripts/checks/`; validate generated splash output with
`python scripts/build/build_splash.py --check`.
