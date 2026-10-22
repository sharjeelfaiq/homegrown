// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingTour } from './useOnboardingTour'
import { TUTORIAL_MESSAGE_MAX_CHARS } from '../../lib/messageFormatting'

const driverMock = vi.hoisted(() => vi.fn())
const reducedMotionMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: reducedMotionMock }))

function TourHarness({ status, onReady }: { status: 'checking' | 'ready' | 'down', onReady: (tour: ReturnType<typeof useOnboardingTour>) => void }) {
  onReady(useOnboardingTour(status))
  return null
}

describe('useOnboardingTour', () => {
  beforeEach(() => {
    localStorage.clear()
    driverMock.mockReset()
    reducedMotionMock.mockReturnValue(true)
    driverMock.mockReturnValue({ isActive: () => false, drive: vi.fn(), destroy: vi.fn() })
  })

  it('starts only when ready, provides the current stable workflow, and respects reduced motion', () => {
    let tour: ReturnType<typeof useOnboardingTour> | undefined
    const view = render(<TourHarness status="checking" onReady={(value) => { tour = value }} />)
    expect(driverMock).not.toHaveBeenCalled()

    view.rerender(<TourHarness status="ready" onReady={(value) => { tour = value }} />)
    expect(driverMock).toHaveBeenCalledTimes(1)
    const config = driverMock.mock.calls[0][0]
    for (const { popover } of config.steps) {
      expect(popover.title.length).toBeLessThanOrEqual(TUTORIAL_MESSAGE_MAX_CHARS)
      expect(popover.description.length).toBeLessThanOrEqual(TUTORIAL_MESSAGE_MAX_CHARS)
      expect(popover.description).not.toMatch(/…$/)
    }
    expect(config).toMatchObject({ animate: false, duration: 0, smoothScroll: false, allowKeyboardControl: true, skipMissingElement: true })
    expect(config.steps.map((step: { element?: string }) => step.element)).toEqual([
      undefined,
      '[data-tour="header-controls"]',
      '[data-tour="voice-controls"]',
      '[data-tour="script-editor"]',
      '[data-tour="generate-control"]',
      '[data-tour="voiceovers"]',
      '[data-tour="voiceover-search-filters"]',
      undefined,
    ])
    expect(config.steps.map((step: { popover: { title: string, description: string } }) => step.popover.title)).toEqual([
      'Welcome to Homegrown', 'Theme and help', 'Choose or add a voice', 'Write the script', 'Generate a voiceover', 'Voiceover history', 'Search and filter voiceovers', 'You are ready',
    ])
    expect(config.steps[0].popover.description).toContain('cards stack on smaller screens.')
    expect(config.steps[2].popover.description).toContain('clicking its row')
    expect(config.steps[3].popover.description).not.toContain('Press /')
    expect(config.steps[4].popover.description).toContain('lower-right')
    expect(config.steps[4].popover.description).toContain('hover it to see the keyboard shortcut')
    expect(config.steps[5].popover.description).toContain('Generated voiceovers appear in this card')
    expect(config.steps[6].popover.description).toContain('filter button')

    act(() => tour?.startTour({ force: true }))
    expect(driverMock).toHaveBeenCalledTimes(1)
  })

  it('does not auto-start after completion but permits forced replay', () => {
    localStorage.setItem('homegrown-onboarding-tour.v1', 'dismissed')
    let tour: ReturnType<typeof useOnboardingTour> | undefined
    render(<TourHarness status="ready" onReady={(value) => { tour = value }} />)
    expect(driverMock).not.toHaveBeenCalled()

    act(() => tour?.startTour({ force: true }))
    expect(driverMock).toHaveBeenCalledTimes(1)
  })
})
