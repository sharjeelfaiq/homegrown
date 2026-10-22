/** Keep five direct page targets visible while shifting the range around the
 * selected page. Unlike an ellipsis pager, the current page is never hidden. */
const PAGE_BUTTON_COUNT = 5

export function pageControls(page: number, pageCount: number): number[] {
  const count = Math.max(1, pageCount)
  const size = Math.min(PAGE_BUTTON_COUNT, count)
  const current = Math.max(0, Math.min(page, count - 1))
  const start = Math.max(0, Math.min(current - Math.floor(size / 2), count - size))
  return Array.from({ length: size }, (_, index) => start + index)
}
