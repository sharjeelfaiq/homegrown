import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { MOD_ARIA, MOD_KEY } from '../keys'
import Kbd from './Kbd'
import SpecularButton from './SpecularButton'

interface Props {
  disabled: boolean
  /** Why the button is disabled. Shown from the adjacent warning icon so the
   * control keeps its stable action label. */
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
  // The plural branch is UNREACHABLE today and is kept rather than deleted:
  // StudioShell passes `count` as `scriptReady ? 1 : 0`, because one submission
  // is one script. It costs one line and it is the only thing that would need
  // writing if batching ever lands. Do not document it as a label users see.
  const label = warming
    ? 'Starting the voice model…'
    : busy
      ? 'Submitting…'
      : count > 1
        ? `Generate ${count} voiceovers`
        : 'Generate'

  // flex-none, but no longer ml-auto: the voice controls anchor the right of
  // the compose row now, and Generate sits at the left. The slack between
  // them is taken by the wrapper around the voice field in StudioShell.
  return (
    <section className="flex flex-none flex-wrap items-center gap-x-2 gap-y-1">
      {/* Tooltip, not a visible key cap -- unlike the script box and the play
          control, which wear theirs. The button stays a stable action label;
          any missing prerequisite is carried by the adjacent warning icon.

          aria-keyshortcuts is NOT the tooltip text: it takes a fixed
          vocabulary ("Control+Enter"), which is why MOD_ARIA is separate from
          the display glyph in MOD_KEY. Assistive tech announces the shortcut
          from that attribute, so nothing is lost by the cap being absent. */}
      <SpecularButton
        type="button"
        className="generate-btn"
        disabled={disabled}
        onClick={onClick}
        aria-keyshortcuts={`${MOD_ARIA}+Enter`}
        title={`Generate (${MOD_KEY}+Enter)`}
        reducedMotion={reduced}
      >
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
      </SpecularButton>
      {blockedReason && <span className="text-[12px] text-muted" role="status">{blockedReason}</span>}
      <span className="flex items-center gap-1 text-[11px] text-faint coarse:hidden" aria-hidden="true">
        <Kbd>{`${MOD_KEY}+Enter`}</Kbd><span>to generate</span>
      </span>
    </section>
  )
}
