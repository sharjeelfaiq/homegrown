import { describe, expect, it } from 'vitest'
import { HISTORY_SCOPE, historyQueryKey, normalizeHistoryRequest } from './historyQuery'

describe('history query request normalization', () => {
  it('bounds pagination and normalizes search whitespace', () => {
    expect(normalizeHistoryRequest({ limit: 1000, offset: -4, query: '  Ada   Lovelace  ' }))
      .toMatchObject({ limit: 100, offset: 0, query: 'Ada Lovelace' })
  })

  it('scopes keys to the local user and separates pages', () => {
    expect(historyQueryKey({ limit: 20, offset: 0 })[1]).toBe(HISTORY_SCOPE)
    expect(historyQueryKey({ limit: 20, offset: 0 })).not.toEqual(historyQueryKey({ limit: 20, offset: 20 }))
  })
})
