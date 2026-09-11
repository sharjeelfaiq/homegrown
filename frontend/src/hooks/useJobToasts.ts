import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { QueueEntry } from '../api'

/** Toast once when a voiceover finishes or fails.
 *
 * Why this exists at all: generation runs at roughly four minutes of work per
 * minute of speech, so people start a job and go and do something else. Until
 * now the only report of a finished voiceover was a row changing somewhere in
 * a column they were not looking at, and the only live region anywhere near
 * the work was on the ELAPSED CLOCK -- which re-announced every second while a
 * job ran and said nothing at all when it ended. Screen-reader users got a
 * ticking noise and then silence.
 *
 * Sonner's <Toaster /> renders its own aria-live region, so this covers the
 * announcement and the visual notification with one mechanism rather than two
 * that have to be kept in step.
 *
 * FIRING EXACTLY ONCE IS THE WHOLE DIFFICULTY. The queue is polled (1s while
 * active, 4s idle -- GenerationActivityContext), so a job sits in the response
 * as `done` across several consecutive polls before it drops out. Keying off
 * "is there a done job" would toast on every one of them. The ref holds the
 * ids already reported, and a job is reported the first time it is SEEN in a
 * terminal state.
 *
 * Two consequences of that design worth knowing:
 *
 *  - The set is seeded on the first poll rather than starting empty. A reload
 *    while jobs happen to be terminal in the queue would otherwise fire a
 *    burst of toasts for work the user finished before the refresh, which
 *    reads as the app malfunctioning. Nothing that ended before this hook
 *    mounted is news.
 *  - Ids are never removed. A job id is a uuid that the backend never reuses,
 *    and a retry mints a NEW one (see the `attempt` field), so the set cannot
 *    grow beyond the jobs of one session and a retried failure is correctly
 *    treated as a separate event.
 */
export function useJobToasts(queue: QueueEntry[]): void {
  const reported = useRef<Set<string> | null>(null)

  useEffect(() => {
    const terminal = queue.filter((e) => e.status === 'done' || e.status === 'error')

    // First run seeds rather than reports. `null` and not `size === 0`: an
    // empty queue on mount is a perfectly normal first poll, and treating it
    // as "not seeded yet" would leave the guard disarmed until the first job
    // appeared -- at which point it would fire for a job that was already
    // running before the page loaded.
    if (reported.current === null) {
      reported.current = new Set(terminal.map((e) => e.job_id))
      return
    }

    const seen = reported.current
    for (const job of terminal) {
      if (seen.has(job.job_id)) continue
      seen.add(job.job_id)

      if (job.status === 'done') {
        toast.success('Voiceover ready', {
          // The voice, not the script: the script preview is truncated to 80
          // characters server-side and a toast is not where anyone reads it.
          description: job.preset_name,
        })
      } else {
        // Errors do NOT auto-dismiss. A failure the user blinked past is a
        // failure they will report as the app doing nothing, and the row it
        // leaves behind carries the Retry -- so the toast has to survive long
        // enough to point at it.
        toast.error('Voiceover failed', {
          description: job.error || job.preset_name,
          duration: Infinity,
        })
      }
    }
  }, [queue])
}
