import { useCallback } from 'react'

/** Copy text, and work in the deployment this app actually ships in.
 *
 * `navigator.clipboard` requires a SECURE CONTEXT. The packaged desktop app
 * uses localhost, which browsers treat as secure, but the fallback remains
 * necessary for any direct HTTP deployment. A naive implementation would
 * throw, or silently resolve nothing, in that case.
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
