/** Shared geometry keeps a completed row in the same slot as its live queue representation. */
export const VOICEOVER_ROW_GEOMETRY_CLASS =
  'group/row -mx-2 flex overflow-hidden border-b border-hairline px-2 py-[7px] last:border-b-0'

export function voiceoverRowClassName(
  status: 'completed' | 'running' | 'queued' | 'failed' | 'canceling',
  extraClasses: Array<string | false | undefined> = [],
) {
  const theme = {
    completed: '', running: 'is-running', queued: 'is-queued',
    failed: 'is-failed', canceling: 'is-canceling',
  }[status]
  return [VOICEOVER_ROW_GEOMETRY_CLASS, theme, ...extraClasses].filter(Boolean).join(' ')
}
