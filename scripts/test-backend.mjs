// Keep `npm test` on the same project interpreter used by `npm run dev`.
// System Python often lacks torch and the backend's native audio dependencies.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [
  path.join(root, '.venv', 'Scripts', 'python.exe'),
  path.join(root, '.venv', 'bin', 'python'),
]
const python = candidates.find((candidate) => fs.existsSync(candidate))

if (!python) {
  process.stderr.write('Backend tests require .venv. Create it using README.md: First-time setup.\n')
  process.exit(1)
}

const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', 'services/voice-api/tests', '-p', 'test_*.py'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONPATH: [path.join(root, 'services', 'voice-api'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } },
)
process.exit(result.status ?? 1)
