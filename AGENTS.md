# Repository Guidelines

## Project structure and module organization

`apps/studio/` contains the React and Vite interface; keep feature code, tests, and CSS together under `src/`. `services/voice-api/homegrown_api/` contains FastAPI routes, generation, audio, and persistence; backend tests live in `services/voice-api/tests/`. `engine/qwen/` is the vendored inference wrapper. `desktop/` contains the Windows launcher and build assets. `apps/marketing/` is a separate static site. See `docs/architecture.md` for module ownership and `CLAUDE.md` for application behavior.

## Build, test, and development commands

- `npm run dev` starts Vite on port 5173 and FastAPI on port 8000.
- `npm test` runs Studio tests, then backend tests through the project virtual environment.
- `npm run lint` runs the Studio's Oxlint checks.
- `npm --prefix apps/studio run build` checks TypeScript and builds the Studio.
- `npm run build` packages Windows; see `docs/build.md` first.

## Coding style and naming conventions

Follow nearby code: two-space indentation in TypeScript and TSX, four spaces in Python. Use PascalCase for React components, `use` prefixes for hooks, and snake_case for Python modules and functions. Keep tests and component CSS next to their source. Do not hand-edit generated mascot catalogs, loading skeletons, brand assets, or splash output; use their generators. Oxlint is the configured frontend linter.

## Testing guidelines

Name Studio tests `*.test.ts` or `*.test.tsx` beside the implementation. Name backend tests `test_*.py` under `services/voice-api/tests/`. Add focused tests for behavior changes, then run `npm test`, `npm run lint`, and the Studio build. For build-progress changes, also run `node --test scripts/build/progress.test.mjs`.

## Commits and pull requests

Recent commits use short imperative subjects such as `Add empty-state guidance`. Keep commits focused. In pull requests, describe changes, list checks, and link relevant issues. Include screenshots for visible Studio or marketing changes. No pull request template is present.

## Configuration and data safety

Start from `services/voice-api/.env.example` and point `MODEL_PATH` at the 1.7B Base checkpoint directory. Never commit `.env` files, model snapshots, generated audio, or local storage data. Preserve existing user data when changing persistence or build paths.

## Agent instructions

When `.codegraph/` exists, use CodeGraph before text search or file reads to locate and understand code. Do not create an index automatically. For software and writing work, follow the applicable rules in `D:\downloads\AI coding and product quality checklist.md`; keep that file as the single source of truth.
