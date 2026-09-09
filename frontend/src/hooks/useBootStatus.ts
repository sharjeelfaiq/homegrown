import { useEffect, useRef, useState } from 'react'
import { usePageVisible } from './usePageVisible'

/** What the backend publishes while it starts up. Shapes match
 * `backend/boot_status.py`'s phase constants. */
export interface BootStatus {
  phase: 'starting' | 'downloading' | 'importing' | 'probing_gpu' | 'loading_model' | 'ready' | 'error'
  detail: string | null
  percent: number | null
}

/** Short label per phase, and the sentence under it.
 *
 * Copied deliberately from `launcher/launcher.py`'s LOADER_HTML (its WORDS and
 * TAGLINE maps) rather than reworded: the desktop build shows this exact
 * vocabulary on its own loader, and a user who sees both should not think they
 * are looking at two different products. If the wording changes there, change
 * it here too. */
const WORDS: Record<BootStatus['phase'], string> = {
  starting: 'Waking up',
  downloading: 'Setting up',
  importing: 'Warming up',
  probing_gpu: 'Tuning',
  loading_model: 'Almost there',
  ready: 'Ready',
  error: 'Could not start',
}

const TAGLINES: Record<BootStatus['phase'], string> = {
  starting: 'Homegrown is starting.',
  downloading: 'Setting up your voice. One time only — every launch after this is instant.',
  importing: 'Loading the engine. Nearly there.',
  probing_gpu: 'Matching the model to your graphics card.',
  loading_model: 'Your voice model is loading. This takes a minute or two.',
  ready: 'Opening Homegrown.',
  error: 'The backend stopped unexpectedly.',
}

export function bootWord(phase: BootStatus['phase']): string {
  return WORDS[phase] ?? WORDS.starting
}

export function bootTagline(phase: BootStatus['phase']): string {
  return TAGLINES[phase] ?? TAGLINES.starting
}

// Faster than wake.ts's 3s health poll: this one is a local file read through
// the dev server, not a request to a process that is busy loading a model.
const POLL_MS = 1000

const ROUTE = '/__boot-status'

/** The backend's startup phase, or null when there is nothing to report.
 *
 * Null covers every "we don't know" case and they are deliberately not
 * distinguished: no dev-server middleware (any build that is not `vite dev`),
 * no status file yet, a torn read, a backend pointed at a different storage
 * dir. In all of them the caller should fall back to whatever it showed
 * before -- never to an error. `import.meta.env.DEV` is NOT used to gate this:
 * see the comment in wake.ts about DEV also being false for the LAN build.
 * A request that 404s or returns HTML simply yields null. */
export function useBootStatus(active: boolean): BootStatus | null {
  const [status, setStatus] = useState<BootStatus | null>(null)
  const visible = usePageVisible()
  const cancelled = useRef(false)

  useEffect(() => {
    if (!active || !visible) return
    cancelled.current = false
    let timer: number | undefined

    const tick = async () => {
      try {
        const res = await fetch(ROUTE, { cache: 'no-store' })
        // The middleware always answers JSON. Anything else is the SPA
        // fallback or a 404, i.e. this is not a dev server.
        const type = res.headers.get('Content-Type') ?? ''
        if (!res.ok || !type.includes('application/json')) throw new Error('no status source')
        const body = (await res.json()) as Partial<BootStatus>
        if (cancelled.current) return
        setStatus(body && body.phase ? (body as BootStatus) : null)
      } catch {
        if (!cancelled.current) setStatus(null)
      } finally {
        if (!cancelled.current) timer = window.setTimeout(tick, POLL_MS)
      }
    }
    tick()

    return () => {
      cancelled.current = true
      window.clearTimeout(timer)
    }
  }, [active, visible])

  return active ? status : null
}
