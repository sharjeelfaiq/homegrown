import { useCallback } from 'react'

/** Copy text, and work in the deployment this app actually ships in.
 *
 * `navigator.clipboard` requires a SECURE CONTEXT. The primary deployment here
 * is LAN mode -- `start_server.bat` binds 0.0.0.0 and every other device
 * reaches the app at `http://<lan-ip>:8000`, which is not secure -- so
 * `navigator.clipboard` is `undefined` for every user who is not on this
 * machine. A naive implementation is not merely degraded there: it throws, or
 * silently resolves nothing, on the majority of real sessions.
 *
 * So the modern API is tried, the `document.execCommand('copy')` fallback
 * catches the insecure-origin case, and the return value says which happened
 * so the caller can avoid claiming success it did not achieve.
 *
 * The fallback's textarea is positioned off-screen rather than hidden with
 * `display: none` or `visibility: hidden` -- an unrendered element cannot be
 * selected, and the selection is the entire mechanism.
 */
export function useCopyToClipboard(): (text: string) => Promise<boolean> {
  return useCallback(async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        // Permission denied, or a context the check above did not catch. Fall
        // through rather than giving up -- execCommand may still work.
      }
    }

    try {
      const ta = document.createElement('textarea')
      ta.value = text
      // readOnly, not disabled: a disabled field cannot be selected, and iOS
      // zooms to a focused editable one.
      ta.readOnly = true
      ta.style.position = 'fixed'
      ta.style.top = '0'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      ta.setSelectionRange(0, text.length)
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }, [])
}
