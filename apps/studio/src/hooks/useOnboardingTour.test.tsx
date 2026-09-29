// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingTour } from './useOnboardingTour'

const driverMock = vi.hoisted(() => vi.fn())
const reducedMotionMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('driver.js', () => ({ driver: driverMock }))
vi.mock('./usePrefersReducedMotion', () => ({ usePrefersReducedMotion: reducedMotionMock }))

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
      'Welcome to Homegrown', 'Personalize and get help', 'Choose or create a voice', 'Write the script', 'Generate a voiceover', 'Monitor and reuse work', 'Find past work', 'You are ready',
    ])
    expect(config.steps[2].popover.description).toContain('reference clip')
    expect(config.steps[4].popover.description).toContain('centered Generate')
    expect(config.steps[5].popover.description).toContain('Active and finished')
    expect(config.steps[6].popover.description).toContain('filter')

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
