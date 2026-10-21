import { useEffect, useRef } from 'react'

interface Handlers {
  /** Ctrl/Cmd+Enter. Fires even while typing -- that is the point of it. */
  onGenerate?: () => void
  /** Escape. Fires anywhere; also blurs the focused field first. */
  onCancel?: () => void
}

/** True when the event came from somewhere the user is entering text. */
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

      if (e.key === 'Escape') {
        if (typing && e.target instanceof HTMLElement) e.target.blur()
        h.onCancel?.()
        return
      }

    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
