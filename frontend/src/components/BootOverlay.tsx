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
    <div className="boot-veil" role="status" aria-live="polite">
      <div className="boot-panel">
        <div className={`boot-spinner${reduced ? ' is-static' : ''}`} aria-hidden="true" />

        <p className="boot-phase">{boot ? bootWord(boot.phase) : 'Waking up'}</p>
        <p className="boot-tagline">
          {boot ? bootTagline(boot.phase) : 'Homegrown is starting.'}
        </p>

        {/* Two separate slots. The launcher learned this the hard way: letting
            the backend's `detail` replace the prose meant the whole screen read
            "0.0 GB of 2.5 GB" and the one reassuring sentence vanished exactly
            when it was needed most. */}
        <p className="mono boot-detail">
          {boot?.detail ?? elapsed ?? ' '}
        </p>
      </div>
    </div>
  )
}
