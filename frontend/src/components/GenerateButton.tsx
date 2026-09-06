import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cancelQueuedJob, type QueueEntry } from '../api'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { formatDuration } from '../format'

interface Props {
  disabled: boolean
  /** Why the button is disabled, shown in place of "Generate". A greyed-out
   * control that says nothing leaves the user guessing what is missing. */
  blockedReason?: string | null
  busy: boolean
  /** True while waking the backend, before any job has been submitted. */
  warming?: boolean
  count: number
  onClick: () => void
}

/** Past this many chunks the boundary ticks fall below ~4px apart and read as
 * noise rather than structure, so they are dropped and the bar stands alone.
 * A voice with a long reference clip chunks at ~80 characters, which turns the
 * 60,000-character limit into ~750 chunks, so this end of the range is real. */
const MAX_TICKS = 60

/** The generate control, which becomes the progress display while work runs.
 *
 * It absorbed the old separate queue panel: the control you pressed is the
 * thing that reports back, rather than a card elsewhere on the page.
 *
 * Progress is a segmented bar: one continuous fill with hairline ticks at the
 * chunk boundaries. Renders run for minutes to hours and chunk counts range
 * from 3 to several hundred, so the display has to stay honest across two
 * orders of magnitude. It replaced a grid of one cell per chunk, which used
 * `auto-fill` and therefore laid out ~40 tracks regardless of chunk count --
 * a 3-chunk job rendered as three ticks stranded at the far left of an empty
 * strip. The bar has no such failure mode: it fills the width at any count,
 * and the ticks simply drop out once they are too dense to mean anything. */
export default function GenerateButton({
  disabled,
  blockedReason,
  busy,
  warming,
  count,
  onClick,
}: Props) {
  const { queue, refresh } = useGenerationActivity()

  const active: QueueEntry | undefined =
    queue.find((e) => e.status === 'running') ??
    queue.find((e) => e.status === 'queued' || e.status === 'canceling')

  const progress = useOptimisticProgress(active?.status === 'running' ? active : undefined)
  const reduced = usePrefersReducedMotion()
  const waiting = queue.filter((e) => e.status === 'queued').length

  async function cancel() {
    if (!active) return
    try {
      await cancelQueuedJob(active.job_id)
    } finally {
      refresh()
    }
  }

  if (active) {
    const running = active.status === 'running'
    const canceling = active.status === 'canceling'
    const total = active.total_chunks || 0
    const done = active.chunks_done || 0
    const showTicks = total > 1 && total <= MAX_TICKS

    const state = canceling ? 'Cancelling…' : running ? 'Generating' : 'Queued'
    // One line of state, one number. Everything else lives in the title so it
    // is available on hover without taking up room.
    const detail = [
      total > 0 ? `chunk ${Math.min(done + 1, total)} of ${total}` : null,
      active.elapsed_s != null ? `${formatDuration(active.elapsed_s)} elapsed` : null,
      active.text_preview,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <section className="render" aria-live="polite" title={detail}>
        <header className="render-head">
          <span className="render-state">
            {state}
            <span className="render-voice">
              {' · '}
              {active.preset_name}
              {waiting > 0 && ` (+${waiting} queued)`}
            </span>
          </span>
          {running && active.eta_s != null && (
            <span className="mono render-eta">{formatDuration(active.eta_s)} left</span>
          )}
        </header>

        {/* One bar for every chunk count. The boundary ticks are a repeating
            gradient driven by --chunks rather than one element per chunk, so
            three chunks and seven hundred cost the same and neither leaves the
            dead space the old auto-fill cell grid did. */}
        <div
          className={`render-bar${showTicks ? ' has-ticks' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={total ? done : Math.round(progress)}
          aria-label={
            total ? `Rendering chunk ${Math.min(done + 1, total)} of ${total}` : 'Rendering'
          }
          style={{ '--chunks': total || 1 } as CSSProperties}
        >
          <motion.div
            className="render-bar-fill"
            initial={false}
            animate={{ width: `${running ? progress : 0}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.2, 0, 0, 1] }}
          >
            {running && !reduced && <span className="render-bar-sheen" aria-hidden="true" />}
          </motion.div>
        </div>

        <div className="render-foot">
          <button
            type="button"
            className="ghost-btn ghost-btn-danger"
            onClick={cancel}
            disabled={canceling}
          >
            Cancel
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="generate">
      <button type="button" className="generate-btn" disabled={disabled} onClick={onClick}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={warming ? 'warm' : busy ? 'busy' : blockedReason ? 'blocked' : 'idle'}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.14 }}
          >
            {warming
              ? 'Starting the voice model…'
              : busy
                ? 'Submitting…'
                : blockedReason
                  ? blockedReason
                  : count > 1
                    ? `Generate ${count} voiceovers`
                    : 'Generate'}
          </motion.span>
        </AnimatePresence>
      </button>
      <kbd className="mono generate-hint">Ctrl ↵</kbd>
    </section>
  )
}
