import { useEffect, useRef, useState } from 'react'

/** A string that survives a reload, written on a debounce.
 *
 * Sibling of usePersistedRecord rather than a use of it: that one is keyed by
 * id and re-serialises the whole record on every set, which is the wrong shape
 * for a single value that changes on every keystroke and can run to
 * MAX_SCRIPT_CHARS (60,000).
 *
 * Why this exists at all: the script box was the only place in the app where
 * real work lived in memory and nowhere else. Closing the tab, reloading, or a
 * crash discarded up to 60,000 characters with no recovery, and the app never
 * even warned.
 *
 * The debounce is what makes it affordable. Writing on every keystroke means
 * a synchronous localStorage write of the whole script per character; at
 * 400ms a fast typist pays it a handful of times per sentence instead.
 *
 * Restored SYNCHRONOUSLY in the useState initialiser, not in an effect. An
 * effect would render once with an empty box and then fill it, which reads as
 * the app losing the script and then finding it -- and would race a user who
 * starts typing in that gap.
 */
export function usePersistedDraft(
  key: string,
  delayMs = 400,
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [value, setValue] = useState<string>(() => {
    // localStorage reads THROW outright in some locked-down and private modes
    // -- not on write, on read. An empty box is a fine fallback; an exception
    // here would take the whole app down before first paint.
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })

  // Skip the write that would otherwise fire immediately on mount, re-writing
  // the value that was just read back out of storage.
  const hydrated = useRef(false)

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true
      return
    }
    const id = window.setTimeout(() => {
      try {
        // Remove rather than store an empty string: a cleared box should leave
        // nothing behind, not an empty key that looks like saved state.
        if (value === '') localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {
        // Quota exceeded, or storage disabled. The draft is a convenience --
        // failing to save one must never interrupt writing it.
      }
    }, delayMs)
    return () => window.clearTimeout(id)
  }, [key, value, delayMs])

  return [value, setValue]
}
