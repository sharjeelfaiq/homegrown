import { describe, expect, it } from 'vitest'
import { pageControls } from './historyPager'
import { VOICEOVER_ROW_GEOMETRY_CLASS, voiceoverRowClassName } from './voiceoverRowLayout'

describe('voiceover row presentation', () => {
  it('keeps completed, running, and queued rows on the same geometry', () => {
    const geometry = VOICEOVER_ROW_GEOMETRY_CLASS
    expect(voiceoverRowClassName('completed').startsWith(geometry)).toBe(true)
    expect(voiceoverRowClassName('running').startsWith(geometry)).toBe(true)
    expect(voiceoverRowClassName('queued').startsWith(geometry)).toBe(true)
    expect(geometry).toContain('py-[7px]')
  })

  it('applies the existing status theme without changing row geometry', () => {
    expect(voiceoverRowClassName('completed')).toBe(VOICEOVER_ROW_GEOMETRY_CLASS)
    expect(voiceoverRowClassName('running')).toBe(`${VOICEOVER_ROW_GEOMETRY_CLASS} is-running`)
    expect(voiceoverRowClassName('queued')).toBe(`${VOICEOVER_ROW_GEOMETRY_CLASS} is-queued`)
  })
})

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

