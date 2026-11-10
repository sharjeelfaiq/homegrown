import type { HistoryEntry } from '../../lib/api'

export interface NumberedRow {
  entry: HistoryEntry
  number: number
  name: string
}

/** Hide the rows whose delete is mid-Undo-window and shrink the heading count
 * by however many are actually hidden on this page.
 *
 * Rows are numbered by the caller BEFORE this runs, so the survivors keep their
 * original "Voiceover 27" numbers -- filtering first would renumber the list
 * the instant a delete was confirmed. The row reappears simply by dropping its
 * id from `pending` (the Undo path); nothing else is restored here because the
 * underlying cache entry is untouched until the deferred request commits. */
export function applyPendingDeletes(
  rows: NumberedRow[],
  pending: ReadonlySet<string>,
  total: number,
): { visible: NumberedRow[]; visibleTotal: number } {
  if (pending.size === 0) return { visible: rows, visibleTotal: total }
  let hidden = 0
  const visible = rows.filter(({ entry }) => {
    if (!pending.has(entry.id)) return true
    hidden += 1
    return false
  })
  return { visible, visibleTotal: Math.max(0, total - hidden) }
}
