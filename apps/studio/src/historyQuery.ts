import { QueryClient, onlineManager, type QueryKey } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { listHistory, type HistoryFilters, type HistoryPage } from './api'

export const HISTORY_SCOPE = 'local-user'
export const HISTORY_CACHE_VERSION = 'voiceover-history.v1'
export const HISTORY_STALE_MS = 60_000
export const HISTORY_GC_MS = 20 * 60_000

export interface HistoryRequest extends HistoryFilters { limit: number; offset: number }

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
    dehydrateOptions: { shouldDehydrateQuery: (query) => query.queryKey[0] === 'voiceover-history' },
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

/** Reserved for future account/workspace transitions. */
export function clearHistoryCache() {
  return historyQueryClient.removeQueries({ queryKey: ['voiceover-history'] })
}
