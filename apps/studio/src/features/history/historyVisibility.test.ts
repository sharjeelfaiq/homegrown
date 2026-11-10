import { describe, expect, it } from 'vitest'
import { applyPendingDeletes, type NumberedRow } from './historyVisibility'

function row(id: string, number: number): NumberedRow {
  return { entry: { id } as NumberedRow['entry'], number, name: `Voiceover ${number}` }
}

describe('applyPendingDeletes', () => {
  const rows = [row('a', 27), row('b', 26), row('c', 25)]

  it('returns the rows untouched when nothing is pending', () => {
    const { visible, visibleTotal } = applyPendingDeletes(rows, new Set(), 27)
    expect(visible).toBe(rows)
    expect(visibleTotal).toBe(27)
  })

  it('hides a confirmed row and drops the heading count by one', () => {
    const { visible, visibleTotal } = applyPendingDeletes(rows, new Set(['b']), 27)
    expect(visible.map((r) => r.entry.id)).toEqual(['a', 'c'])
    expect(visibleTotal).toBe(26)
  })

  it('keeps original numbers on the survivors', () => {
    const { visible } = applyPendingDeletes(rows, new Set(['b']), 27)
    expect(visible.map((r) => r.number)).toEqual([27, 25])
  })

  it('only subtracts rows actually hidden on this page', () => {
    // 'z' is pending but lives on another page, so this page is unchanged.
    const { visible, visibleTotal } = applyPendingDeletes(rows, new Set(['z']), 27)
    expect(visible.map((r) => r.entry.id)).toEqual(['a', 'b', 'c'])
    expect(visibleTotal).toBe(27)
  })

  it('counts every hidden row on the page', () => {
    const { visible, visibleTotal } = applyPendingDeletes(rows, new Set(['a', 'c']), 27)
    expect(visible.map((r) => r.entry.id)).toEqual(['b'])
    expect(visibleTotal).toBe(25)
  })

  it('never reports a negative heading count', () => {
    const { visibleTotal } = applyPendingDeletes([row('a', 1)], new Set(['a']), 0)
    expect(visibleTotal).toBe(0)
  })
})
