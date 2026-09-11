import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/** Report a piece of error STATE as a toast.
 *
 * The state stays the source of truth and this mirrors it, rather than
 * callers firing `toast.error()` at the call site. That matters for two
 * behaviours that already existed:
 *
 *  - Escape clears the composer's error (useHotkeys' onCancel -> setError(null)),
 *    and Modal handles Escape in the CAPTURE phase specifically so dismissing a
 *    dialog does not also wipe it. Firing toasts imperatively would leave that
 *    binding pointing at nothing while the toast stayed on screen.
 *  - handleGenerate clears the error before submitting, so a stale failure does
 *    not sit under a fresh attempt.
 *
 * Mirroring means clearing the state dismisses the toast, and both keep
 * working untouched.
 *
 * The previous toast is dismissed before a new one is raised. Without that,
 * an error changing from one message to another would stack two, and the
 * stale one would outlive the state it came from.
 *
 * duration: Infinity, like the job-failure toast in useJobToasts. These are
 * failures the user has to act on -- a missing voice, a delete that did not
 * happen, a backend that will not start -- and one that auto-dismissed would
 * be reported as the app doing nothing.
 */
export function useErrorToast(message: string | null, title: string): void {
  const idRef = useRef<string | number | null>(null)

  useEffect(() => {
    if (idRef.current !== null) {
      toast.dismiss(idRef.current)
      idRef.current = null
    }
    if (message == null || message === '') return
    idRef.current = toast.error(title, { description: message, duration: Infinity })
  }, [message, title])

  // Unmount should not leave a toast behind pointing at a screen that is gone.
  useEffect(
    () => () => {
      if (idRef.current !== null) toast.dismiss(idRef.current)
    },
    [],
  )
}
