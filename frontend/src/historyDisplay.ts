export type HistoryDisplayMode = 'infinite' | 'paginated'

const STORAGE_KEY = 'voiceoverDisplay.v1'

export function readHistoryDisplayMode(): HistoryDisplayMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'paginated' ? 'paginated' : 'infinite'
  } catch {
    return 'infinite'
  }
}

export function writeHistoryDisplayMode(mode: HistoryDisplayMode): void {
  try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* storage is optional */ }
}
