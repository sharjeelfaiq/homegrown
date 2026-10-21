import { describe, expect, it } from 'vitest'
import { pageControls } from '../historyPager'

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

