import { useEffect, useState } from 'react'
import { bootTagline, bootWord, type BootStatus } from '../hooks/useBootStatus'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

interface Props {
  /** Phase from the backend, or null when no dev-server source is serving it. */
  boot: BootStatus | null
  /** Ticking "Loading the voice model… 42s". Null before the first poll. */
  elapsed: string | null
}

/** The startup screen: everything behind it is blurred out until the model is
 * loaded.
 *
 * This used to be an amber strip above the script box, on the reasoning that
 * the composer stays usable while the model warms. In practice it read as a
 * warning rather than as loading, and the page behind it advertised a voice
 * picker, a Generate button and a Voiceovers column that all did nothing. An
 * app that cannot do its one job should say so with the whole window, not with
 * a line of text.
 *
 * Not dismissible, deliberately -- there is nothing behind it to reach yet.
 * StudioShell drops it the moment `modelStatus` leaves 'checking', including
 * when startup FAILS, so the error row and its Retry are never trapped behind
 * this. */
const APPEAR_AFTER_MS = 250

export default function BootOverlay({ boot, elapsed }: Props) {
  const reduced = usePrefersReducedMotion()
  // A warm desktop start reaches 'ready' in a few hundred milliseconds -- the
  // launcher only opens the browser once the backend is healthy -- and a
  // spinner that flashes for one frame is worse than no spinner. Nothing is
  // lost by waiting: during this quarter second the app is not usable anyway.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setVisible(true), APPEAR_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [])

  if (!visible) return null

  return (
    // z-300 is above the modal backdrop (200) and the drop veil (100): a boot
    // overlay that a dialog could cover would be a dialog nobody can dismiss.
    // Translucent AND blurred together -- backdrop-filter has nothing to show
    // through an opaque layer, so the two go together or neither works.
    <div
      className="fixed inset-0 z-300 grid place-items-center p-(--gutter) bg-scrim-boot backdrop-blur-[6px]"
      role="status"
      aria-live="polite"
    >
      <div className="flex w-[min(340px,100%)] flex-col items-center text-center">
        <div
          className={`mb-[18px] size-[34px] rounded-full border-2 border-progress-line border-t-progress ${
            reduced ? '' : 'animate-boot-spin'
          }`}
          aria-hidden="true"
        />

        <p className="m-0 text-[15px] font-medium text-ink">
          {boot ? bootWord(boot.phase) : 'Waking up'}
        </p>
        <p className="mt-1.5 mb-[18px] text-[13px]/[1.5] text-muted">
          {boot ? bootTagline(boot.phase) : 'Homegrown is starting.'}
        </p>

        {/* Two separate slots. The launcher learned this the hard way: letting
            the backend's `detail` replace the prose meant the whole screen read
            "0.0 GB of 2.5 GB" and the one reassuring sentence vanished exactly
            when it was needed most. */}
        {/* min-h holds the line's space so the panel does not jolt when
            detail is empty. */}
        <p className="mono mt-3 min-h-[1.2em] text-[11px] text-faint">
          {boot?.detail ?? elapsed ?? ' '}
        </p>
      </div>
    </div>
  )
}
