import { AnimatePresence, motion } from 'framer-motion'
import { useGenerationActivity } from '../GenerationActivityContext'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

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

/** The generate control.
 *
 * It used to replace itself with a whole progress panel -- bar, chunk count,
 * elapsed, Cancel -- while a job ran. That moved now: the in-flight voiceover
 * appears as the first row of the Voiceovers column, where the finished result
 * will land, so progress is reported in the place the user is already watching
 * instead of in the composer. Keeping both would have said the same thing
 * twice in one viewport.
 *
 * So this stays a button at all times. The only thing the queue changes here is
 * the label: with work in flight and nothing new to submit, it reads
 * "Generating…" rather than an unexplained grey "Generate". A script typed
 * while a job runs still submits -- the backend queues it FIFO. */
export default function GenerateButton({
  disabled,
  blockedReason,
  busy,
  warming,
  count,
  onClick,
}: Props) {
  const { queue } = useGenerationActivity()
  const reduced = usePrefersReducedMotion()

  const generating = queue.some(
    (e) => e.status === 'running' || e.status === 'queued' || e.status === 'canceling',
  )
  // Only when there is nothing to submit. With a ready script the button is
  // live and says so, because queueing a second job is legal.
  const idleDuringWork = generating && disabled && !busy && !warming && !blockedReason

  const label = warming
    ? 'Starting the voice model…'
    : busy
      ? 'Submitting…'
      : blockedReason
        ? blockedReason
        : idleDuringWork
          ? 'Generating…'
          : count > 1
            ? `Generate ${count} voiceovers`
            : 'Generate'

  return (
    <section className="generate">
      <button type="button" className="generate-btn" disabled={disabled} onClick={onClick}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={label}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.14 }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </button>
    </section>
  )
}
