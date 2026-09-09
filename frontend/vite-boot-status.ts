import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Serves the backend's startup progress to the dev server, off disk.
 *
 * The backend cannot report its own startup over HTTP, and that is physics
 * rather than an oversight: uvicorn binds the socket only after `lifespan()`
 * reaches its `yield`, and `lifespan()` is where the CUDA probe and the model
 * load happen. For that entire window -- tens of seconds warm, minutes on a
 * first run -- the backend port is connection-refused, so there is no endpoint
 * to ask. `src/wake.ts` documents the same thing from the client side.
 *
 * `backend/main.py`'s `lifespan()` publishes its phases to
 * `backend/storage/boot_status.json` regardless of whether it is frozen, so in
 * dev the information already exists; nothing served it. The desktop build has
 * `launcher.py`, which reads that same file and serves it at `/status` behind
 * its loader page. This is the dev equivalent: same file, same shape, served
 * same-origin with the Vite dev server so there is no CORS and no second port
 * to bind.
 *
 * Dev only, by construction -- `apply: 'serve'` means it does not exist in any
 * build output. The client must therefore treat a failed request as "no
 * information", never as an error.
 */
const ROOT = dirname(fileURLToPath(import.meta.url))

export const BOOT_STATUS_ROUTE = '/__boot-status'

function storageDir(): string {
  // Mirror backend/main.py's dev branch: STORAGE_DIR = backend/storage, with
  // HOMEGROWN_STORAGE_DIR (and the pre-rebrand VOICECLONE_STORAGE_DIR) able to
  // move it. Reading the override matters because a backend pointed elsewhere
  // writes its status elsewhere, and we would poll a file nobody updates.
  const override = process.env.HOMEGROWN_STORAGE_DIR || process.env.VOICECLONE_STORAGE_DIR
  if (override) return isAbsolute(override) ? override : resolve(ROOT, '..', override)
  return resolve(ROOT, '..', 'backend', 'storage')
}

export function bootStatusPlugin(): Plugin {
  return {
    name: 'homegrown-boot-status',
    apply: 'serve',
    configureServer(server) {
      const path = resolve(storageDir(), 'boot_status.json')
      server.middlewares.use(BOOT_STATUS_ROUTE, (_req, res) => {
        // Absent, mid-write or unparseable all mean the same thing to the
        // client: nothing to report yet. `boot_status.write()` is
        // temp-file-plus-replace so a torn read is unlikely, but a backend
        // that has not started at all is the common case and is not an error.
        let body = '{}'
        try {
          const raw = readFileSync(path, 'utf-8')
          const parsed: unknown = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') body = JSON.stringify(parsed)
        } catch {
          // keep '{}'
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(body)
      })
    },
  }
}
