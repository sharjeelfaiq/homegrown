export function timeAgo(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '--'
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

/** A first-guess voice name from a reference clip's filename.
 *
 * Separators become spaces, because the raw stem is usually a slug --
 * "2-minute-english-mini-podcast" reads as a URL, "2 minute english mini
 * podcast" reads as a name you can edit. Capped at 40 characters so a long
 * download filename cannot fill the field. */
export function presetNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

/** m:ss, for a transport position readout.
 *
 * Separate from formatDuration on purpose: "1m 6s" is right for "this voiceover
 * is about a minute long" and wrong for a clock that ticks. Only the transport
 * uses this; every other duration in the app stays formatDuration. */
export function formatClock(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds == null || !isFinite(seconds) ? 0 : seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function downloadName(presetName: string, unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const stamp = date.toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return `${presetName}_${stamp}`
}
