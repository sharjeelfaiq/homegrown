import { getHealth } from './api'

export type WakeStatus = 'starting' | 'ready' | 'error'

interface WakeResponse {
  status: WakeStatus
  message?: string
}

const POLL_INTERVAL_MS = 3000
// A local cold start legitimately takes a
// while: torch faults ~3.8GB of DLLs off disk, then the model loads. Nothing
// is gained by giving up early, so wait generously.
const LOCAL_TIMEOUT_MS = 10 * 60_000

const CLIENT_TIMEOUT_MS = LOCAL_TIMEOUT_MS

async function callWake(): Promise<WakeResponse> {
  try {
    const health = await getHealth()
    return { status: health.model_loaded ? 'ready' : 'starting' }
  } catch {
      // A refused connection is the *normal* state while the backend starts,
      // not a failure: uvicorn binds the port only after lifespan() finishes
      // loading the model, so there is no "up but not ready" window to
      // observe -- model_loaded:false is unreachable on the happy path and
      // the browser goes straight from ECONNREFUSED to ready. Reporting
      // 'error' here made the poll loop below give up on its first attempt,
      // so anyone opening the app URL directly (bookmark, Back button) got
      // "Could not reach the local backend" instantly instead of a loader.
    return { status: 'starting' }
  }
}

/** Polls the local backend and resolves once
 * it reports ready, or rejects with a human-readable message on error/
 * timeout. Safe to call when the backend is already running -- resolves on
 * the first poll in that case. `onStatus` fires after every poll so the UI
 * can show live progress ("Warming up... 42s"). */
export function wakeBackend(
  onStatus?: (status: WakeStatus, elapsedMs: number) => void,
): Promise<void> {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > CLIENT_TIMEOUT_MS) {
        onStatus?.('error', elapsedMs)
        reject(new Error('Timed out waiting for the backend to start. Is Homegrown running?'))
        return
      }
      let result: WakeResponse
      try {
        result = await callWake()
      } catch {
        // Transient network hiccup calling our own same-origin endpoint --
        // keep polling rather than failing the whole flow on one blip.
        result = { status: 'starting' }
      }
      onStatus?.(result.status, elapsedMs)
      if (result.status === 'ready') {
        resolve()
      } else if (result.status === 'error') {
        reject(new Error(result.message || 'Failed to start the backend.'))
      } else {
        setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
    poll()
  })
}
