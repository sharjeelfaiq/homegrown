/** Maximum visible copy lengths for the two compact Studio message surfaces. */
export const TUTORIAL_MESSAGE_MAX_CHARS = 180
export const TOAST_MESSAGE_MAX_CHARS = 160

/** Normalize whitespace and clip at a word boundary, reserving room for an ellipsis. */
function fitMessage(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(normalized)
  if (chars.length <= limit) return normalized

  const visible = chars.slice(0, Math.max(1, limit - 1)).join('')
  const boundary = visible.lastIndexOf(' ')
  const clipped = (boundary > 0 ? visible.slice(0, boundary) : visible).trimEnd()
  return `${clipped}…`
}

export function formatTutorialMessage(value: string): string {
  return fitMessage(value, TUTORIAL_MESSAGE_MAX_CHARS)
}

/** Toast titles and descriptions share one limit; action labels remain untouched. */
export function formatToastMessage(value: string): string {
  return fitMessage(value, TOAST_MESSAGE_MAX_CHARS)
}

/** Toast titles use sentence case and omit sentence-ending punctuation. */
export function formatToastTitle(value: string): string {
  const fitted = formatToastMessage(value).replace(/[.!?]+$/, '')
  const [first, ...rest] = Array.from(fitted)
  return first ? `${first.toLocaleUpperCase()}${rest.join('')}` : fitted
}

/** Prose descriptions use sentence case and terminal punctuation. */
export function formatToastDescription(value: string): string {
  const [first, ...rest] = Array.from(formatToastMessage(value))
  const fitted = first ? `${first.toLocaleUpperCase()}${rest.join('')}` : ''
  if (!fitted || /[.!?…]$/.test(fitted)) return fitted
  return fitMessage(`${fitted}.`, TOAST_MESSAGE_MAX_CHARS)
}
