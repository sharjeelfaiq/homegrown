import { AnimatePresence, motion } from 'framer-motion'
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
 * So this stays a button at all times, and says the same thing at all times.
 * It reports on nothing: a script typed while a job runs still submits, and the
 * backend queues it FIFO. */
export default function GenerateButton({
  disabled,
  blockedReason,
  busy,
  warming,
  count,
  onClick,
}: Props) {
  const reduced = usePrefersReducedMotion()

  // Deliberately blind to the queue. This briefly read "Generating…" while a
  // job ran; reporting on work in flight is the Voiceovers column's job, and a
  // button that renames itself for a state it does not control reads as a
  // status light rather than as an action.
  const label = warming
    ? 'Starting the voice model…'
    : busy
      ? 'Submitting…'
      : blockedReason
        ? blockedReason
        : count > 1
          ? `Generate ${count} voiceovers`
          : 'Generate'

  // ml-auto and flex-none, because nothing else in the compose row is
  // flexible -- the voice field is fixed, so without this the controls bunch
  // up on the left and Generate stops being the row's right-hand anchor. This
  // was `.compose-bar .generate` in App.css; there is only ever one call site,
  // so the context is not actually a variable.
  return (
    <section className="ml-auto flex flex-none flex-col gap-2.5">
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
