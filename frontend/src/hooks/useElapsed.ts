import { useEffect, useRef, useState } from 'react'
import type { QueueEntry } from '../api'

/** Seconds a job has been generating, ticking between queue polls.
 *
 * `elapsed_s` only refreshes when the shared poller comes back (1s while work
 * is active, and not at all in a background tab), so rendering it directly
 * gives a clock that stutters and then jumps. This anchors on the last value
 * the backend reported and advances locally from there, which keeps the
 * readout honest -- every poll re-anchors it, so it can never drift away from
 * what the backend thinks.
 *
 * Deliberately elapsed and not an estimate: `eta_s` comes from a rolling
 * chars/second average and moves in both directions as chunks land, which is
 * exactly what made it useless to watch.
 *
 * Null until the job actually starts -- a queued job has no elapsed time yet,
 * and showing 0:00 for it would read as "running, but stuck".
 */
const TICK_MS = 250

interface Anchor {
  jobId: string
  /** The last `elapsed_s` the backend reported. */
  reported: number
  /** When that value arrived, so the local advance starts from the right place. */
  at: number
}

export function useElapsed(job: QueueEntry | undefined): number | null {
  const [seconds, setSeconds] = useState<number | null>(null)
  const jobRef = useRef<QueueEntry | undefined>(job)
  jobRef.current = job
  const anchor = useRef<Anchor>({ jobId: '', reported: -1, at: 0 })

  const jobId = job?.job_id
  useEffect(() => {
    if (!jobId) {
      anchor.current = { jobId: '', reported: -1, at: 0 }
      setSeconds(null)
      return
    }

    const tick = () => {
      const current = jobRef.current
      if (!current || current.elapsed_s == null) {
        setSeconds(null)
        return
      }
      const state = anchor.current
      if (state.jobId !== current.job_id || current.elapsed_s !== state.reported) {
        state.jobId = current.job_id
        state.reported = current.elapsed_s
        state.at = Date.now()
      }
      const next = state.reported + (Date.now() - state.at) / 1000
      // Ticks at 250ms for accuracy but only commits when the displayed second
      // changes: the readout lives inside a row that also holds the rename
      // input, and re-rendering that four times a second to move nothing is
      // the same mistake TransportTime exists to avoid.
      setSeconds((shown) =>
        shown != null && Math.floor(shown) === Math.floor(next) ? shown : next,
      )
    }

    tick()
    const id = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(id)
  }, [jobId])

  return seconds
}
