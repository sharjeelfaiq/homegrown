import { useCallback, useState } from 'react'

/** Record<string, string> state persisted to localStorage under `key`, so
 * per-entry values (like custom download file names) survive a reload. */
export function usePersistedRecord(key: string) {
  const [record, setRecord] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}')
    } catch {
      return {}
    }
  })

  // Stable identities: these are read inside effects that must run when the
  // data changes, not on every render. Without useCallback a caller either
  // gets an effect that fires continuously or one with a dishonest dependency
  // list.
  const setEntry = useCallback((id: string, value: string) => {
    setRecord((prev) => {
      const next = { ...prev, [id]: value }
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])

  const removeEntry = useCallback((id: string) => {
    setRecord((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])

  return [record, setEntry, removeEntry] as const
}
