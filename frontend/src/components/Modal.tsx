import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Accessible modal shell. Hand-rolled -- adding Radix or Headless UI for one
 * dialog would cost more bundle than this whole app's UI code.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  - Escape is handled in the CAPTURE phase and its propagation stopped.
 *    useHotkeys binds Escape on window for "clear the error banner"; without
 *    capturing first, dismissing this dialog would also wipe state behind it.
 *  - Focus is trapped and returned to whatever opened the modal, so keyboard
 *    users are not dumped at the top of the document on close.
 *  - Body scroll is locked while open, otherwise the page behind scrolls under
 *    the overlay on wheel input. */
export default function Modal({ open, title, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const reduced = usePrefersReducedMotion()
  const titleId = useId()

  // onClose is held in a ref so the effect below can depend on `open` ALONE.
  //
  // Callers pass an inline arrow (`onClose={() => setVoicesOpen(false)}`), so
  // its identity changes on every render of the parent -- and the parent
  // re-renders on every keystroke, because the form's text lives in its state.
  // With onClose in the dependency array, that made the effect tear down and
  // re-run per character: the cleanup returned focus to the element that opened
  // the modal, then setup moved it to the panel's first control. Typing a voice
  // name was impossible; focus left the field after every letter.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    restoreTo.current = document.activeElement as HTMLElement | null

    // Move focus to the first control in the BODY, not the panel -- the panel's
    // first focusable is the header's ✕, and opening a dialog with the close
    // button focused invites you to dismiss what you just opened. Falls back to
    // the panel itself when the body has nothing focusable.
    const panel = panelRef.current
    const body = panel?.querySelector<HTMLElement>('.modal-body')
    const first =
      body?.querySelector<HTMLElement>(FOCUSABLE) ?? panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (nodes.length === 0) return
      const firstNode = nodes[0]
      const lastNode = nodes[nodes.length - 1]
      const active = document.activeElement

      // Wrap at both ends so Tab can never escape the dialog.
      if (e.shiftKey && (active === firstNode || !panelRef.current?.contains(active))) {
        e.preventDefault()
        lastNode.focus()
      } else if (!e.shiftKey && active === lastNode) {
        e.preventDefault()
        firstNode.focus()
      }
    }

    // Capture phase: beat useHotkeys' window listener to Escape.
    window.addEventListener('keydown', onKeyDown, true)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus?.()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduced ? undefined : { opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.16 }}
          onMouseDown={(e) => {
            // mousedown, not click: a drag that starts inside the panel and
            // ends on the backdrop would otherwise close the dialog.
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={panelRef}
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduced ? false : { opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? undefined : { opacity: 0, y: 4, scale: 0.99 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
          >
            <header className="modal-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
                ✕
              </button>
            </header>
            <div className="modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
