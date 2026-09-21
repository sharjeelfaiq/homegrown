import { describe, expect, it } from 'vitest'
import { pageControls } from '../historyPager'
import { selectedDownloadKind, selectionAfterRowClick, selectionAfterRowDrag } from './HistoryList'

describe('history page controls', () => {
  it('shows every page when there are four or fewer', () => {
    expect(pageControls(0, 1)).toEqual([0])
    expect(pageControls(1, 2)).toEqual([0, 1])
    expect(pageControls(2, 3)).toEqual([0, 1, 2])
    expect(pageControls(3, 4)).toEqual([0, 1, 2, 3])
  })

  it('keeps five direct page targets near the start', () => {
    expect(pageControls(0, 5)).toEqual([0, 1, 2, 3, 4])
    expect(pageControls(2, 12)).toEqual([0, 1, 2, 3, 4])
  })

  it('slides the fixed window to include the selected intermediate page', () => {
    expect(pageControls(6, 12)).toEqual([4, 5, 6, 7, 8])
  })

  it('ends the fixed window at the final page', () => {
    expect(pageControls(11, 12)).toEqual([7, 8, 9, 10, 11])
  })
})

describe('voiceover selection', () => {
  it('uses a plain click to select only that row', () => {
    expect([...selectionAfterRowClick(new Set(['a', 'b']), ['a', 'b', 'c'], 2, 0, { additive: false, range: false })]).toEqual(['c'])
  })

  it('toggles with Ctrl/Cmd-click', () => {
    expect([...selectionAfterRowClick(new Set(['a']), ['a', 'b', 'c'], 1, 0, { additive: true, range: false })]).toEqual(['a', 'b'])
    expect([...selectionAfterRowClick(new Set(['a', 'b']), ['a', 'b', 'c'], 1, 0, { additive: true, range: false })]).toEqual(['a'])
  })

  it('adds the contiguous visible range on Shift-click', () => {
    expect([...selectionAfterRowClick(new Set(['a']), ['a', 'b', 'c', 'd'], 3, 0, { additive: false, range: true })]).toEqual(['a', 'b', 'c', 'd'])
    expect([...selectionAfterRowClick(new Set(['a']), ['a', 'b', 'c', 'd'], 3, null, { additive: false, range: true })]).toEqual(['a', 'b', 'c', 'd'])
  })

  it('selects a contiguous range from a plain drag', () => {
    expect([...selectionAfterRowDrag(new Set(), ['a', 'b', 'c', 'd'], 1, 3, 'replace')]).toEqual(['b', 'c', 'd'])
  })

  it('adds a dragged range with Shift and toggles it with Ctrl/Cmd', () => {
    expect([...selectionAfterRowDrag(new Set(['a']), ['a', 'b', 'c'], 1, 2, 'add')]).toEqual(['a', 'b', 'c'])
    expect([...selectionAfterRowDrag(new Set(['a', 'b']), ['a', 'b', 'c'], 1, 2, 'toggle')]).toEqual(['a', 'c'])
  })

  it('downloads one selected voiceover directly and batches multiple selections', () => {
    expect(selectedDownloadKind(1)).toBe('mp3')
    expect(selectedDownloadKind(2)).toBe('zip')
  })
})
