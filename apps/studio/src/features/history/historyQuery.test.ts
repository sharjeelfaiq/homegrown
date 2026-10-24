import { describe, expect, it } from 'vitest'
import { apiQueryKeys, HISTORY_SCOPE, historyQueryKey, normalizeHistoryRequest, persistablePreset } from './historyQuery'

describe('history query request normalization', () => {
  it('bounds pagination and normalizes search whitespace', () => {
    expect(normalizeHistoryRequest({ limit: 1000, offset: -4, query: '  Ada   Lovelace  ' }))
      .toMatchObject({ limit: 100, offset: 0, query: 'Ada Lovelace' })
  })

  it('scopes keys to the local user and separates pages', () => {
    expect(historyQueryKey({ limit: 20, offset: 0 })[1]).toBe(HISTORY_SCOPE)
    expect(historyQueryKey({ limit: 20, offset: 0 })).not.toEqual(historyQueryKey({ limit: 20, offset: 20 }))
  })

  it('normalizes voice search keys and separates pages and searches', () => {
    expect(apiQueryKeys.voiceList({ limit: 10, offset: 0, q: '  Ada   ' }))
      .toEqual(apiQueryKeys.voiceList({ limit: 10, offset: 0, q: 'ada' }))
    expect(apiQueryKeys.voiceList({ limit: 10, offset: 0, q: 'ada' }))
      .not.toEqual(apiQueryKeys.voiceList({ limit: 10, offset: 10, q: 'ada' }))
    expect(apiQueryKeys.voiceList({ limit: 10, offset: 0, q: 'ada' }))
      .not.toEqual(apiQueryKeys.voiceList({ limit: 10, offset: 0, q: 'grace' }))
    expect(apiQueryKeys.languages[1]).toBe(HISTORY_SCOPE)
    expect(apiQueryKeys.queue[1]).toBe(HISTORY_SCOPE)
  })

  it('projects private reference fields out of persisted voice data', () => {
    const projected = persistablePreset({
      id: 'voice', name: 'Ada', language: 'English', tag: '', preview_url: '/audio/preview',
      created_at: 1, ref_seconds: 5, chunk_chars: 100, ref_text: 'private transcript', audio_path: 'private path',
    })
    expect(projected).toMatchObject({ id: 'voice', name: 'Ada', preview_url: '/audio/preview' })
    expect(projected.ref_text).toBe('')
    expect(projected.audio_path).toBe('')
  })
})
