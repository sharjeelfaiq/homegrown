import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { MOD_ARIA, MOD_KEY } from '../../lib/keyboard'
import SpecularButton from '../../components/effects/SpecularButton'
import { AppTooltip } from '../../components/ui/Tooltip'

interface Props {
  disabled: boolean
  /** Why the button is disabled. Shown from the adjacent warning icon so the
   * control keeps its stable action label. */
  blockedReason?: string | null
  busy: boolean
  /** True while waking the backend, before any job has been submitted. */
  warming?: boolean
  /** Replaces the shortcut hint while model startup blocks the action. */
  tooltip?: string
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
  tooltip,
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
      : 'Generate'

  // The action is a compact editor-footer control. Auxiliary feedback stays
  // beside it, so the action remains right-aligned while its label is stable.
  return (
    <section className="generate-action">
      <div className="generate-action-auxiliary" aria-live="polite">
        {blockedReason && <span className={`text-[12px] ${blockedReason === 'Select a language' ? 'text-faint' : 'text-muted'}`} role="status">{blockedReason}</span>}
      </div>
      {/* Tooltip, not a visible key cap -- unlike the script box and the play
          control, which wear theirs. The button stays a stable action label;
          any missing prerequisite is carried by the adjacent warning icon.

          aria-keyshortcuts is NOT the tooltip text: it takes a fixed
          vocabulary ("Control+Enter"), which is why MOD_ARIA is separate from
          the display glyph in MOD_KEY. Assistive tech announces the shortcut
          from that attribute, so nothing is lost by the cap being absent. */}
      <AppTooltip content={tooltip ?? `Generate (${MOD_KEY}+Enter)`}>
        <SpecularButton
          type="button"
          className="generate-btn"
          disabled={disabled}
          onClick={onClick}
          aria-keyshortcuts={`${MOD_ARIA}+Enter`}
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
      </AppTooltip>
    </section>
  )
}
