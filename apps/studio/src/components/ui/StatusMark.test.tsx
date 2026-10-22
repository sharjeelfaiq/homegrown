// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StatusMark from './StatusMark'

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

afterEach(() => {
  cleanup()
  setReducedMotion(false)
})

describe('StatusMark', () => {
  it.each([
    ['pending', 'Pending'],
    ['running', 'In progress'],
    ['done', 'Completed'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ] as const)('announces the %s lifecycle state', (status, announcement) => {
    setReducedMotion(false)
    const { container } = render(<StatusMark status={status} />)

    expect(container.querySelector(`[data-status="${status}"]`)).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe(announcement)
  })

  it('turns off animation when reduced motion is preferred', () => {
    setReducedMotion(true)
    const { container } = render(<StatusMark status="running" />)

    expect(container.querySelector('[data-status="running"]')?.hasAttribute('data-indeterminate')).toBe(true)
  })

  it('reports determinate progress through the official SVG label', () => {
    const { container } = render(<StatusMark status="running" progress={0.62} />)
    expect(container.querySelector('[data-status="running"]')?.hasAttribute('data-indeterminate')).toBe(false)
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('In progress, 62%')
  })
})
