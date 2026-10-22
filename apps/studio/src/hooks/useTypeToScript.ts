import { useLayoutEffect, useRef, type RefObject } from 'react'

const BLOCKED_TARGETS = [
  // Keep real editors, search fields, and selection popups in control. Ordinary
  // buttons and links cannot accept text, so printable keys from them should
  // still return to Script.
  'input', 'textarea', 'select',
  '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="searchbox"]',
  '[role="combobox"]', '[role="menuitem"]', '[role="option"]',
  '[role="radio"]', '[role="checkbox"]', '[role="switch"]', '[role="tab"]',
  '[role="toolbar"]',
].join(',')

const OVERLAYS = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]'
const OPEN_MENU_TRIGGER = '[aria-haspopup="menu"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]'

function isVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function hasOpenOverlay(): boolean {
  return Array.from(document.querySelectorAll(OVERLAYS)).some(isVisible)
    || document.querySelector(OPEN_MENU_TRIGGER) !== null
}

function isPrintableKey(key: string): boolean {
  const codePoints = Array.from(key)
  if (codePoints.length !== 1) return false
  return key === ' ' || (codePoints[0].codePointAt(0) ?? 0) >= 0x20
}

/** Return printable typing on a neutral Studio surface to the Script editor. */
export function useTypeToScript(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  onChange: (value: string) => void,
): void {
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  const pendingCaret = useRef<number | null>(null)
  valueRef.current = value
  changeRef.current = onChange

  useLayoutEffect(() => {
    const caret = pendingCaret.current
    const textarea = textareaRef.current
    if (caret === null || !textarea) return
    textarea.setSelectionRange(caret, caret)
    pendingCaret.current = null
  }, [value, textareaRef])

  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented
        || event.isComposing
        || event.keyCode === 229
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || !isPrintableKey(event.key)
        || hasOpenOverlay()
      ) return

      const target = event.target
      // Icons are commonly SVGElement targets. Treat them like any other
      // neutral surface so a key typed after clicking an icon still reaches
      // the Script editor.
      if (!(target instanceof Element)) return
      if (target.closest(BLOCKED_TARGETS)) return

      const textarea = textareaRef.current
      if (!textarea || document.activeElement === textarea) return

      const start = textarea.selectionStart ?? valueRef.current.length
      const end = textarea.selectionEnd ?? start
      const current = textarea.value
      const next = current.slice(0, start) + event.key + current.slice(end)
      const caret = start + event.key.length

      event.preventDefault()
      textarea.focus()
      valueRef.current = next
      pendingCaret.current = caret
      changeRef.current(next)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [textareaRef])
}
