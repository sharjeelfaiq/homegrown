// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import MascotPicker from './MascotPicker'

const boop = vi.fn()

vi.mock('page-mascot', () => ({
  Mascot: ({ directions, reactions, label, size }: { directions: string, reactions: string, label: string, size?: number }) => (
    // The real component reacts only to a click on its own button, so the mock
    // keeps that shape: the boop spy stands in for the reaction sprites.
    <button type="button" onClick={() => boop()} data-testid="mascot" data-directions={directions} data-reactions={reactions} data-size={size} aria-label={label} />
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  boop.mockClear()
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})

function renderPicker() {
  const anchorRef = createRef<HTMLElement>()
  return render(<MascotPicker anchorRef={anchorRef} />)
}

describe('MascotPicker', () => {
  it('starts with Mascot 2 (the Cat sheets) and cycles the generated catalog', () => {
    renderPicker()

    expect(screen.getAllByTestId('mascot')).toHaveLength(1)
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/2a.webp')
    expect(screen.getByTestId('mascot').getAttribute('data-reactions')).toBe('/mascots/2b.webp')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    const previous = screen.getByRole('button', { name: 'Show previous mascot; current mascot is Mascot 2' })
    const next = screen.getByRole('button', { name: 'Show next mascot; current mascot is Mascot 2' })
    fireEvent.click(next)

    expect(screen.getAllByTestId('mascot')).toHaveLength(1)
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/3a.webp')
    expect(screen.getByTestId('mascot').getAttribute('data-reactions')).toBe('/mascots/3b.webp')

    fireEvent.click(screen.getByRole('button', { name: 'Show previous mascot; current mascot is Mascot 3' }))
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/2a.webp')
    fireEvent.click(previous)
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/1a.webp')

    fireEvent.click(screen.getByRole('button', { name: 'Show previous mascot; current mascot is Mascot 1' }))
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/7a.webp')

    for (const id of [1, 2, 3, 4, 5, 6, 7]) {
      fireEvent.click(screen.getByRole('button', { name: `Show next mascot; current mascot is Mascot ${id === 1 ? 7 : id - 1}` }))
      expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe(`/mascots/${id}a.webp`)
    }
  })

  it('only starts a drag after a small movement threshold and keeps navigation clicks isolated', () => {
    renderPicker()
    const picker = screen.getByTestId('mascot-picker')
    const next = screen.getByRole('button', { name: 'Show next mascot; current mascot is Mascot 2' })

    const mascot = screen.getByTestId('mascot')
    fireEvent.pointerDown(mascot, { pointerId: 4, button: 0, clientX: 20, clientY: 740 })
    fireEvent.pointerMove(mascot, { pointerId: 4, clientX: 23, clientY: 742 })
    expect(picker).toHaveAttribute('data-dragged', 'false')
    fireEvent.pointerMove(mascot, { pointerId: 4, clientX: 100, clientY: 650 })
    expect(picker).toHaveAttribute('data-dragged', 'false')
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(4)
    fireEvent.pointerUp(picker, { pointerId: 4 })
    expect(picker).toHaveAttribute('data-dragged', 'true')
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(4)

    fireEvent.pointerDown(next, { pointerId: 5, button: 0, clientX: 100, clientY: 650 })
    fireEvent.click(next)
    expect(screen.getByTestId('mascot').getAttribute('data-directions')).toBe('/mascots/3a.webp')
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledTimes(1)
  })

  it('keeps a stationary press bare so the mascot still boops, and swallows the click after a drag', () => {
    renderPicker()
    const picker = screen.getByTestId('mascot-picker')
    const mascot = screen.getByTestId('mascot')

    fireEvent.pointerDown(mascot, { pointerId: 2, button: 0, clientX: 40, clientY: 700 })
    fireEvent.pointerUp(mascot, { pointerId: 2 })
    fireEvent.click(mascot)
    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled()
    expect(picker).toHaveAttribute('data-dragged', 'false')
    expect(boop).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(mascot, { pointerId: 3, button: 0, clientX: 40, clientY: 700 })
    fireEvent.pointerMove(mascot, { pointerId: 3, clientX: 160, clientY: 600 })
    fireEvent.pointerUp(mascot, { pointerId: 3 })
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(3)
    expect(picker).toHaveAttribute('data-dragged', 'true')
    fireEvent.click(mascot)
    expect(boop).toHaveBeenCalledTimes(1)

    // Only the drag's own trailing click is swallowed; the next one boops again.
    fireEvent.click(mascot)
    expect(boop).toHaveBeenCalledTimes(2)
  })

  it('resizes by pointer drag and by keyboard within its bounds, without dragging', () => {
    renderPicker()
    const picker = screen.getByTestId('mascot-picker')
    const handle = screen.getByTestId('mascot-resize')
    expect(picker).toHaveAttribute('data-size', '80')
    expect(screen.getByTestId('mascot').getAttribute('data-size')).toBe('80')

    fireEvent.pointerDown(handle, { pointerId: 9, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 9, clientX: 120, clientY: 120 })
    fireEvent.pointerUp(handle, { pointerId: 9 })
    expect(picker).toHaveAttribute('data-size', '100')
    expect(screen.getByTestId('mascot').getAttribute('data-size')).toBe('100')
    expect(picker).toHaveAttribute('data-dragged', 'false')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(picker).toHaveAttribute('data-size', '108')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(picker).toHaveAttribute('data-size', '92')

    for (let press = 0; press < 30; press += 1) fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(picker).toHaveAttribute('data-size', '176')
    expect(handle).toHaveAttribute('aria-valuenow', '176')

    for (let press = 0; press < 30; press += 1) fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(picker).toHaveAttribute('data-size', '56')
    expect(handle).toHaveAttribute('aria-valuenow', '56')

    // A user-chosen size survives viewport changes; the responsive default no
    // longer applies once they have resized it.
    fireEvent.resize(window)
    expect(picker).toHaveAttribute('data-size', '56')
  })

  it('re-clamps a dragged position after the mascot grows', () => {
    renderPicker()
    const picker = screen.getByTestId('mascot-picker')
    const handle = screen.getByTestId('mascot-resize')
    fireEvent.pointerDown(picker, { pointerId: 11, button: 0, clientX: 20, clientY: 740 })
    fireEvent.pointerMove(picker, { pointerId: 11, clientX: 4000, clientY: 4000 })
    fireEvent.pointerUp(picker, { pointerId: 11 })

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 400, top: 0, left: 0, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    expect(Number.parseFloat(picker.style.left)).toBeLessThanOrEqual(window.innerWidth - 400 - 16)
    expect(Number.parseFloat(picker.style.top)).toBeLessThanOrEqual(window.innerHeight - 400 - 16)
  })

  it('clamps a dragged mascot into the viewport, including after resize', () => {
    renderPicker()
    const picker = screen.getByTestId('mascot-picker')
    fireEvent.pointerDown(picker, { pointerId: 7, button: 0, clientX: 20, clientY: 740 })
    fireEvent.pointerMove(picker, { pointerId: 7, clientX: -1000, clientY: -1000 })
    expect(picker.style.left).toBe('16px')
    expect(picker.style.top).toBe('16px')

    fireEvent.pointerMove(picker, { pointerId: 7, clientX: 4000, clientY: 4000 })
    fireEvent.resize(window)
    expect(Number.parseFloat(picker.style.left)).toBeLessThanOrEqual(window.innerWidth - 16)
    expect(Number.parseFloat(picker.style.top)).toBeLessThanOrEqual(window.innerHeight - 16)
  })
})
