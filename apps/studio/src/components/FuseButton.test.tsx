// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FuseButton from './FuseButton'

function setReducedMotion(matches = false) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('FuseButton', () => {
  it('undoes with Escape and removes its keyboard listener on unmount', () => {
    setReducedMotion()
    const onUndo = vi.fn()
    const { unmount } = render(<FuseButton ms={7000} onUndo={onUndo} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onUndo).toHaveBeenCalledTimes(1)
    unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('tracks the supplied timeout and honours reduced motion', () => {
    setReducedMotion(true)
    vi.useFakeTimers()
    const onComplete = vi.fn()
    render(<FuseButton ms={1000} onUndo={vi.fn()} onComplete={onComplete} />)
    expect(screen.getByRole('button').className).toContain('fuse-button-reduced')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
