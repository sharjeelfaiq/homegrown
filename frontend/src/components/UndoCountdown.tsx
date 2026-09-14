import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

/** The time left to undo, as a depleting ring with the seconds inside it.
 *
 * Split deliberately between CSS and JS, because the two halves have very
 * different costs:
 *
 *  - The SWEEP is a CSS animation on `stroke-dashoffset`. It runs off the main
 *    thread's layout work and needs no timer, no requestAnimationFrame and no
 *    React render per frame. A toast that re-rendered sixty times a second to
 *    move a ring would be the most expensive thing on screen while a render is
 *    in flight, which is exactly when it appears.
 *  - The DIGIT is the only part that genuinely needs JS, and it changes once a
 *    second -- seven renders in total, not four hundred.
 *
 * The duration is passed in from UNDO_MS rather than written into the keyframe,
 * so the ring cannot drift out of sync with the timer it is describing. Change
 * UNDO_MS and this follows automatically.
 *
 * Anticlockwise, per the brief: the circle is flipped on X so the stroke
 * retreats the other way round. `forwards` holds the emptied state on the last
 * frame instead of snapping back to full.
 */
export default function UndoCountdown({ ms }: { ms: number }) {
  const reduced = usePrefersReducedMotion()
  const [left, setLeft] = useState(() => Math.ceil(ms / 1000))

  useEffect(() => {
    // Anchored to a real timestamp rather than decremented, so a throttled
    // background tab resumes showing the truth instead of however many ticks
    // it managed to fire.
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      const remaining = Math.ceil((ms - (Date.now() - startedAt)) / 1000)
      setLeft(remaining > 0 ? remaining : 0)
    }, 250)
    return () => window.clearInterval(id)
  }, [ms])

  // r=8 in a 20-box leaves room for the 2px stroke without clipping.
  const R = 8
  const CIRCUMFERENCE = 2 * Math.PI * R

  return (
    <span className="relative inline-grid size-5 flex-none place-items-center" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 20 20" className="absolute inset-0 -scale-x-100">
        <circle cx="10" cy="10" r={R} fill="none" stroke="var(--line-strong)" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r={R}
          fill="none"
          stroke="var(--progress)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          // Static full ring when reduced: the digit still carries the count,
          // so nothing is lost but the motion.
          style={
            reduced
              ? undefined
              : {
                  transformOrigin: '50% 50%',
                  transform: 'rotate(-90deg)',
                  animation: `undo-sweep ${ms}ms linear forwards`,
                }
          }
        />
      </svg>
      <span className="mono relative text-[9px] leading-none tabular-nums">{left}</span>
    </span>
  )
}
