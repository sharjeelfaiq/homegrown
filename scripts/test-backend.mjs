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

for (const directory of ['services/voice-api/tests', 'engine', 'scripts/benchmarks']) {
  const result = spawnSync(
    python,
    ['-m', 'unittest', 'discover', '-s', directory, '-p', 'test_*.py'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONPATH: [path.join(root, 'services', 'voice-api'), path.join(root, 'engine'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
