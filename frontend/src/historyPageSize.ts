/** How many completed voiceovers one page shows, persisted per browser.
 *
 * Same shape as the display-mode preference this replaced (`voiceoverDisplay.v1`,
 * deleted along with infinite scroll): a SYNCHRONOUS validated read, so the list
 * renders its first page at the stored size instead of rendering ten rows and
 * then reflowing. An unknown, out-of-range or non-numeric stored value falls
 * back to the default rather than being trusted -- localStorage is user-editable
 * and an unbounded value here would slice an arbitrary number of rows into a
 * column whose height is already decided by the viewport.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type HistoryPageSize = (typeof PAGE_SIZE_OPTIONS)[number]

/** Ten was the hardcoded page size before this control existed; keeping it as
 *  the default means an existing user sees no change until they ask for one. */
export const DEFAULT_PAGE_SIZE: HistoryPageSize = 10

const STORAGE_KEY = 'voiceoverPageSize.v1'

function isPageSize(value: number): value is HistoryPageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
}

export function readHistoryPageSize(): HistoryPageSize {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return isPageSize(stored) ? stored : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

export function writeHistoryPageSize(size: HistoryPageSize): void {
  try { localStorage.setItem(STORAGE_KEY, String(size)) } catch { /* storage is optional */ }
}
