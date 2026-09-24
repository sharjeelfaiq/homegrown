import { useEffect, useRef } from 'react'

/** Run `flush` when the page is going away, and on unmount.
 *
 * Everything the user types in this app lives in React state first and is
 * written somewhere durable second -- on a debounce (the script box), or on a
 * commit the user has to trigger by pressing Enter or clicking away (every
 * InlineName). Both leave a window in which a reload loses the edit, and it is
 * exactly the window someone hits when they type and immediately refresh.
 *
 * `pagehide`, NOT `beforeunload`. beforeunload is the event that produces a
 * "Leave site?" prompt, which this app deliberately does not have (see
 * usePersistedDraft and StudioShell) -- registering a listener also makes the
 * page ineligible for the back/forward cache, and browsers have been
 * progressively restricting it. pagehide fires on reload and on navigation away
 * with none of that.
 *
 * BOTH events, because neither alone is reliable: mobile Safari frequently
 * terminates a page having fired only `visibilitychange`, and `pagehide` is the
 * one that fires for an ordinary desktop reload. Together they double-fire in
 * the common case, so `flush` MUST be idempotent -- every caller here either
 * writes the same value twice harmlessly, or guards itself.
 *
 * The callback is held in a ref so a caller can pass an inline closure without
 * re-registering the listeners on every render, and so the flush always sees
 * the latest state rather than the values captured when the effect last ran.
 */
export function useFlushOnHide(flush: () => void): void {
  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    const run = () => flushRef.current()
    const onVisibility = () => {
      // Only on the way OUT. Firing when the tab becomes visible again would
      // commit a draft the user has not finished, and for InlineName that
      // means committing a half-typed name every time they tab away and back.
      if (document.visibilityState === 'hidden') run()
    }
    window.addEventListener('pagehide', run)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', run)
      document.removeEventListener('visibilitychange', onVisibility)
      // Unmount counts as going away too: a row removed by a search filter or
      // by the undo-delete takes its InlineName with it, and the edit in it is
      // no less real than one interrupted by a reload.
      run()
    }
  }, [])
}
