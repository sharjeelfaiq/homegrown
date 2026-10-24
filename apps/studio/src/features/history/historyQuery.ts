import { QueryClient, onlineManager, type QueryKey } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { listHistory, listPresets, listLanguages, type HistoryFilters, type HistoryPage, type Preset } from '../../lib/api'

export const HISTORY_SCOPE = 'local-user'
const HISTORY_CACHE_VERSION = 'voiceover-history.v1'
const HISTORY_STALE_MS = 60_000
const HISTORY_GC_MS = 20 * 60_000

interface HistoryRequest extends HistoryFilters { limit: number; offset: number }

export function normalizeHistoryRequest(request: Partial<HistoryRequest>): HistoryRequest {
  const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? value : undefined
  return {
    presetId: request.presetId || undefined,
    createdFrom: finite(request.createdFrom), createdTo: finite(request.createdTo),
    durationMin: finite(request.durationMin), durationMax: finite(request.durationMax),
    query: request.query?.trim().replace(/\s+/g, ' ') || undefined,
    limit: Math.max(1, Math.min(100, Math.floor(request.limit ?? 20))),
    offset: Math.max(0, Math.floor(request.offset ?? 0)),
  }
}

export function historyQueryKey(request: Partial<HistoryRequest>): QueryKey {
  const normalized = normalizeHistoryRequest(request)
  return ['voiceover-history', HISTORY_SCOPE, normalized] as const
}

export const historyQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: HISTORY_STALE_MS, gcTime: HISTORY_GC_MS, retry: 1,
      refetchOnMount: true, refetchOnWindowFocus: true, refetchInterval: false,
      structuralSharing: true,
    },
  },
})

export const apiQueryKeys = {
  voices: ['voices', HISTORY_SCOPE] as const,
  voiceList: (request: { limit?: number; offset?: number; q?: string } = {}) => ['voices', HISTORY_SCOPE, {
    limit: request.limit === undefined ? undefined : Math.max(1, Math.min(100, Math.floor(request.limit))),
    offset: request.offset === undefined ? undefined : Math.max(0, Math.floor(request.offset)),
    q: request.q?.trim().replace(/\s+/g, ' ').toLocaleLowerCase() || undefined,
  }] as const,
  languages: ['model-languages', HISTORY_SCOPE] as const,
  queue: ['generation-queue', HISTORY_SCOPE] as const,
}

/** Only fields used by voice rows and selectors survive local persistence. */
export function persistablePreset(preset: Preset): Preset {
  const { id, name, language, tag, preview_url, created_at, ref_seconds, chunk_chars, is_builtin, completed_voiceovers } = preset
  return { id, name, language, tag, preview_url, created_at, ref_seconds, chunk_chars, is_builtin, completed_voiceovers, ref_text: '', audio_path: '' }
}

export function fetchVoices() {
  return listPresets().then(({ presets }) => presets.filter((preset) => !preset.is_builtin).map(persistablePreset))
}

export function fetchVoicePage(request: { limit?: number; offset?: number; q?: string } = {}) {
  const normalized = apiQueryKeys.voiceList(request)[2]
  return listPresets(normalized).then((result) => ({ ...result, presets: result.presets.filter((preset) => !preset.is_builtin).map(persistablePreset) }))
}

export async function fetchLanguages() {
  return (await listLanguages()).languages
}

export function invalidateVoices() {
  return historyQueryClient.invalidateQueries({ queryKey: apiQueryKeys.voices })
}

const persister = typeof window === 'undefined' ? undefined : createSyncStoragePersister({
  storage: window.localStorage,
  key: HISTORY_CACHE_VERSION,
  throttleTime: 1000,
})

if (persister) {
  void persistQueryClient({
    queryClient: historyQueryClient,
    persister,
    maxAge: 24 * 60 * 60_000,
    dehydrateOptions: { shouldDehydrateQuery: (query) => ['voiceover-history', 'voices', 'model-languages'].includes(String(query.queryKey[0])) },
  })
}

if (typeof window !== 'undefined') {
  onlineManager.setEventListener((setOnline) => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    update()
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  })
}

export function fetchHistoryPage(request: Partial<HistoryRequest>): Promise<HistoryPage> {
  const normalized = normalizeHistoryRequest(request)
  return listHistory(normalized.limit, normalized.offset, normalized)
}

export function invalidateHistory() {
  return historyQueryClient.invalidateQueries({ queryKey: ['voiceover-history', HISTORY_SCOPE] })
}
