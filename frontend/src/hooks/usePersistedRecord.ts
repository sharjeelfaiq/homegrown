import { useState } from 'react'

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

  function setEntry(id: string, value: string) {
    setRecord((prev) => {
      const next = { ...prev, [id]: value }
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }

  function removeEntry(id: string) {
    setRecord((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }

  return [record, setEntry, removeEntry] as const
}
