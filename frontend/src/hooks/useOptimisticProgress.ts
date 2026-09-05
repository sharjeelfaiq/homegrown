import { useEffect, useRef, useState } from 'react'
import type { QueueEntry } from '../api'

/** Smoothly advancing progress percentage for the job being generated.
 *
 * The backend only reports whole chunks, so `chunks_done / total_chunks` sits
 * still for a minute and then jumps -- on a 7-chunk job, 14% at a time. This
 * fills the gap by predicting how far into the current chunk we are from
 * elapsed time, which is what the user actually perceives as progress.
 *
 * Three rules keep the optimism honest:
 *   - it never moves backwards, even when a prediction overshoots and the next
 *     poll reports less,
 *   - it never crosses the next chunk boundary, so a slow chunk stalls just
 *     short of it instead of claiming work that has not happened,
 *   - it never reaches 100%; only the job leaving the queue does that.
 */
const TICK_MS = 200
// Stop just shy of the boundary: a bar that parks at exactly the next chunk's
// value looks like the count already advanced.
const MAX_WITHIN_CHUNK = 0.93
// Used when the backend has no estimate yet, so the bar still creeps.
const FALLBACK_CHUNK_MS = 30_000

interface Anchor {
  jobId: string
  chunksDone: number
  /** When chunks_done last changed, i.e. when the current chunk started. */
  startedAt: number
  shown: number
}

export function useOptimisticProgress(job: QueueEntry | undefined): number {
  const [percent, setPercent] = useState(0)
  const jobRef = useRef<QueueEntry | undefined>(job)
  jobRef.current = job
  const anchor = useRef<Anchor>({ jobId: '', chunksDone: -1, startedAt: 0, shown: 0 })

  const jobId = job?.job_id
  useEffect(() => {
    if (!jobId) {
      anchor.current = { jobId: '', chunksDone: -1, startedAt: 0, shown: 0 }
      setPercent(0)
      return
    }

    const tick = () => {
      const current = jobRef.current
      if (!current || current.total_chunks <= 0) return
      const state = anchor.current

      if (state.jobId !== current.job_id) {
        // A different job took the GPU -- start its bar from zero.
        state.jobId = current.job_id
        state.chunksDone = -1
        state.shown = 0
      }
      if (current.chunks_done !== state.chunksDone) {
        state.chunksDone = current.chunks_done
        state.startedAt = Date.now()
      }

      const committed = current.chunks_done / current.total_chunks
      // Canceling stops after the current chunk, so predicting further would
      // promise work that will never be done.
      if (current.status === 'canceling') {
        state.shown = Math.max(state.shown, committed)
        setPercent(Math.round(state.shown * 100))
        return
      }

      const perChunkMs = current.estimated_s
        ? (current.estimated_s * 1000) / current.total_chunks
        : FALLBACK_CHUNK_MS
      const within = Math.min(MAX_WITHIN_CHUNK, (Date.now() - state.startedAt) / perChunkMs)
      const predicted = (current.chunks_done + within) / current.total_chunks
      const ceiling = (current.chunks_done + MAX_WITHIN_CHUNK) / current.total_chunks

      const next = Math.max(state.shown, committed, Math.min(predicted, ceiling))
      state.shown = Math.min(next, 0.99)
      setPercent(Math.round(state.shown * 100))
    }

    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [jobId])

  return percent
}
