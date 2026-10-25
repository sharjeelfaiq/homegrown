import { useEffect, useRef, useState } from 'react'
import { usePageVisible } from '../../hooks/usePageVisible'

/** Sanitized backend startup/download progress from `/api/models`. */
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
  loading_model: 'Your voice model is loading. This can take up to 3 minutes.',
  ready: 'Opening Homegrown.',
  error: 'The backend stopped unexpectedly.',
}

export function bootWord(phase: BootStatus['phase']): string {
  return WORDS[phase] ?? WORDS.starting
}

export function bootTagline(phase: BootStatus['phase']): string {
  return TAGLINES[phase] ?? TAGLINES.starting
}

// Poll frequently enough to keep the progress line current during model setup.
const POLL_MS = 1000

const ROUTE = '/api/models'

/** The backend's startup phase, or null when there is nothing to report.
 *
 * The model API is available during onboarding and in both dev and packaged
 * builds, so startup progress has the same source and shape in both flows.
 * Unknown/unavailable responses remain null; callers should never infer an
 * error from a missing progress response. */
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
        const type = res.headers.get('Content-Type') ?? ''
        if (!res.ok || !type.includes('application/json')) throw new Error('no status source')
        const body = (await res.json()) as Partial<BootStatus>
        if (cancelled.current) return
        const phases: BootStatus['phase'][] = ['starting', 'downloading', 'importing', 'probing_gpu', 'loading_model', 'ready', 'error']
        setStatus(body.phase && phases.includes(body.phase) ? body as BootStatus : null)
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
