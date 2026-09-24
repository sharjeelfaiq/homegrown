import { useEffect, useRef } from 'react'

interface Handlers {
  /** Ctrl/Cmd+Enter. Fires even while typing -- that is the point of it. */
  onGenerate?: () => void
  /** Escape. Fires anywhere; also blurs the focused field first. */
  onCancel?: () => void
  /** "/" . Suppressed while typing. */
  onFocusScript?: () => void
  /** Ctrl/Cmd+F. Returns true if it actually took the key; when it returns
   *  false the browser's own find is left alone. See the call site for why
   *  that is a boolean rather than a plain void handler. */
  onFindInApp?: () => boolean
}

/** True when the event came from somewhere the user is entering text.
 *
 * Without this check, "/" becomes unusable inside the script box --
 * the single most likely way to make the app feel broken, since typing a
 * script is the app's primary activity. contentEditable is included because a
 * rich-text field would otherwise slip through the tagName test. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Global keyboard shortcuts.
 *
 * Handlers are held in a ref so the listener is attached once and never
 * re-bound as the parent re-renders (which it does on every keystroke in the
 * script box). */
export function useHotkeys(handlers: Handlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const h = ref.current
      const typing = isTyping(e.target)

      // Ctrl/Cmd+Enter is deliberately allowed while typing: finishing a
      // script and submitting it without reaching for the mouse is the whole
      // reason this shortcut exists.
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (h.onGenerate) {
          e.preventDefault()
          h.onGenerate()
        }
        return
      }

      // Ctrl/Cmd+F, alongside Ctrl/Cmd+Enter and above the bare-key guard for
      // the same reason: a modifier combo has to work while typing, or it is
      // unreachable from the one place people are usually typing.
      //
      // preventDefault is CONDITIONAL, and that is the whole point of the
      // boolean. Taking Ctrl+F away from the browser is a real hijack -- it is
      // the one shortcut every user already knows -- so it is only taken when
      // there is actually an in-app search to give them. With no voiceovers
      // there is no search box, the handler says so, and the browser's find
      // opens as it always did.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        if (h.onFindInApp?.()) e.preventDefault()
        return
      }

      if (e.key === 'Escape') {
        if (typing && e.target instanceof HTMLElement) e.target.blur()
        h.onCancel?.()
        return
      }

      // Everything below is a bare key, so it must never fire while typing --
      // and never when a modifier is held, or it would hijack browser
      // shortcuts like Ctrl+/ .
      //
      // Space USED to be here, clicking the newest voiceover's play button. It
      // was removed: a bare Space bound globally has to preventDefault to stop
      // the page scrolling, which is a large behaviour to take over for one
      // convenience, and the rows already have a play button.
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === '/') {
        if (h.onFocusScript) {
          e.preventDefault() // stop Firefox's quick-find
          h.onFocusScript()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
