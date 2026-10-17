/** The toolbar count switches from the full history total to the selection. */
export function voiceoverHeading(totalCount: number, selectedCount: number): string {
  const count = selectedCount > 0 ? selectedCount : totalCount
  return `${count} ${count === 1 ? 'voiceover' : 'voiceovers'}`
}
