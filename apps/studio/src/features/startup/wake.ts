import { getHealth } from '../../lib/api'

type WakeStatus = 'starting' | 'ready' | 'onboarding' | 'error'

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
    if (health.generation_ready === true) return { status: 'ready' }
    const response = await fetch('/api/models')
    if (response.ok) {
      const models = await response.json() as {
        selected: string | null
        error?: string | null
        busy?: boolean
        choices?: Record<string, { available?: boolean; reason?: string | null }>
      }
      if (models.error) return { status: 'onboarding', message: models.error }
      const available = Object.values(models.choices ?? {}).some((choice) => choice.available === true)
      if (!available && !models.busy) {
        const reason = Object.values(models.choices ?? {}).find((choice) => choice.reason)?.reason
        return { status: 'onboarding', message: reason ?? 'No model option is available with the measured hardware.' }
      }
      if (health.model_loaded && !health.generation_ready) {
        const reason = Object.values(models.choices ?? {}).find((choice) => choice.reason)?.reason
        return { status: 'onboarding', message: reason ?? 'The loaded model could not generate on this device. Choose another model or retry setup.' }
      }
      if (!models.selected) return models.busy
        ? { status: 'starting' }
        : { status: 'onboarding' }
    }
    return health.startup_error
      ? { status: 'error', message: health.startup_error }
      : { status: 'starting' }
  } catch {
      // A refused connection is normal while a cold backend process starts.
    return { status: 'starting' }
  }
}

/** Polls the local backend and resolves once
 * it reports ready, or rejects with a human-readable message on error/
 * timeout. Safe to call when the backend is already running -- resolves on
 * the first poll in that case. `onStatus` fires after every poll so the UI
 * can show live progress ("Warming up... 42s"). */
export function wakeBackend(
  onStatus?: (status: WakeStatus, elapsedMs: number, message?: string) => void,
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
      onStatus?.(result.status, elapsedMs, result.message)
      if (result.status === 'ready') {
        resolve()
      } else if (result.status === 'onboarding') {
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
